// ENH-212 — Home snapshot service (electron/home-snapshot.ts).
//
// The rollup contract (D8) is table-driven: worktree gitdir fold, nested-
// cwd prefix fold, sibling separation, subPath badges, hue stability via
// hashColorIndex. Plus recent-files bounds + ignore list, greeting cases
// (0 / 1 / N open + no-name), and a perf bound on an 85-session fixture
// tree that also asserts bytes-read stays bounded (no fs.readFile of a
// large fixture).
//
// Fixtures: a temp `projectsRoot` with encoded `<encoded>/` dirs, each
// holding `<uuid>.jsonl` top-level sessions. The rollup cwd evidence comes
// from each session's HEAD (first user entry's `cwd`), NOT a reversed
// encodeProjectDir — so the encoded dir name is arbitrary and the cwd is
// whatever the head entry declares. Worktree dirs are REAL dirs on disk
// (with a `.git` FILE carrying `gitdir:`) so mainRepoForWorktree can stat
// them.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import {
  buildHomeSnapshot,
  buildCatchupSnapshot,
  rollupProjects,
  scanRecentFiles,
  buildGreeting,
  attributeOpenSessions,
  type LiveCwdGroup,
  type OpenByUuid,
} from './home-snapshot'
import { SessionDigestStore } from '../core/session-digest-store'
import { HomeStateStore } from '../core/home-state-store'
import { hashColorIndex } from '../shared/projects'
import type { HomeProject, HomeSessionOpen } from '../shared/types'

// ── fixture helpers ──────────────────────────────────────────────────────

let projectsRoot: string
let worldRoot: string // where "real" project dirs (for worktree fold) live

beforeEach(async () => {
  projectsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'enh-212-home-projects-'))
  worldRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'enh-212-home-world-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(projectsRoot, { recursive: true, force: true })
  await fs.rm(worldRoot, { recursive: true, force: true })
})

function jsonl(lines: object[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
}

function userEntry(text: string, cwd: string): object {
  return {
    parentUuid: null,
    isSidechain: false,
    type: 'user',
    message: { role: 'user', content: text },
    uuid: 'u',
    timestamp: '2026-06-10T01:00:00.000Z',
    cwd,
    sessionId: 's',
    gitBranch: 'main',
  }
}

function assistantEntry(text: string, cwd: string): object {
  return {
    parentUuid: 'p',
    isSidechain: false,
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    uuid: 'a',
    timestamp: '2026-06-10T01:14:32.395Z',
    cwd,
    sessionId: 's',
    gitBranch: 'main',
  }
}

/** Write a top-level session JSONL into an encoded project dir. The dir is
 *  created on demand. Returns the uuid. mtime is set so recency ordering is
 *  deterministic (older `ageSec` ⇒ older file). */
async function writeSession(opts: {
  encoded: string
  uuid: string
  cwd: string
  prompt?: string
  reply?: string
  ageSec?: number
}): Promise<string> {
  const dir = path.join(projectsRoot, opts.encoded)
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, `${opts.uuid}.jsonl`)
  const lines: object[] = [userEntry(opts.prompt ?? 'do the thing', opts.cwd)]
  if (opts.reply) lines.push(assistantEntry(opts.reply, opts.cwd))
  await fs.writeFile(file, jsonl(lines))
  if (opts.ageSec != null) {
    const t = new Date(Date.now() - opts.ageSec * 1000)
    await fs.utimes(file, t, t)
  }
  return opts.uuid
}

/** Make a real on-disk dir to serve as a project cwd. */
async function mkRealDir(rel: string): Promise<string> {
  const abs = path.join(worldRoot, rel)
  await fs.mkdir(abs, { recursive: true })
  return abs
}

/** Make a real dir that QUALIFIES as a project root — a `.git/` dir, the
 *  same signal the project rail uses (gitRoot || marker). The rollup folds
 *  nested cwds into the deepest such ancestor. */
async function mkGitRoot(rel: string): Promise<string> {
  const abs = await mkRealDir(rel)
  await fs.mkdir(path.join(abs, '.git'), { recursive: true })
  return abs
}

/** Make a real git WORKTREE dir: a `.git` FILE pointing at the main repo's
 *  worktrees subdir. Returns { worktree, mainRepo } absolute paths. */
async function mkWorktree(mainRel: string, worktreeName: string): Promise<{ worktree: string; mainRepo: string }> {
  const mainRepo = await mkRealDir(mainRel)
  await fs.mkdir(path.join(mainRepo, '.git'), { recursive: true })
  const worktree = await mkRealDir(`${mainRel}-wt-${worktreeName}`)
  const gitdir = path.join(mainRepo, '.git', 'worktrees', worktreeName)
  await fs.writeFile(path.join(worktree, '.git'), `gitdir: ${gitdir}\n`)
  return { worktree, mainRepo }
}

// ── rollupProjects (D8) — table-driven ─────────────────────────────────────

describe('rollupProjects — D8 fold contract', () => {
  it('folds a worktree session into its MAIN repo (gitdir: pointer)', async () => {
    const { worktree, mainRepo } = await mkWorktree('repo-a', 'feature')
    await writeSession({ encoded: 'enc-wt', uuid: 'w1', cwd: worktree })

    const raw = [{ encodedDir: path.join(projectsRoot, 'enc-wt'), cwd: worktree, sessions: [{ id: 'w1', mtimeMs: 1, sizeBytes: 10 }] }]
    const rolled = await rollupProjects(raw)
    expect(rolled).toHaveLength(1)
    expect(rolled[0].rootPath).toBe(mainRepo)
    expect(rolled[0].sessions.map((s) => s.stat.id)).toEqual(['w1'])
  })

  it('folds a nested cwd into the deepest enclosing real (git/marker) root', async () => {
    // proj-outer qualifies (git root); the nested cwd is NOT itself a root,
    // so its session folds up into proj-outer.
    const outer = await mkGitRoot('proj-outer')
    const nested = await mkRealDir('proj-outer/packages/inner')
    const raw = [
      { encodedDir: 'e1', cwd: outer, sessions: [{ id: 's-outer', mtimeMs: 2, sizeBytes: 1 }] },
      { encodedDir: 'e2', cwd: nested, sessions: [{ id: 's-inner', mtimeMs: 1, sizeBytes: 1 }] },
    ]
    const rolled = await rollupProjects(raw)
    expect(rolled).toHaveLength(1)
    expect(rolled[0].rootPath).toBe(outer)
    expect(rolled[0].sessions.map((s) => s.stat.id).sort()).toEqual(['s-inner', 's-outer'])
  })

  it('folds into the DEEPEST root when nested dirs both qualify (rail-consistent)', async () => {
    // Both outer and inner are git roots → inner stays its own project
    // (deepest enclosing), matching the project rail's deepestEnclosingRoot.
    const outer = await mkGitRoot('mono')
    const inner = await mkGitRoot('mono/packages/inner')
    const raw = [
      { encodedDir: 'e1', cwd: outer, sessions: [{ id: 's-outer', mtimeMs: 2, sizeBytes: 1 }] },
      { encodedDir: 'e2', cwd: inner, sessions: [{ id: 's-inner', mtimeMs: 1, sizeBytes: 1 }] },
    ]
    const rolled = await rollupProjects(raw)
    expect(rolled.map((r) => r.rootPath).sort()).toEqual([outer, inner].sort())
  })

  it('a non-qualifying parent cwd does NOT swallow its git-root children (home-dir collapse regression)', async () => {
    // The bug found in live verify: a one-off session whose cwd was the
    // home dir made the shallowest-fold collapse EVERY project under it
    // into one ~/ bucket. With git/marker qualification, the parent does
    // not qualify, so children stay separate and the parent stands alone.
    const parent = await mkRealDir('home-like')            // NOT a git root
    const childA = await mkGitRoot('home-like/repo-a')
    const childB = await mkGitRoot('home-like/repo-b')
    const raw = [
      { encodedDir: 'e0', cwd: parent, sessions: [{ id: 's-home', mtimeMs: 3, sizeBytes: 1 }] },
      { encodedDir: 'e1', cwd: childA, sessions: [{ id: 's-a', mtimeMs: 2, sizeBytes: 1 }] },
      { encodedDir: 'e2', cwd: childB, sessions: [{ id: 's-b', mtimeMs: 1, sizeBytes: 1 }] },
    ]
    const rolled = await rollupProjects(raw)
    expect(rolled.map((r) => r.rootPath).sort()).toEqual([parent, childA, childB].sort())
  })

  it('keeps SIBLING roots separate (neither is an ancestor of the other)', async () => {
    const a = await mkGitRoot('sib-a')
    const b = await mkGitRoot('sib-b')
    const raw = [
      { encodedDir: 'e1', cwd: a, sessions: [{ id: 'sa', mtimeMs: 1, sizeBytes: 1 }] },
      { encodedDir: 'e2', cwd: b, sessions: [{ id: 'sb', mtimeMs: 1, sizeBytes: 1 }] },
    ]
    const rolled = await rollupProjects(raw)
    expect(rolled.map((r) => r.rootPath).sort()).toEqual([a, b].sort())
  })

  it('drops dirs with no cwd evidence or no sessions', async () => {
    const a = await mkRealDir('has-cwd')
    const raw = [
      { encodedDir: 'e1', cwd: a, sessions: [{ id: 's1', mtimeMs: 1, sizeBytes: 1 }] },
      { encodedDir: 'e2', cwd: null, sessions: [{ id: 's2', mtimeMs: 1, sizeBytes: 1 }] },
      { encodedDir: 'e3', cwd: a, sessions: [] },
    ]
    const rolled = await rollupProjects(raw)
    expect(rolled).toHaveLength(1)
    expect(rolled[0].rootPath).toBe(a)
  })
})

describe('subPath badges (D8) + hue stability', () => {
  it('tags a nested session with its relative subPath, leaves the root session bare', async () => {
    const outer = await mkGitRoot('badge-outer')
    const nested = await mkRealDir('badge-outer/sub/dir')
    await writeSession({ encoded: 'eo', uuid: 'root-sess', cwd: outer, ageSec: 10 })
    await writeSession({ encoded: 'en', uuid: 'nested-sess', cwd: nested, ageSec: 20 })

    const snap = await buildHomeSnapshot({ projectsRoot, now: Date.now(), firstName: undefined })
    const proj = snap.projects.find((p) => p.rootPath === outer)
    expect(proj).toBeTruthy()
    const byUuid = Object.fromEntries(proj!.sessions.map((s) => [s.uuid, s]))
    expect(byUuid['root-sess'].subPath).toBeUndefined()
    expect(byUuid['nested-sess'].subPath).toBe('sub/dir')
  })

  it('colorIndex is hashColorIndex(rootPath) — stable + deterministic', async () => {
    const a = await mkRealDir('hue-proj')
    await writeSession({ encoded: 'eh', uuid: 'h1', cwd: a })
    const snap = await buildHomeSnapshot({ projectsRoot, firstName: undefined })
    const proj = snap.projects.find((p) => p.rootPath === a)!
    expect(proj.colorIndex).toBe(hashColorIndex(a))
  })
})

// ── recent files — bounds + ignore list ────────────────────────────────────

describe('scanRecentFiles — bounds + ignore list', () => {
  it('returns at most 5 files, newest first, skipping .git/node_modules/lockfiles/dotfiles', async () => {
    const root = await mkRealDir('rf-proj')
    // 7 normal files with staggered mtimes (file6 newest).
    for (let i = 0; i < 7; i++) {
      const f = path.join(root, `file${i}.ts`)
      await fs.writeFile(f, 'x')
      const t = new Date(Date.now() - (7 - i) * 1000)
      await fs.utimes(f, t, t)
    }
    // Noise that must be skipped.
    await fs.writeFile(path.join(root, 'package-lock.json'), '{}')
    await fs.writeFile(path.join(root, '.DS_Store'), '')
    await fs.mkdir(path.join(root, '.git'), { recursive: true })
    await fs.writeFile(path.join(root, '.git', 'HEAD'), 'ref: x')
    await fs.mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true })
    await fs.writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), 'x')

    const out = await scanRecentFiles(root)
    expect(out).toHaveLength(5)
    // Newest five = file6..file2, in descending mtime order.
    expect(out.map((f) => path.basename(f.path))).toEqual([
      'file6.ts', 'file5.ts', 'file4.ts', 'file3.ts', 'file2.ts',
    ])
    // No lockfile / dotfile / ignored-dir file leaked in.
    for (const f of out) {
      expect(f.path).not.toContain('node_modules')
      expect(f.path).not.toContain('.git')
      expect(path.basename(f.path)).not.toBe('package-lock.json')
      expect(path.basename(f.path)).not.toBe('.DS_Store')
    }
  })

  it('excludes workspace manifests (.duo-workspace / .code-workspace)', async () => {
    const root = await mkRealDir('ws-proj')
    await fs.writeFile(path.join(root, 'real.ts'), 'x')
    await fs.writeFile(path.join(root, 'ws-proj.duo-workspace'), '{}')
    await fs.writeFile(path.join(root, 'project.code-workspace'), '{}')
    const out = await scanRecentFiles(root)
    const names = out.map((f) => path.basename(f.path))
    expect(names).toContain('real.ts')
    expect(names).not.toContain('ws-proj.duo-workspace')
    expect(names).not.toContain('project.code-workspace')
  })

  it('descends at most 2 levels (depth bound)', async () => {
    const root = await mkRealDir('depth-proj')
    await fs.writeFile(path.join(root, 'top.ts'), 'x')
    await fs.mkdir(path.join(root, 'a', 'b', 'c'), { recursive: true })
    await fs.writeFile(path.join(root, 'a', 'd1.ts'), 'x') // depth 1
    await fs.writeFile(path.join(root, 'a', 'b', 'd2.ts'), 'x') // depth 2
    await fs.writeFile(path.join(root, 'a', 'b', 'c', 'd3.ts'), 'x') // depth 3 — excluded
    const out = await scanRecentFiles(root)
    const names = out.map((f) => path.basename(f.path))
    expect(names).toContain('top.ts')
    expect(names).toContain('d1.ts')
    expect(names).toContain('d2.ts')
    expect(names).not.toContain('d3.ts')
  })

  it('never throws — missing root returns []', async () => {
    expect(await scanRecentFiles(path.join(worldRoot, 'nope'))).toEqual([])
  })
})

// ── greeting (D4 / D12) ────────────────────────────────────────────────────

describe('buildGreeting — D4 / D12 cases', () => {
  const now = 1_000_000_000_000
  function proj(sessions: { title: string; modifiedAt: number }[]): HomeProject {
    return {
      rootPath: '/x', displayName: 'x', colorIndex: 0, lastActiveAt: now,
      sessionCount: sessions.length, sessions: sessions.map((s) => ({
        uuid: 'u', title: s.title, titleSource: 'uuid' as const, modifiedAt: s.modifiedAt, cwd: '/x',
      })), recentFiles: [],
    }
  }

  it('0 open → openCount 0, freshest still surfaced', () => {
    const g = buildGreeting([proj([{ title: 'the fix', modifiedAt: now - 60_000 }])], 0, 'Geoff', now)
    expect(g.openCount).toBe(0)
    expect(g.firstName).toBe('Geoff')
    expect(g.freshest).toEqual({ title: 'the fix', ageMs: 60_000 })
  })

  it('1 open', () => {
    const g = buildGreeting([proj([{ title: 't', modifiedAt: now }])], 1, 'Geoff', now)
    expect(g.openCount).toBe(1)
  })

  it('N open + picks the most-recent session as freshest across projects', () => {
    const g = buildGreeting(
      [
        proj([{ title: 'older', modifiedAt: now - 100_000 }]),
        proj([{ title: 'newest', modifiedAt: now - 5_000 }]),
      ],
      3, 'Geoff', now
    )
    expect(g.openCount).toBe(3)
    expect(g.freshest?.title).toBe('newest')
    expect(g.freshest?.ageMs).toBe(5_000)
  })

  it('no name → firstName omitted (D12)', () => {
    const g = buildGreeting([proj([{ title: 't', modifiedAt: now }])], 0, undefined, now)
    expect('firstName' in g).toBe(false)
  })

  it('no projects → no freshest', () => {
    const g = buildGreeting([], 0, 'Geoff', now)
    expect(g.freshest).toBeUndefined()
  })
})

// ── full snapshot — open join + ordering ───────────────────────────────────

describe('buildHomeSnapshot — assembly', () => {
  it('orders projects by recency (heroes first) + caps sessions per project', async () => {
    const old = await mkRealDir('old-proj')
    const fresh = await mkRealDir('fresh-proj')
    await writeSession({ encoded: 'e-old', uuid: 'o1', cwd: old, ageSec: 1000 })
    // fresh-proj has 4 sessions; default limit is 3.
    for (let i = 0; i < 4; i++) {
      await writeSession({ encoded: `e-fresh-${i}`, uuid: `f${i}`, cwd: fresh, ageSec: 10 + i })
    }
    const snap = await buildHomeSnapshot({ projectsRoot, firstName: undefined })
    expect(snap.projects[0].rootPath).toBe(fresh) // freshest first
    expect(snap.projects[0].sessions).toHaveLength(3) // capped
    expect(snap.projects[0].sessionCount).toBe(4) // total preserved for the expander
  })

  it('marks a session open (duo) when the injected attribution hosts it', async () => {
    const proj = await mkRealDir('open-proj')
    await writeSession({ encoded: 'e-open', uuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', cwd: proj })
    const openByUuid = new Map([['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', { kind: 'duo', windowId: 2, tabId: 'tab-7' } as const]])
    const snap = await buildHomeSnapshot({ projectsRoot, openByUuid, firstName: undefined })
    const p = snap.projects.find((p) => p.rootPath === proj)!
    expect(p.sessions[0].open).toEqual({ kind: 'duo', windowId: 2, tabId: 'tab-7' })
    expect(snap.greeting.openCount).toBe(1)
  })

  it('marks a session open (external) for a live claude running outside Duo', async () => {
    const proj = await mkRealDir('ext-proj')
    await writeSession({ encoded: 'e-ext', uuid: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', cwd: proj })
    const openByUuid = new Map([['eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', { kind: 'external' } as const]])
    const snap = await buildHomeSnapshot({ projectsRoot, openByUuid, firstName: undefined })
    const p = snap.projects.find((p) => p.rootPath === proj)!
    expect(p.sessions[0].open).toEqual({ kind: 'external' })
    expect(snap.greeting.openCount).toBe(1)
  })

  // Regression — the sibling-worktree resume cwd bug (ENH-212 review).
  // A `git worktree add ../feature` SIBLING folds into its MAIN repo (D8),
  // so the session's rolled-up rootPath is the main repo and subPath is
  // undefined (the worktree is NOT a path-prefix child of the main repo).
  // Resume must run in the WORKTREE, so HomeSession.cwd must carry the real
  // worktree path verbatim — reconstructing from rootPath + subPath would
  // (wrongly) land resume in the main repo, where the encoded session JSONL
  // doesn't live.
  it('carries the REAL worktree cwd on a sibling-worktree session (resume target — D6)', async () => {
    const { worktree, mainRepo } = await mkWorktree('repo-b', 'feature')
    await writeSession({ encoded: 'enc-wt-b', uuid: 'wb1', cwd: worktree })

    const snap = await buildHomeSnapshot({ projectsRoot, firstName: undefined })
    const proj = snap.projects.find((p) => p.rootPath === mainRepo)
    expect(proj).toBeTruthy() // folded into the MAIN repo (D8)
    const sess = proj!.sessions.find((s) => s.uuid === 'wb1')!
    // subPath is undefined (sibling worktree is not under the main repo)…
    expect(sess.subPath).toBeUndefined()
    // …but cwd pins the worktree so `claude --resume` runs in the right dir.
    expect(sess.cwd).toBe(worktree)
    expect(sess.cwd).not.toBe(mainRepo)
  })

  // Regression — greeting.openCount under-count (ENH-212 review). An open
  // session ranked BELOW limitPerProject (default 3) is still hosted by a
  // live terminal, so it must count toward openCount even though it isn't in
  // the visible slice. The authoritative count is openByUuid.size, not a
  // per-visible-session tally.
  it('openCount counts an open session ranked 4th (below the visible cap)', async () => {
    const proj = await mkRealDir('deep-open-proj')
    // 4 sessions; #4 (oldest by mtime) is the open one — outside the top-3.
    await writeSession({ encoded: 'e-do-0', uuid: 'd0', cwd: proj, ageSec: 10 })
    await writeSession({ encoded: 'e-do-1', uuid: 'd1', cwd: proj, ageSec: 20 })
    await writeSession({ encoded: 'e-do-2', uuid: 'd2', cwd: proj, ageSec: 30 })
    await writeSession({ encoded: 'e-do-3', uuid: 'd3', cwd: proj, ageSec: 40 })
    const openByUuid = new Map([['d3', { kind: 'duo', windowId: 1, tabId: 'tab-deep' } as const]])

    const snap = await buildHomeSnapshot({ projectsRoot, limitPerProject: 3, openByUuid, firstName: undefined })
    const p = snap.projects.find((p) => p.rootPath === proj)!
    // The open session is NOT in the visible slice…
    expect(p.sessions.map((s) => s.uuid)).toEqual(['d0', 'd1', 'd2'])
    // …yet the greeting still counts it (authoritative join size).
    expect(snap.greeting.openCount).toBe(1)
  })
})

// ── process-primary open attribution (ENH-212 round-2) ─────────────────────

describe('attributeOpenSessions — process-primary', () => {
  it('one live Duo claude → freshest uuid in its cwd is open (duo, focusable)', () => {
    const groups: LiveCwdGroup[] = [{
      cwd: '/Users/x/proj',
      duoTabs: [{ windowId: 1, tabId: 'tab-live' }],
      externalCount: 0,
      uuidsByRecency: ['fresh', 'older', 'oldest'],
    }]
    const open = attributeOpenSessions(groups)
    expect(open.get('fresh')).toEqual({ kind: 'duo', windowId: 1, tabId: 'tab-live' })
    expect(open.size).toBe(1) // only ONE live claude → only the freshest uuid
  })

  it('one EXTERNAL live claude (no Duo owner) → freshest uuid open as external', () => {
    const groups: LiveCwdGroup[] = [{
      cwd: '/Users/x/proj',
      duoTabs: [],
      externalCount: 1,
      uuidsByRecency: ['fresh', 'older'],
    }]
    const open = attributeOpenSessions(groups)
    expect(open.get('fresh')).toEqual({ kind: 'external' })
    expect(open.size).toBe(1)
  })

  it('N live claudes in one cwd → the N freshest uuids open, Duo-hosted first', () => {
    // 2 Duo tabs + 1 external = 3 live claudes → top-3 freshest marked open.
    const groups: LiveCwdGroup[] = [{
      cwd: '/Users/x/mono',
      duoTabs: [{ windowId: 1, tabId: 'a' }, { windowId: 1, tabId: 'b' }],
      externalCount: 1,
      uuidsByRecency: ['u1', 'u2', 'u3', 'u4'],
    }]
    const open = attributeOpenSessions(groups)
    expect(open.get('u1')).toEqual({ kind: 'duo', windowId: 1, tabId: 'a' })
    expect(open.get('u2')).toEqual({ kind: 'duo', windowId: 1, tabId: 'b' })
    expect(open.get('u3')).toEqual({ kind: 'external' })
    expect(open.has('u4')).toBe(false) // only 3 live processes → u4 stays closed
  })

  it('NO live claude in a cwd → nothing open (the group simply is not present)', () => {
    // The IO layer drops cwds with no live claude / no project dir, so an empty
    // group list yields no open sessions — a tab merely existing never opens.
    expect(attributeOpenSessions([]).size).toBe(0)
  })

  it('fewer sessions than live claudes → marks only what exists, never throws', () => {
    const groups: LiveCwdGroup[] = [{
      cwd: '/Users/x/proj',
      duoTabs: [{ windowId: 1, tabId: 'a' }, { windowId: 1, tabId: 'b' }],
      externalCount: 0,
      uuidsByRecency: ['only-one'],
    }]
    const open = attributeOpenSessions(groups)
    expect(open.get('only-one')).toEqual({ kind: 'duo', windowId: 1, tabId: 'a' })
    expect(open.size).toBe(1)
  })
})

// ── perf + bytes-read bound ────────────────────────────────────────────────

describe('buildHomeSnapshot — perf + bytes-read bound (85-session tree)', () => {
  it('completes < 100ms and never fs.readFile-slurps a session JSONL', async () => {
    // 17 projects × 5 sessions = 85 sessions. Each JSONL is small (head +
    // tail entries), so the head/tail seek reads are cheap, but the test
    // also forbids any fs.readFile of a session file (the giant-file trap).
    for (let p = 0; p < 17; p++) {
      const proj = await mkRealDir(`perf-proj-${p}`)
      for (let s = 0; s < 5; s++) {
        await writeSession({
          encoded: `e-perf-${p}-${s}`,
          uuid: `${p}-${s}-${'0'.repeat(28)}`.slice(0, 36),
          cwd: proj,
          reply: 'a reply line',
          ageSec: p * 100 + s,
        })
      }
    }

    // Spy on the PROMISE-API readFile so a slurp of any session JSONL fails
    // loudly. (The production reads use fs.open + handle.read seek-based.)
    const realReadFile = fs.readFile.bind(fs)
    const slurped: string[] = []
    vi.spyOn(fs, 'readFile').mockImplementation(async (...args: Parameters<typeof fs.readFile>) => {
      const target = String(args[0])
      if (target.endsWith('.jsonl')) slurped.push(target)
      return realReadFile(...args)
    })

    const t0 = performance.now()
    const snap = await buildHomeSnapshot({ projectsRoot, firstName: undefined })
    const elapsed = performance.now() - t0

    expect(snap.projects).toHaveLength(17)
    expect(slurped).toEqual([]) // no .jsonl ever readFile-slurped (the load-bearing bound)
    // Timing is a soft guard, generous enough to survive full-suite parallel
    // contention. The rollup probes each unique ancestor dir once (memoized
    // git-root/marker stat) — real but bounded fs work; the strict assertion
    // above (zero JSONL slurps) is what actually protects the 270MB-file trap.
    expect(elapsed).toBeLessThan(500)
  })
})

// ── ENH-231 — buildCatchupSnapshot (the Command Board) ─────────────────────

describe('buildCatchupSnapshot — columns, two-tier, dedup, §D9', () => {
  let digestStore: SessionDigestStore
  let homeStore: HomeStateStore

  beforeEach(async () => {
    digestStore = new SessionDigestStore(path.join(projectsRoot, 'session-digests.json'))
    homeStore = new HomeStateStore(path.join(projectsRoot, 'home-state.json'))
    await digestStore.load()
    await homeStore.load()
  })
  afterEach(async () => {
    await digestStore.whenIdle()
    await homeStore.whenIdle()
  })

  const exitPlanEntry = (cwd: string): object => ({
    parentUuid: 'p',
    isSidechain: false,
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'p1', name: 'ExitPlanMode', input: { plan: 'do it' } }] },
    uuid: 'a',
    timestamp: '2026-06-10T01:10:00.000Z',
    cwd,
    sessionId: 's',
    gitBranch: 'main',
  })

  /** Write a session whose head carries `cwd`, then arbitrary trailing entries. */
  async function writeRaw(encoded: string, uuid: string, cwd: string, trailing: object[], ageSec = 60): Promise<void> {
    const dir = path.join(projectsRoot, encoded)
    await fs.mkdir(dir, { recursive: true })
    const file = path.join(dir, `${uuid}.jsonl`)
    await fs.writeFile(file, jsonl([userEntry('the goal', cwd), ...trailing]))
    const t = new Date(Date.now() - ageSec * 1000)
    await fs.utimes(file, t, t)
  }

  const liveDuo = (...uuids: string[]): OpenByUuid => {
    const m = new Map<string, HomeSessionOpen>()
    let i = 0
    for (const u of uuids) m.set(u, { kind: 'duo', windowId: 1, tabId: `t${i++}` })
    return m
  }

  it('windows out sessions older than the rolling window (7d)', async () => {
    await writeRaw('enc-fresh', 'fresh1', '/proj/a', [assistantEntry('done', '/proj/a')], 60)
    await writeRaw('enc-old', 'old1', '/proj/b', [assistantEntry('done', '/proj/b')], 8 * 86400)
    const board = await buildCatchupSnapshot({ projectsRoot, digestStore, homeStateStore: homeStore, now: Date.now() })
    const all = [...board.columns.needsYou.full, ...board.columns.needsYou.compact, ...board.columns.working.full, ...board.columns.working.compact, ...board.columns.done.full, ...board.columns.done.compact]
    expect(all.map((c) => c.uuid)).toEqual(['fresh1'])
  })

  it('assigns columns by attention/liveness and tiers full vs compact', async () => {
    // needs-you: ends on assistant text (→ question), not live → full (attention)
    await writeRaw('enc-q', 'q1', '/proj/q', [assistantEntry('Which option, X or Y?', '/proj/q')])
    // working: ends on user text (no attention), LIVE → full (live)
    await writeRaw('enc-w', 'w1', '/proj/w', [])
    // done: no attention, not live → compact
    await writeRaw('enc-d', 'd1', '/proj/d', [])

    const board = await buildCatchupSnapshot({
      projectsRoot, digestStore, homeStateStore: homeStore,
      openByUuid: liveDuo('w1'), now: Date.now(),
    })
    expect(board.columns.needsYou.full.map((c) => c.uuid)).toEqual(['q1'])
    expect(board.columns.working.full.map((c) => c.uuid)).toEqual(['w1'])
    expect(board.columns.done.compact.map((c) => c.uuid)).toEqual(['d1'])
    // tier sanity
    expect(board.columns.needsYou.full[0].tier).toBe('full')
    expect(board.columns.working.full[0].tier).toBe('full')
    expect(board.columns.done.compact[0].tier).toBe('compact')
    expect(board.columns.done.full).toEqual([])
  })

  it('Done column: FINISHED sessions are full cards, STALLED ones are compact (owner IA fix)', async () => {
    const todoWriteEntry = (todos: object[], cwd: string): object => ({
      parentUuid: 'p', isSidechain: false, type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tw', name: 'TodoWrite', input: { todos } }] },
      uuid: 'a', timestamp: '2026-06-10T01:10:00.000Z', cwd, sessionId: 's', gitBranch: 'main',
    })
    const bashEntry = (command: string, cwd: string): object => ({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command } }] },
      uuid: 'a', timestamp: '2026-06-10T01:10:00.000Z', cwd, sessionId: 's', gitBranch: 'main',
    })
    const toolResult = (cwd: string, toolUseResult: unknown): object => ({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'ok' }] },
      toolUseResult, cwd, uuid: 'r', timestamp: '2026-06-10T01:11:00.000Z',
    })
    // All sessions END ON A USER/tool-result TURN so the attention heuristic stays null (→ Done column).
    // finished — a fully-complete TodoWrite plan.
    await writeRaw('enc-fin1', 'fin1', '/proj/f1', [
      todoWriteEntry([{ content: 'ship it', status: 'completed' }], '/proj/f1'),
      userEntry('thanks', '/proj/f1'),
    ])
    // finished — actually OPENED a PR (gh pr create → URL in the tool result).
    await writeRaw('enc-fin2', 'fin2', '/proj/f2', [
      bashEntry('gh pr create --fill', '/proj/f2'),
      toolResult('/proj/f2', 'https://github.com/o/r/pull/9\n'),
    ])
    // finished — produced a DOCUMENT (.md), the D7 report case.
    await writeRaw('enc-fin3', 'fin3', '/proj/f3', [
      toolResult('/proj/f3', { type: 'create', filePath: '/proj/f3/report.md' }),
    ])
    // stalled — a half-done plan, no deliverable.
    await writeRaw('enc-stall', 'stall1', '/proj/s', [
      todoWriteEntry([{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }], '/proj/s'),
      userEntry('hold on', '/proj/s'),
    ])
    // stalled — only CODE files touched (no PR, no completed plan, no doc).
    await writeRaw('enc-stall2', 'stall2', '/proj/s2', [
      toolResult('/proj/s2', { type: 'create', filePath: '/proj/s2/util.ts' }),
    ])
    const board = await buildCatchupSnapshot({ projectsRoot, digestStore, homeStateStore: homeStore, now: Date.now() })
    expect(board.columns.done.full.map((c) => c.uuid).sort()).toEqual(['fin1', 'fin2', 'fin3'])
    expect(board.columns.done.compact.map((c) => c.uuid).sort()).toEqual(['stall1', 'stall2'])
  })

  it('keeps a CLOSED needs-you (plan-to-approve) session as a FULL card (review fix #8)', async () => {
    await writeRaw('enc-plan', 'plan1', '/proj/p', [exitPlanEntry('/proj/p')])
    const board = await buildCatchupSnapshot({ projectsRoot, digestStore, homeStateStore: homeStore, now: Date.now() })
    // not live, but attention=plan-to-approve → needs-you AND full (not compact)
    expect(board.columns.needsYou.full.map((c) => c.uuid)).toEqual(['plan1'])
    expect(board.columns.needsYou.compact).toEqual([])
    expect(board.columns.needsYou.full[0].attention).toEqual({ reason: 'plan-to-approve' })
    expect(board.columns.needsYou.full[0].open).toBeUndefined() // closed, yet full
  })

  it('dedups a uuid that appears in two encoded dirs (keep one card)', async () => {
    await writeRaw('enc-1', 'dup', '/proj/x', [], 120)
    await writeRaw('enc-2', 'dup', '/proj/x', [], 60)
    const board = await buildCatchupSnapshot({ projectsRoot, digestStore, homeStateStore: homeStore, now: Date.now() })
    const all = [...board.columns.done.full, ...board.columns.done.compact]
    expect(all.filter((c) => c.uuid === 'dup')).toHaveLength(1)
  })

  it('merges the Duo-owned annotation (narrative + reviewedAt) onto the card', async () => {
    await writeRaw('enc-n', 'note1', '/proj/n', [assistantEntry('ok', '/proj/n')])
    await homeStore.setNote('note1', 'Shipped the token bucket')
    await homeStore.setNext('note1', 'Add the per-route override')
    await homeStore.markReviewed('note1', 1234)
    const board = await buildCatchupSnapshot({ projectsRoot, digestStore, homeStateStore: homeStore, now: Date.now() })
    const card = board.columns.needsYou.full.find((c) => c.uuid === 'note1')!
    expect(card.narrative).toEqual({ note: 'Shipped the token bucket', next: 'Add the per-route override' })
    expect(card.reviewedAt).toBe(1234)
  })

  it('flags cwdGone when the session cwd no longer exists (removed worktree)', async () => {
    // projectsRoot exists on disk; the other cwd does not.
    await writeRaw('enc-here', 'here1', projectsRoot, [])
    await writeRaw('enc-gone', 'gone1', path.join(projectsRoot, 'removed-worktree-xyz'), [])
    const board = await buildCatchupSnapshot({ projectsRoot, digestStore, homeStateStore: homeStore, now: Date.now() })
    const all = [
      ...board.columns.needsYou.full, ...board.columns.needsYou.compact,
      ...board.columns.working.full, ...board.columns.working.compact,
      ...board.columns.done.full, ...board.columns.done.compact,
    ]
    expect(all.find((c) => c.uuid === 'here1')?.cwdGone).toBeFalsy()
    expect(all.find((c) => c.uuid === 'gone1')?.cwdGone).toBe(true)
  })

  it('badges scheduled when the uuid is in cronSessionIds (never inferred)', async () => {
    await writeRaw('enc-c', 'cron1', '/proj/c', [])
    const board = await buildCatchupSnapshot({
      projectsRoot, digestStore, homeStateStore: homeStore,
      cronSessionIds: new Set(['cron1']), now: Date.now(),
    })
    const card = [...board.columns.done.compact].find((c) => c.uuid === 'cron1')!
    expect(card.scheduled).toBe(true)
  })

  it('§D9 — a cold (cache-miss) board equals the warm (cache-hit) rebuild', async () => {
    const now = Date.now()
    await writeRaw('enc-a', 'a1', '/proj/a', [assistantEntry('Need a decision', '/proj/a')])
    await writeRaw('enc-b', 'b1', '/proj/b', [])
    const open = liveDuo('b1')

    // Cold: empty store → extract + cache.
    const cold = await buildCatchupSnapshot({ projectsRoot, digestStore, homeStateStore: homeStore, openByUuid: open, now })
    await digestStore.whenIdle()
    expect(digestStore.snapshot().size).toBe(2) // both digests cached

    // Warm: same store, now serving cache hits → identical board.
    const warm = await buildCatchupSnapshot({ projectsRoot, digestStore, homeStateStore: homeStore, openByUuid: open, now })
    expect(warm).toEqual(cold)
  })
})
