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
  rollupProjects,
  scanRecentFiles,
  buildGreeting,
  joinOpenSessions,
  type LivePtyForJoin,
  type PersistedPointer,
} from './home-snapshot'
import { hashColorIndex } from '../shared/projects'
import type { HomeProject } from '../shared/types'

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

  it('folds a nested cwd into the shallowest enclosing real root (prefix fold)', async () => {
    const outer = await mkRealDir('proj-outer')
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

  it('keeps SIBLING roots separate (neither is an ancestor of the other)', async () => {
    const a = await mkRealDir('sib-a')
    const b = await mkRealDir('sib-b')
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
    const outer = await mkRealDir('badge-outer')
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

  it('marks a session open when the injected join attributes it', async () => {
    const proj = await mkRealDir('open-proj')
    await writeSession({ encoded: 'e-open', uuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', cwd: proj })
    const openByUuid = new Map([['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', { windowId: 2, tabId: 'tab-7' }]])
    const snap = await buildHomeSnapshot({ projectsRoot, openByUuid, firstName: undefined })
    const p = snap.projects.find((p) => p.rootPath === proj)!
    expect(p.sessions[0].open).toEqual({ windowId: 2, tabId: 'tab-7' })
    expect(snap.greeting.openCount).toBe(1)
  })

  it('surfaces unattributedLiveCwds when supplied', async () => {
    const proj = await mkRealDir('guard-proj')
    await writeSession({ encoded: 'e-guard', uuid: 'g1', cwd: proj })
    const snap = await buildHomeSnapshot({ projectsRoot, unattributedLiveCwds: ['/tmp/external'], firstName: undefined })
    expect(snap.unattributedLiveCwds).toEqual(['/tmp/external'])
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
    const openByUuid = new Map([['d3', { windowId: 1, tabId: 'tab-deep' }]])

    const snap = await buildHomeSnapshot({ projectsRoot, limitPerProject: 3, openByUuid, firstName: undefined })
    const p = snap.projects.find((p) => p.rootPath === proj)!
    // The open session is NOT in the visible slice…
    expect(p.sessions.map((s) => s.uuid)).toEqual(['d0', 'd1', 'd2'])
    // …yet the greeting still counts it (authoritative join size).
    expect(snap.greeting.openCount).toBe(1)
  })
})

// ── open-session join (D13) — pointer hit / stale / NO mtime leg ───────────

describe('joinOpenSessions — D13 evidence-gated', () => {
  const POINTER: PersistedPointer = { windowId: 1, cwd: '/Users/x/proj', uuid: 'uuid-a' }

  it('pointer HIT — a live PTY at the pointer cwd in the same window attributes the uuid to the LIVE tab id', () => {
    const live: LivePtyForJoin[] = [{ tabId: 'tab-live', cwd: '/Users/x/proj', windowId: 1 }]
    const open = joinOpenSessions(live, [POINTER])
    expect(open.get('uuid-a')).toEqual({ windowId: 1, tabId: 'tab-live' })
  })

  it('STALE pointer — no live PTY at that cwd ⇒ the session is CLOSED (no entry)', () => {
    // The tab that captured the pointer has been closed; no live PTY matches.
    const open = joinOpenSessions([], [POINTER])
    expect(open.has('uuid-a')).toBe(false)
    expect(open.size).toBe(0)
  })

  it('live PTY at a DIFFERENT cwd does not match (cwd is part of the evidence)', () => {
    const live: LivePtyForJoin[] = [{ tabId: 'tab-live', cwd: '/Users/x/other', windowId: 1 }]
    expect(joinOpenSessions(live, [POINTER]).size).toBe(0)
  })

  it('live PTY in a DIFFERENT window does not match (window is part of the evidence)', () => {
    const live: LivePtyForJoin[] = [{ tabId: 'tab-live', cwd: '/Users/x/proj', windowId: 2 }]
    expect(joinOpenSessions(live, [POINTER]).size).toBe(0)
  })

  it('NO mtime leg — a live PTY with NO captured pointer is NEVER joined (D13 banned heuristic)', () => {
    // A live shell sitting in a project cwd whose newest jsonl was touched
    // seconds ago must NOT be inferred as open: there is no pointer for it.
    const live: LivePtyForJoin[] = [{ tabId: 'tab-live', cwd: '/Users/x/proj', windowId: 1 }]
    // Pointers carry NO mtime field — the join has no way to use one.
    const open = joinOpenSessions(live, [])
    expect(open.size).toBe(0)
  })

  it('null live cwd (lsof failed) does not match', () => {
    const live: LivePtyForJoin[] = [{ tabId: 'tab-live', cwd: null, windowId: 1 }]
    expect(joinOpenSessions(live, [POINTER]).size).toBe(0)
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
    expect(slurped).toEqual([]) // no .jsonl ever readFile-slurped
    expect(elapsed).toBeLessThan(100)
  })
})
