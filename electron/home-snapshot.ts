// ENH-212 — Home re-entry snapshot service (PRD § 4.2 / § 5 step 2).
//
// Pure, STATELESS, recomputed on every HOME_SNAPSHOT call — zero caching,
// zero sidecar (D9 / the ENH-183 § D9 invariant). Enumerates
// ~/.claude/projects/*, rolls them up into real project roots (D8:
// worktrees fold into their main repo via the `.git` file `gitdir:`
// pointer; nested cwds fold into the shallowest enclosing real root via
// shared/projects.ts ancestors / deepestEnclosingRoot), derives hues from
// hashColorIndex, tags sessions with a subPath badge, scans recent files,
// and composes the greeting (D4 / D12).
//
// Heroes (the 2 most-recently-active roots) get tail snippets +
// per-session head titles; spine roots get a head title for their newest
// session only (§ 4.2 [V]). All file reads are seek-based + concurrency-
// limited (~8) with a per-file timeout — a 270MB session is NEVER slurped.
//
// The open-session join (live PTY cwd + persisted lastClaudeSession
// pointer) and the unattributed-live-claude set are injected by main
// (electron/main.ts wires the lsof + presence probes); this module stays
// fs-only so its rollup/greeting/recent-files logic is unit-testable
// against a temp projects tree with no Electron / no ps / no lsof.

import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import {
  ancestors,
  deepestEnclosingRoot,
  hashColorIndex,
} from '../shared/projects'
import { hasMarker } from '../core/projects-service'
import {
  listTopLevelSessions,
  readSessionHeadMeta,
  readSessionTailMeta,
  type TopLevelSessionStat,
} from './claude-session-tracker'
import type {
  GreetingData,
  HomeProject,
  HomeSession,
  HomeSessionOpen,
  HomeSnapshot,
} from '../shared/types'

/** Default sessions surfaced per project before the "all N sessions"
 *  expander takes over (heroes show 3 per D3). */
const DEFAULT_LIMIT_PER_PROJECT = 3
/** Heroes (most-recently-active roots) get richer reads (tail snippet +
 *  per-visible-session head titles). The rest are spine. */
const HERO_COUNT = 2
/** Recent-files scan: depth, count cap, and the names/dirs we never
 *  surface as "recent work". */
const RECENT_FILES_DEPTH = 2
const RECENT_FILES_MAX = 5
const RECENT_FILES_SKIP_DIRS = new Set(['.git', 'node_modules'])
const RECENT_FILES_SKIP_NAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'Cargo.lock',
  'poetry.lock',
  'Gemfile.lock',
  'composer.lock',
  '.DS_Store',
])
/** Per-file read budget (D14) — an iCloud-evicted JSONL that stalls past
 *  this renders snippet-less rather than blocking the whole snapshot. */
const PER_FILE_TIMEOUT_MS = 1200
/** Concurrency cap for the seek-based reads (§ 4.2 — p-limit ~8; p-limit
 *  isn't a dependency, so a tiny hand-rolled limiter does the job). */
const READ_CONCURRENCY = 8

// ── tiny concurrency limiter (no p-limit dependency) ────────────────────

/** Run `tasks` with at most `concurrency` in flight at once; resolve to
 *  the results in input order. Each task is a thunk so it isn't started
 *  until a slot frees. */
async function mapLimit<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

/** Wrap a never-throwing read in a per-file timeout (D14). On timeout we
 *  resolve to `fallback` rather than reject — the read functions are
 *  best-effort, so a stalled iCloud-evicted file degrades gracefully. */
function withTimeout<R>(p: Promise<R>, fallback: R, ms = PER_FILE_TIMEOUT_MS): Promise<R> {
  return new Promise<R>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(fallback)
    }, ms)
    void p.then(
      (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v) } },
      () => { if (!settled) { settled = true; clearTimeout(timer); resolve(fallback) } }
    )
  })
}

// ── path helpers (Posix — Duo is macOS) ─────────────────────────────────

function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  return idx < 0 ? trimmed : trimmed.slice(idx + 1)
}

/** The relative path from `root` to `child` (D8 subPath badge), or
 *  undefined when `child` IS `root` (no badge). Both are absolute and
 *  child is assumed to be under root (the rollup guarantees it). */
function subPathOf(root: string, child: string): string | undefined {
  if (child === root) return undefined
  const r = root.replace(/\/+$/, '')
  if (child.startsWith(r + '/')) return child.slice(r.length + 1)
  return undefined
}

// ── git-worktree fold (D8) ──────────────────────────────────────────────

/**
 * If `dir` is a git WORKTREE, return its MAIN repo root; else null.
 *
 * A worktree has a `.git` FILE (not a directory) containing
 * `gitdir: <path>/.git/worktrees/<name>`. The main repo root is the
 * grandparent-of-`worktrees` (i.e. the dir holding the real `.git`):
 * `.../<repo>/.git/worktrees/<name>` → `<repo>`. Best-effort; any read
 * failure or unexpected shape → null (the dir folds by path prefix only).
 */
async function mainRepoForWorktree(dir: string): Promise<string | null> {
  try {
    const gitPath = path.join(dir, '.git')
    const stat = await fs.stat(gitPath).catch(() => null)
    if (!stat || !stat.isFile()) return null
    const text = await fs.readFile(gitPath, 'utf8')
    const m = /^gitdir:\s*(.+)\s*$/m.exec(text)
    if (!m) return null
    const gitdir = m[1].trim()
    // .../<repo>/.git/worktrees/<name> → strip the trailing
    // /.git/worktrees/<name> to recover <repo>.
    const idx = gitdir.indexOf('/.git/worktrees/')
    if (idx <= 0) return null
    return gitdir.slice(0, idx)
  } catch {
    return null
  }
}

/**
 * Is `dir` a git repository root? `.git` qualifies whether it is a
 * directory (normal repo) or a file (worktree / submodule) — mirrors
 * core/git/scan.ts. One half of the rail's project-qualification gate
 * (the other is `hasMarker`, CLAUDE.md / .claude). Never throws.
 */
async function isGitRoot(dir: string): Promise<boolean> {
  const stat = await fs.stat(path.join(dir, '.git')).catch(() => null)
  return !!stat && (stat.isDirectory() || stat.isFile())
}

// ── enumeration ─────────────────────────────────────────────────────────

interface RawProjectDir {
  /** The encoded ~/.claude/projects/<encoded> directory. */
  encodedDir: string
  /** Decoded evidence cwd (from a session HEAD read — never a reversed
   *  encodeProjectDir). null when no session carried a cwd. */
  cwd: string | null
  sessions: TopLevelSessionStat[]
}

/** Enumerate ~/.claude/projects/*, listing each dir's top-level sessions
 *  and reading ONE head per dir for the rollup cwd evidence (D8 [V] — cwd
 *  rides the cheap head read, never a lossy encodeProjectDir reversal). */
async function enumerateProjectDirs(projectsRoot: string): Promise<RawProjectDir[]> {
  let entries: import('fs').Dirent[]
  try {
    entries = await fs.readdir(projectsRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const dirs = entries.filter((e) => e.isDirectory())
  return mapLimit(dirs, READ_CONCURRENCY, async (e) => {
    const encodedDir = path.join(projectsRoot, e.name)
    const sessions = await listTopLevelSessions(encodedDir)
    if (sessions.length === 0) return { encodedDir, cwd: null, sessions }
    // Newest session's head carries the most-likely-current cwd evidence.
    const newest = sessions.reduce((a, b) => (b.mtimeMs > a.mtimeMs ? b : a))
    const head = await withTimeout(
      readSessionHeadMeta(path.join(encodedDir, `${newest.id}.jsonl`)),
      { cwd: null }
    )
    return { encodedDir, cwd: head.cwd, sessions }
  })
}

// ── rollup (D8) ─────────────────────────────────────────────────────────

interface RolledSession {
  stat: TopLevelSessionStat
  /** The encoded dir the session physically lives in (for the JSONL path). */
  encodedDir: string
  /** The session's own evidence cwd (the dir's head cwd). */
  cwd: string
}

interface RolledProject {
  rootPath: string
  sessions: RolledSession[]
}

/**
 * Fold raw project dirs into real roots (D8). The fold runs in two passes:
 *
 *   1. Resolve each dir's "real root": if its cwd is a git worktree, the
 *      worktree's MAIN repo; else the cwd itself. Dirs with no cwd evidence
 *      keep their encoded dir as a degenerate root (still rendered, just not
 *      foldable).
 *   2. Path-prefix fold: a root that is nested under another resolved root
 *      collapses into the shallowest enclosing one (deepestEnclosingRoot over
 *      the set of roots — "shallowest real root" per the PRD: a cwd folds into
 *      the deepest QUALIFYING ancestor, and the qualifying set is the resolved
 *      roots themselves, so siblings never merge).
 *
 * Exported for unit testing (the worktree-fold + prefix-fold + sibling-
 * separation table is the core D8 contract).
 */
export async function rollupProjects(raw: RawProjectDir[]): Promise<RolledProject[]> {
  // Pass 1 — resolve each dir's real root via the worktree gitdir pointer.
  const resolved: Array<{ encodedDir: string; cwd: string; root: string; sessions: TopLevelSessionStat[] }> = []
  await mapLimit(raw, READ_CONCURRENCY, async (r) => {
    if (!r.cwd || r.sessions.length === 0) return
    const main = await mainRepoForWorktree(r.cwd)
    resolved.push({ encodedDir: r.encodedDir, cwd: r.cwd, root: main ?? r.cwd, sessions: r.sessions })
  })

  // Pass 2 — fold each resolved root into its DEEPEST enclosing real
  // project root, matching the project rail's model (D8 + the owner's
  // "fold into the real project" rollup choice).
  //
  // EMPIRICAL CORRECTION (2026-06-12, live verify): an earlier draft folded
  // into the SHALLOWEST enclosing *session* root, with every resolved cwd
  // its own qualifier. Because the user had at least one session whose cwd
  // was the home directory, EVERY project collapsed into ~/ — one
  // "geoffreydudgeon" bucket of 83 sessions, directly violating the
  // "6–12 projects" goal. The rail never has this problem because it
  // qualifies against (gitRoot || marker), not arbitrary cwds. Home now
  // does the same: build the qualifying set from git-root / CLAUDE.md /
  // .claude ancestors (shared/projects.ts deriveProjects § D2), then fold
  // via the shared deepestEnclosingRoot(). A cwd with no qualifying
  // ancestor (e.g. a one-off session in ~/) keeps its own cwd as a
  // degenerate root so it still appears rather than vanishing.
  const qualifying = new Set<string>()
  const probed = new Set<string>() // memo: stat each unique ancestor once
  await mapLimit(resolved, READ_CONCURRENCY, async (r) => {
    for (const dir of ancestors(r.root)) {
      if (probed.has(dir)) continue
      probed.add(dir) // claim synchronously (before the await) so shared
      // ancestors across roots are probed exactly once, positive OR negative
      if (await isGitRoot(dir) || await hasMarker(dir)) qualifying.add(dir)
    }
  })
  const byRoot = new Map<string, RolledSession[]>()
  for (const r of resolved) {
    const fold = deepestEnclosingRoot(r.root, qualifying) ?? r.root
    const list = byRoot.get(fold) ?? []
    for (const s of r.sessions) {
      list.push({ stat: s, encodedDir: r.encodedDir, cwd: r.cwd })
    }
    byRoot.set(fold, list)
  }

  return [...byRoot.entries()].map(([rootPath, sessions]) => ({ rootPath, sessions }))
}

// ── recent files (shallow mtime scan) ───────────────────────────────────

/** Depth-≤2 mtime scan of `root`, skipping .git/node_modules + lockfiles,
 *  returning the top RECENT_FILES_MAX by mtime. Best-effort + never throws
 *  — a missing/unreadable root yields []. */
export async function scanRecentFiles(root: string): Promise<{ path: string; mtime: number }[]> {
  const found: { path: string; mtime: number }[] = []
  async function walk(dir: string, depth: number): Promise<void> {
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (depth >= RECENT_FILES_DEPTH) continue
        if (RECENT_FILES_SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue
        await walk(path.join(dir, e.name), depth + 1)
        continue
      }
      if (!e.isFile()) continue
      if (RECENT_FILES_SKIP_NAMES.has(e.name) || e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      const stat = await fs.stat(full).catch(() => null)
      if (!stat) continue
      found.push({ path: full, mtime: stat.mtimeMs })
    }
  }
  await walk(root, 0)
  found.sort((a, b) => b.mtime - a.mtime)
  return found.slice(0, RECENT_FILES_MAX)
}

// ── greeting (D4 / D12) ─────────────────────────────────────────────────

/** Derive the greeting line data. `firstName` is omitted gracefully when
 *  os.userInfo() can't supply one (D12). `openCount` is the number of
 *  evidence-joined live sessions; `freshest` is the most-recent session
 *  across all projects. Exported for the homeModel greeting-cases tests. */
export function buildGreeting(
  projects: HomeProject[],
  openCount: number,
  firstName: string | undefined,
  now: number
): GreetingData {
  let freshest: { title: string; ageMs: number } | undefined
  for (const proj of projects) {
    for (const s of proj.sessions) {
      if (!freshest || s.modifiedAt > now - freshest.ageMs) {
        freshest = { title: s.title, ageMs: Math.max(0, now - s.modifiedAt) }
      }
    }
  }
  return {
    ...(firstName ? { firstName } : {}),
    openCount,
    ...(freshest ? { freshest } : {}),
  }
}

/** os.userInfo() first name (D12) — the leading token of the GECOS / username
 *  fallback, omitted entirely when nothing usable is available. */
function detectFirstName(): string | undefined {
  try {
    const info = os.userInfo()
    // username is always present; there's no portable real-name field, so
    // use the login name's leading token when it looks like a name. A bare
    // login like "geoffreydudgeon" is acceptable; an empty/odd value omits.
    const raw = (info.username ?? '').trim()
    if (!raw) return undefined
    const first = raw.split(/[\s._-]+/)[0]
    if (!first) return undefined
    return first.charAt(0).toUpperCase() + first.slice(1)
  } catch {
    return undefined
  }
}

// ── snapshot assembly ───────────────────────────────────────────────────

/** Injected open-session evidence (built main-side from the live `claude`
 *  process scan). Keyed by session uuid → its liveness attribution. */
export type OpenByUuid = ReadonlyMap<string, HomeSessionOpen>

/** One cwd that currently hosts ≥1 live `claude` process, with everything
 *  the pure attributor needs: the Duo tabs running claude there (focusable),
 *  the count of EXTERNAL live claudes there (non-Duo — focus-not-fork), and
 *  the cwd's session uuids freshest-first (mtime desc, from a stat-only dir
 *  scan). The IO that builds this (ps / lsof / dir read) lives in main. */
export interface LiveCwdGroup {
  cwd: string
  duoTabs: Array<{ windowId: number; tabId: string }>
  externalCount: number
  uuidsByRecency: string[]
}

/**
 * Pure open-session attribution (ENH-212 round-2; D13-refining). Liveness is
 * PROCESS-primary: each LiveCwdGroup is a cwd with N = duoTabs.length +
 * externalCount confirmed-live claude processes. The N freshest session uuids
 * in that cwd are the live sessions - Duo-hosted ones first (so they get
 * focusable duo pills), the remainder external (focus-not-fork).
 *
 * This is NOT the banned D13 heuristic: a uuid is marked open ONLY because a
 * live claude PROCESS exists in its cwd (not because a tab merely sits in a
 * cwd with a recent JSONL). The mtime ordering only disambiguates WHICH uuid
 * among a cwd's sessions, on a live, recomputed-every-snapshot, non-persisted
 * signal. Pure (no fs / ps / lsof) so the contract is unit-testable.
 */
export function attributeOpenSessions(groups: readonly LiveCwdGroup[]): Map<string, HomeSessionOpen> {
  const openByUuid = new Map<string, HomeSessionOpen>()
  for (const g of groups) {
    let i = 0
    // Duo-hosted claudes claim the freshest uuids -> focusable pills.
    for (const tab of g.duoTabs) {
      const uuid = g.uuidsByRecency[i]
      if (uuid == null) break
      i++
      if (!openByUuid.has(uuid)) openByUuid.set(uuid, { kind: 'duo', windowId: tab.windowId, tabId: tab.tabId })
    }
    // Remaining live claudes in this cwd run outside Duo -> external.
    for (let e = 0; e < g.externalCount; e++) {
      const uuid = g.uuidsByRecency[i]
      if (uuid == null) break
      i++
      if (!openByUuid.has(uuid)) openByUuid.set(uuid, { kind: 'external' })
    }
  }
  return openByUuid
}

export interface BuildHomeSnapshotDeps {
  /** Default ~/.claude/projects; injectable for tests. */
  projectsRoot?: string
  /** Sessions surfaced per project (heroes show 3). */
  limitPerProject?: number
  /** Process-primary open-session attribution (uuid → duo|external).
   *  Absent ⇒ no open pills. */
  openByUuid?: OpenByUuid
  /** First-name override (tests); production reads os.userInfo(). */
  firstName?: string | undefined
  /** Clock injection for deterministic age math in tests. */
  now?: number
}

/**
 * Build the full Home snapshot. Pure with respect to its injected deps —
 * the only ambient I/O is the fs reads under `projectsRoot`, all seek-based
 * + concurrency-limited + per-file-timed.
 */
export async function buildHomeSnapshot(deps: BuildHomeSnapshotDeps = {}): Promise<HomeSnapshot> {
  const projectsRoot = deps.projectsRoot ?? path.join(os.homedir(), '.claude', 'projects')
  const limitPerProject = deps.limitPerProject ?? DEFAULT_LIMIT_PER_PROJECT
  const openByUuid: OpenByUuid = deps.openByUuid ?? new Map()
  const now = deps.now ?? Date.now()
  const firstName = 'firstName' in deps ? deps.firstName : detectFirstName()

  const raw = await enumerateProjectDirs(projectsRoot)
  const rolled = await rollupProjects(raw)

  // Order roots by recency (newest session mtime) — heroes first.
  const ordered = rolled
    .map((p) => {
      const lastActiveAt = p.sessions.reduce((m, s) => Math.max(m, s.stat.mtimeMs), 0)
      return { ...p, lastActiveAt }
    })
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)

  const projects: HomeProject[] = await mapLimit(ordered, READ_CONCURRENCY, async (p, idx) => {
    const isHero = idx < HERO_COUNT
    const colorIndex = hashColorIndex(p.rootPath)
    const displayName = basename(p.rootPath) || p.rootPath

    // Newest sessions first; the visible slice gets head titles (heroes:
    // every visible session; spine: just the newest), and heroes also get a
    // tail snippet from their freshest session.
    const sorted = [...p.sessions].sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    const visible = sorted.slice(0, limitPerProject)

    const sessions: HomeSession[] = await mapLimit(visible, READ_CONCURRENCY, async (rs, sIdx) => {
      const file = path.join(rs.encodedDir, `${rs.stat.id}.jsonl`)
      // Spine roots only read a head title for their NEWEST session (§ 4.2
      // [V]); heroes read a head title for every visible session.
      const wantTitle = isHero || sIdx === 0
      const head = wantTitle
        ? await withTimeout(readSessionHeadMeta(file), { cwd: null })
        : { cwd: null as string | null }
      const open = openByUuid.get(rs.stat.id)
      return {
        uuid: rs.stat.id,
        title: head.title ?? rs.stat.id.slice(0, 8),
        titleSource: head.titleSource ?? ('uuid' as const),
        modifiedAt: rs.stat.mtimeMs,
        // D6 — the session's REAL cwd (resume runs here). Carried verbatim
        // so a sibling worktree (root = main repo, subPath undefined) still
        // resumes in the worktree, never the main repo.
        cwd: rs.cwd,
        ...(subPathOf(p.rootPath, rs.cwd) ? { subPath: subPathOf(p.rootPath, rs.cwd) } : {}),
        ...(open ? { open } : {}),
      }
    })

    // Hero snippet — the freshest session's last assistant line (D3).
    let snippet: string | undefined
    if (isHero && sorted.length > 0) {
      const file = path.join(sorted[0].encodedDir, `${sorted[0].stat.id}.jsonl`)
      const tail = await withTimeout(readSessionTailMeta(file), {
        snippet: null, gitBranch: null, sessionId: null, timestamp: null,
      })
      if (tail.snippet) snippet = tail.snippet
    }

    // Recent files — heroes only (the chips are a hero affordance, § 1);
    // spine rows don't render them.
    const recentFiles = isHero ? await scanRecentFiles(p.rootPath) : []

    return {
      rootPath: p.rootPath,
      displayName,
      colorIndex,
      lastActiveAt: p.lastActiveAt,
      sessionCount: p.sessions.length,
      ...(snippet ? { snippet } : {}),
      sessions,
      recentFiles,
    }
  })

  // openCount is the AUTHORITATIVE join size, not a per-visible-session tally:
  // an open session ranked below `limitPerProject` (default 3) is still hosted
  // by a live terminal, so it must count toward the greeting's open total
  // (D4 — "all quiet" vs "N sessions open" hinges on this being complete).
  const greeting = buildGreeting(projects, openByUuid.size, firstName, now)

  return {
    generatedAt: now,
    greeting,
    projects,
  }
}

/** Paged "all N sessions" expander for one root (HOME_LIST_SESSIONS). Lazy
 *  head titles — only the requested window's sessions get a title read.
 *  Sessions are physically spread across the rolled-up encoded dirs, so we
 *  re-enumerate + re-roll, then slice the requested root's session list. */
export async function listHomeSessions(
  root: string,
  offset: number,
  limit: number,
  deps: { projectsRoot?: string; openByUuid?: OpenByUuid } = {}
): Promise<HomeSession[]> {
  const projectsRoot = deps.projectsRoot ?? path.join(os.homedir(), '.claude', 'projects')
  const openByUuid: OpenByUuid = deps.openByUuid ?? new Map()
  const raw = await enumerateProjectDirs(projectsRoot)
  const rolled = await rollupProjects(raw)
  const proj = rolled.find((p) => p.rootPath === root)
  if (!proj) return []
  const sorted = [...proj.sessions].sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
  const page = sorted.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(0, limit))
  return mapLimit(page, READ_CONCURRENCY, async (rs) => {
    const file = path.join(rs.encodedDir, `${rs.stat.id}.jsonl`)
    const head = await withTimeout(readSessionHeadMeta(file), { cwd: null })
    const open = openByUuid.get(rs.stat.id)
    return {
      uuid: rs.stat.id,
      title: head.title ?? rs.stat.id.slice(0, 8),
      titleSource: head.titleSource ?? ('uuid' as const),
      modifiedAt: rs.stat.mtimeMs,
      // D6 — the session's REAL cwd (resume runs here, never root+subPath).
      cwd: rs.cwd,
      ...(subPathOf(root, rs.cwd) ? { subPath: subPathOf(root, rs.cwd) } : {}),
      ...(open ? { open } : {}),
    }
  })
}
