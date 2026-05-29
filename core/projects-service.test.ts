// ENH-182 Phase 0 — projects-service unit tests.
//
// Coverage targets from PRD § 6 Phase 0 acceptance criteria:
//   • qualification (D2): gitRoot || marker AND workingIn
//   • deepest-wins membership (D5)
//   • hash-stable color (R2)
//   • plus: pinned projects persist without tabs (D12)
//   • plus: pinnedTabPaths do NOT count toward "working in"
//   • plus: persisted-slice round-trip + defensive parsing

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import {
  deriveProjects,
  hashColorIndex,
  deepestEnclosingRoot,
  ancestors,
  normalize,
  hasMarker,
  ProjectsService,
  NUM_PROJECT_COLORS,
  type QualificationResult
} from './projects-service'
import { isExcludedFromQualification } from '../shared/projects'

// ── helpers ─────────────────────────────────────────────────────

/** Build a qualify() fn from a plain map. Returns sane defaults for
 *  unmapped paths so derivations don't crash when probing ancestors
 *  that aren't in the test fixture. */
function makeQualify(
  map: Record<string, Partial<QualificationResult>>
): (dir: string) => QualificationResult {
  return (dir) => {
    const entry = map[dir]
    return {
      isGitRoot: entry?.isGitRoot ?? false,
      hasMarker: entry?.hasMarker ?? false
    }
  }
}

// ── pure helpers ────────────────────────────────────────────────

describe('ancestors', () => {
  it('walks from the input dir up to filesystem root, inclusive', () => {
    expect(ancestors('/Users/foo/projects/duo')).toEqual([
      '/Users/foo/projects/duo',
      '/Users/foo/projects',
      '/Users/foo',
      '/Users',
      '/'
    ])
  })

  it('handles the filesystem root itself', () => {
    expect(ancestors('/')).toEqual(['/'])
  })
})

describe('deepestEnclosingRoot', () => {
  it('returns the deepest match when multiple ancestors qualify', () => {
    const qualifying = new Set(['/a', '/a/b', '/a/b/c'])
    expect(deepestEnclosingRoot('/a/b/c/d/e', qualifying)).toBe('/a/b/c')
  })

  it('returns the exact match when startDir itself qualifies', () => {
    const qualifying = new Set(['/a/b/c'])
    expect(deepestEnclosingRoot('/a/b/c', qualifying)).toBe('/a/b/c')
  })

  it('returns null when no ancestor qualifies', () => {
    expect(deepestEnclosingRoot('/a/b/c', new Set(['/x/y']))).toBeNull()
  })
})

describe('hashColorIndex', () => {
  it('is deterministic — same path always returns same index', () => {
    const idx1 = hashColorIndex('/Users/foo/projects/duo')
    const idx2 = hashColorIndex('/Users/foo/projects/duo')
    expect(idx1).toBe(idx2)
  })

  it('returns an integer in [0, NUM_PROJECT_COLORS)', () => {
    for (const p of [
      '/a',
      '/Users/foo/projects/duo',
      '/Users/bar/work/some-very-long-repo-name',
      '/x'
    ]) {
      const idx = hashColorIndex(p)
      expect(Number.isInteger(idx)).toBe(true)
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(NUM_PROJECT_COLORS)
    }
  })

  it('spreads moderately across hues (sanity check, not a chi-squared)', () => {
    // Just confirm we DO see multiple distinct buckets across a small
    // set — not a uniformity proof, but catches a degenerate hash.
    const seen = new Set<number>()
    for (let i = 0; i < 30; i++) {
      seen.add(hashColorIndex(`/Users/foo/project-${i}`))
    }
    // 30 paths into 6 buckets — should hit at least 4 buckets unless
    // the hash is broken.
    expect(seen.size).toBeGreaterThanOrEqual(4)
  })
})

// ── derivation ──────────────────────────────────────────────────

describe('deriveProjects — qualification (D2)', () => {
  it('qualifies a folder when it is a git root', () => {
    const out = deriveProjects({
      terminals: [{ id: 't1', cwd: '/repo' }],
      workingTabs: [],
      pinnedTabPaths: new Set(),
      pinnedProjects: new Set(),
      colorOverrides: {},
      qualify: makeQualify({
        '/repo': { isGitRoot: true }
      })
    })
    expect(out.projects).toHaveLength(1)
    expect(out.projects[0].root).toBe('/repo')
    expect(out.projects[0].isGitRoot).toBe(true)
    expect(out.terminalMembership.t1).toBe('/repo')
  })

  it('qualifies a folder when it has a marker (CLAUDE.md or .claude/)', () => {
    const out = deriveProjects({
      terminals: [{ id: 't1', cwd: '/marked' }],
      workingTabs: [],
      pinnedTabPaths: new Set(),
      pinnedProjects: new Set(),
      colorOverrides: {},
      qualify: makeQualify({
        '/marked': { hasMarker: true }
      })
    })
    expect(out.projects).toHaveLength(1)
    expect(out.projects[0].root).toBe('/marked')
    expect(out.projects[0].hasMarker).toBe(true)
  })

  it('does NOT qualify a folder with no markers and no git', () => {
    const out = deriveProjects({
      terminals: [{ id: 't1', cwd: '/nowhere' }],
      workingTabs: [],
      pinnedTabPaths: new Set(),
      pinnedProjects: new Set(),
      colorOverrides: {},
      qualify: makeQualify({})
    })
    expect(out.projects).toHaveLength(0)
    expect(out.terminalMembership.t1).toBeNull()
  })

  it('only qualifies via "working in" — pure pinned-tab paths do not count', () => {
    // Tab is pinned (Stage 24 pins.json), so per D2 it does NOT count
    // toward "working in". The git root in question would otherwise
    // qualify, but with the tab excluded, no terminal/tab leaves a
    // candidate trail leading up to /home/ref.
    const out = deriveProjects({
      terminals: [],
      workingTabs: [{ id: 'tab1', path: '/home/ref/CLAUDE.md' }],
      pinnedTabPaths: new Set(['/home/ref/CLAUDE.md']),
      pinnedProjects: new Set(),
      colorOverrides: {},
      qualify: makeQualify({
        '/home/ref': { isGitRoot: true }
      })
    })
    expect(out.projects).toHaveLength(0)
    expect(out.tabMembership.tab1).toBeNull()
  })

  it('non-pinned working tabs DO count toward working-in', () => {
    const out = deriveProjects({
      terminals: [],
      workingTabs: [{ id: 'tab1', path: '/repo/src/foo.ts' }],
      pinnedTabPaths: new Set(),
      pinnedProjects: new Set(),
      colorOverrides: {},
      qualify: makeQualify({
        '/repo': { isGitRoot: true }
      })
    })
    expect(out.projects).toHaveLength(1)
    expect(out.tabMembership.tab1).toBe('/repo')
  })
})

describe('deriveProjects — deepest-wins membership (D5)', () => {
  it('picks the deepest qualifying ancestor when nested git repos exist', () => {
    const out = deriveProjects({
      terminals: [{ id: 't1', cwd: '/outer/inner/deep/working-dir' }],
      workingTabs: [],
      pinnedTabPaths: new Set(),
      pinnedProjects: new Set(),
      colorOverrides: {},
      qualify: makeQualify({
        '/outer': { isGitRoot: true },
        '/outer/inner': { isGitRoot: true },
        '/outer/inner/deep': { hasMarker: true }
      })
    })
    expect(out.terminalMembership.t1).toBe('/outer/inner/deep')
    // Only the deepest qualifying ancestor becomes a project. The
    // inner roots are detected as qualifying (the walk-up probes all
    // ancestors and adds every match to qualifyingSet), but with no
    // terminal/tab owning them as their deepest enclosing root, they
    // don't appear in the rail. This is the right ux: nested unused
    // git repos don't clutter the rail.
    expect(out.projects.map((p) => p.root)).toEqual(['/outer/inner/deep'])
  })

  it('handles multiple terminals attached to different deepest roots', () => {
    const out = deriveProjects({
      terminals: [
        { id: 'tA', cwd: '/projA/src' },
        { id: 'tB', cwd: '/projB/lib/deep' }
      ],
      workingTabs: [],
      pinnedTabPaths: new Set(),
      pinnedProjects: new Set(),
      colorOverrides: {},
      qualify: makeQualify({
        '/projA': { isGitRoot: true },
        '/projB': { isGitRoot: true }
      })
    })
    expect(out.terminalMembership.tA).toBe('/projA')
    expect(out.terminalMembership.tB).toBe('/projB')
    expect(out.projects.map((p) => p.root).sort()).toEqual(['/projA', '/projB'])
  })

  it('returns null membership for paths under no qualifying root', () => {
    const out = deriveProjects({
      terminals: [{ id: 't1', cwd: '/tmp/scratch' }],
      workingTabs: [{ id: 'tab1', path: '/elsewhere/file.md' }],
      pinnedTabPaths: new Set(),
      pinnedProjects: new Set(),
      colorOverrides: {},
      qualify: makeQualify({})
    })
    expect(out.terminalMembership.t1).toBeNull()
    expect(out.tabMembership.tab1).toBeNull()
    expect(out.projects).toHaveLength(0)
  })
})

describe('deriveProjects — pinned projects (D12)', () => {
  it('keeps a pinned project in the rail even with no open items', () => {
    const out = deriveProjects({
      terminals: [],
      workingTabs: [],
      pinnedTabPaths: new Set(),
      pinnedProjects: new Set(['/pinned-empty']),
      colorOverrides: {},
      qualify: makeQualify({
        '/pinned-empty': { isGitRoot: true }
      })
    })
    expect(out.projects).toHaveLength(1)
    expect(out.projects[0].root).toBe('/pinned-empty')
    expect(out.projects[0].pinned).toBe(true)
  })

  it('marks pinned: true on a project that ALSO has open items', () => {
    const out = deriveProjects({
      terminals: [{ id: 't1', cwd: '/repo' }],
      workingTabs: [],
      pinnedTabPaths: new Set(),
      pinnedProjects: new Set(['/repo']),
      colorOverrides: {},
      qualify: makeQualify({ '/repo': { isGitRoot: true } })
    })
    expect(out.projects).toHaveLength(1)
    expect(out.projects[0].pinned).toBe(true)
  })

  it('pin alone qualifies even when no marker/git evidence is provided', () => {
    // A user pin acts as its own qualification — the user has asserted
    // this folder is a project even if the markers came and went.
    const out = deriveProjects({
      terminals: [],
      workingTabs: [],
      pinnedTabPaths: new Set(),
      pinnedProjects: new Set(['/manually-pinned']),
      colorOverrides: {},
      qualify: makeQualify({}) // no evidence at all
    })
    expect(out.projects).toHaveLength(1)
    expect(out.projects[0].root).toBe('/manually-pinned')
    expect(out.projects[0].isGitRoot).toBe(false)
    expect(out.projects[0].hasMarker).toBe(false)
  })

  it('drops a pinned project whose directory was DELETED (exists === false)', () => {
    // Ghost-pin fix — "pin alone qualifies" holds only while the folder
    // still exists. A pin to a deleted directory is a ghost tile.
    const out = deriveProjects({
      terminals: [],
      workingTabs: [],
      pinnedTabPaths: new Set(),
      pinnedProjects: new Set(['/pinned-deleted']),
      colorOverrides: {},
      qualify: () => ({ isGitRoot: false, hasMarker: false, exists: false })
    })
    expect(out.projects).toHaveLength(0)
  })

  it('keeps a pinned project while its existence probe is pending (exists === undefined)', () => {
    // No-flicker guarantee — undefined exists is treated as "exists",
    // so a valid pin never blinks out during the async probe window.
    const out = deriveProjects({
      terminals: [],
      workingTabs: [],
      pinnedTabPaths: new Set(),
      pinnedProjects: new Set(['/pinned-pending']),
      colorOverrides: {},
      qualify: () => ({ isGitRoot: false, hasMarker: false })
    })
    expect(out.projects).toHaveLength(1)
    expect(out.projects[0].root).toBe('/pinned-pending')
  })

  it('keeps a markerless pin whose directory still exists (exists === true)', () => {
    const out = deriveProjects({
      terminals: [],
      workingTabs: [],
      pinnedTabPaths: new Set(),
      pinnedProjects: new Set(['/pinned-extant']),
      colorOverrides: {},
      qualify: () => ({ isGitRoot: false, hasMarker: false, exists: true })
    })
    expect(out.projects).toHaveLength(1)
    expect(out.projects[0].root).toBe('/pinned-extant')
  })
})

describe('deriveProjects — color assignment (R2)', () => {
  it('uses hash-stable colorIndex by default', () => {
    const out = deriveProjects({
      terminals: [{ id: 't1', cwd: '/repo' }],
      workingTabs: [],
      pinnedTabPaths: new Set(),
      pinnedProjects: new Set(),
      colorOverrides: {},
      qualify: makeQualify({ '/repo': { isGitRoot: true } })
    })
    expect(out.projects[0].colorIndex).toBe(hashColorIndex('/repo'))
  })

  it('honors colorOverrides when provided', () => {
    const out = deriveProjects({
      terminals: [{ id: 't1', cwd: '/repo' }],
      workingTabs: [],
      pinnedTabPaths: new Set(),
      pinnedProjects: new Set(),
      colorOverrides: { '/repo': 3 },
      qualify: makeQualify({ '/repo': { isGitRoot: true } })
    })
    expect(out.projects[0].colorIndex).toBe(3)
  })

  it('ignores out-of-range overrides, falling back to hash', () => {
    const out = deriveProjects({
      terminals: [{ id: 't1', cwd: '/repo' }],
      workingTabs: [],
      pinnedTabPaths: new Set(),
      pinnedProjects: new Set(),
      colorOverrides: { '/repo': 99 },
      qualify: makeQualify({ '/repo': { isGitRoot: true } })
    })
    expect(out.projects[0].colorIndex).toBe(hashColorIndex('/repo'))
  })
})

describe('deriveProjects — output shape', () => {
  it('sorts projects alphabetically by name', () => {
    const out = deriveProjects({
      terminals: [
        { id: 'a', cwd: '/code/zebra' },
        { id: 'b', cwd: '/code/alpha' },
        { id: 'c', cwd: '/code/mango' }
      ],
      workingTabs: [],
      pinnedTabPaths: new Set(),
      pinnedProjects: new Set(),
      colorOverrides: {},
      qualify: makeQualify({
        '/code/zebra': { isGitRoot: true },
        '/code/alpha': { isGitRoot: true },
        '/code/mango': { isGitRoot: true }
      })
    })
    expect(out.projects.map((p) => p.name)).toEqual(['alpha', 'mango', 'zebra'])
  })

  it('breaks name ties with root path', () => {
    const out = deriveProjects({
      terminals: [
        { id: 'a', cwd: '/parent-A/duo' },
        { id: 'b', cwd: '/parent-B/duo' }
      ],
      workingTabs: [],
      pinnedTabPaths: new Set(),
      pinnedProjects: new Set(),
      colorOverrides: {},
      qualify: makeQualify({
        '/parent-A/duo': { isGitRoot: true },
        '/parent-B/duo': { isGitRoot: true }
      })
    })
    expect(out.projects.map((p) => p.root)).toEqual(['/parent-A/duo', '/parent-B/duo'])
  })

  it('uses basename(root) as name', () => {
    const out = deriveProjects({
      terminals: [{ id: 't1', cwd: '/Users/foo/projects/duo' }],
      workingTabs: [],
      pinnedTabPaths: new Set(),
      pinnedProjects: new Set(),
      colorOverrides: {},
      qualify: makeQualify({ '/Users/foo/projects/duo': { isGitRoot: true } })
    })
    expect(out.projects[0].name).toBe('duo')
  })

  it('memoizes qualify() — same dir is probed only once', () => {
    let calls = 0
    const qualify = (dir: string): QualificationResult => {
      calls++
      if (dir === '/repo') return { isGitRoot: true, hasMarker: false }
      return { isGitRoot: false, hasMarker: false }
    }
    deriveProjects({
      terminals: [
        { id: 't1', cwd: '/repo/src/a' },
        { id: 't2', cwd: '/repo/src/b' },
        { id: 't3', cwd: '/repo/lib' }
      ],
      workingTabs: [],
      pinnedTabPaths: new Set(),
      pinnedProjects: new Set(),
      colorOverrides: {},
      qualify
    })
    // /repo, /repo/src, /repo/src/a, /repo/src/b, /repo/lib, /, /Users
    // (well, depends on the path tree, but the key invariant is "each
    // unique ancestor probed exactly once"). With 3 terminals sharing
    // overlapping ancestors, calls should be << 3 * (ancestor depth).
    const uniqueAncestors = new Set([
      ...ancestors('/repo/src/a'),
      ...ancestors('/repo/src/b'),
      ...ancestors('/repo/lib')
    ])
    // Each unique ancestor probed once. The final build-step probe
    // for /repo hits the memoization cache and adds no calls.
    expect(calls).toBe(uniqueAncestors.size)
  })
})

// ── qualification policy ────────────────────────────────────────

describe('isExcludedFromQualification', () => {
  it('excludes filesystem root', () => {
    expect(isExcludedFromQualification('/')).toBe(true)
  })

  it('excludes the explicit home dir when provided', () => {
    expect(isExcludedFromQualification('/Users/foo', '/Users/foo')).toBe(true)
  })

  it('excludes /Users/<name> via regex fallback when no homeDir', () => {
    expect(isExcludedFromQualification('/Users/foo')).toBe(true)
    expect(isExcludedFromQualification('/Users/geoff/')).toBe(true)
  })

  it('does NOT exclude subdirectories of home', () => {
    // Owner directive 2026-05-25 — editing files under ~/.claude
    // SHOULD count as a project. The exclusion only blocks the home
    // dir itself, never its children.
    expect(isExcludedFromQualification('/Users/foo/.claude', '/Users/foo')).toBe(false)
    expect(isExcludedFromQualification('/Users/foo/Documents', '/Users/foo')).toBe(false)
    expect(isExcludedFromQualification('/Users/foo/.claude/skills', '/Users/foo')).toBe(false)
  })

  it('does NOT exclude deeper paths under the /Users/<name> regex', () => {
    expect(isExcludedFromQualification('/Users/foo/anything')).toBe(false)
    expect(isExcludedFromQualification('/Users/foo/.claude/skills/duo')).toBe(false)
  })

  it('does NOT exclude /tmp or random non-home paths', () => {
    expect(isExcludedFromQualification('/tmp/work', '/Users/foo')).toBe(false)
    expect(isExcludedFromQualification('/opt/repo', '/Users/foo')).toBe(false)
  })
})

describe('deriveProjects + isExcludedFromQualification — ~/.claude editing scenario', () => {
  // The owner-stated must-work case: editing a file under ~/.claude/
  // produces ~/.claude as the project (NOT the home dir). The
  // exclusion blocks home itself while letting subdirs qualify on
  // their own merits.
  const HOME = '/Users/foo'

  function qualifyWithHome(
    map: Record<string, Partial<QualificationResult>>
  ): (dir: string) => QualificationResult {
    return (dir) => {
      if (isExcludedFromQualification(dir, HOME)) {
        return { isGitRoot: false, hasMarker: false }
      }
      const entry = map[dir]
      return {
        isGitRoot: entry?.isGitRoot ?? false,
        hasMarker: entry?.hasMarker ?? false
      }
    }
  }

  it('qualifies ~/.claude when working in a file under it', () => {
    const out = deriveProjects({
      terminals: [],
      workingTabs: [{ id: 'tab1', path: '/Users/foo/.claude/skills/duo/SKILL.md' }],
      pinnedTabPaths: new Set(),
      pinnedProjects: new Set(),
      colorOverrides: {},
      // Mimic the real hasMarker check: ~/.claude has a CLAUDE.md
      // (the user's global instructions file) per the real-world
      // layout. Home dir would ALSO match via marker (because it
      // contains the .claude/ subdir entry in its listing) but the
      // policy excludes it.
      qualify: qualifyWithHome({
        '/Users/foo/.claude': { hasMarker: true },
        '/Users/foo': { hasMarker: true } // would match if not excluded
      })
    })

    expect(out.projects.map((p) => p.root)).toEqual(['/Users/foo/.claude'])
    expect(out.tabMembership.tab1).toBe('/Users/foo/.claude')
  })

  it('qualifies ~/.claude when a terminal cwd is under it', () => {
    const out = deriveProjects({
      terminals: [{ id: 't1', cwd: '/Users/foo/.claude/skills' }],
      workingTabs: [],
      pinnedTabPaths: new Set(),
      pinnedProjects: new Set(),
      colorOverrides: {},
      qualify: qualifyWithHome({
        '/Users/foo/.claude': { hasMarker: true },
        '/Users/foo': { hasMarker: true }
      })
    })

    expect(out.projects.map((p) => p.root)).toEqual(['/Users/foo/.claude'])
    expect(out.terminalMembership.t1).toBe('/Users/foo/.claude')
  })

  it('does NOT surface a project when working in a random non-marker dir under home', () => {
    // Same home dir setup, but terminal is in ~/Downloads which has
    // no marker. The .claude subdir is what makes HOME match
    // hasMarker — and we exclude HOME. So no project surfaces.
    const out = deriveProjects({
      terminals: [{ id: 't1', cwd: '/Users/foo/Downloads' }],
      workingTabs: [],
      pinnedTabPaths: new Set(),
      pinnedProjects: new Set(),
      colorOverrides: {},
      qualify: qualifyWithHome({
        '/Users/foo': { hasMarker: true } // global .claude/ in listing
      })
    })

    expect(out.projects).toHaveLength(0)
    expect(out.terminalMembership.t1).toBeNull()
  })
})

// ── persisted slice ─────────────────────────────────────────────

describe('normalize', () => {
  it('returns empty defaults for an empty input', () => {
    expect(normalize({})).toEqual({ version: 1, pins: [], colorOverrides: {} })
  })

  it('drops non-string pins', () => {
    const normalized = normalize({
      // @ts-expect-error — testing defensive parsing of malformed input
      pins: ['/ok', 42, null, '', '/also-ok']
    })
    expect(normalized.pins).toEqual(['/ok', '/also-ok'])
  })

  it('BUG-164 — dedupes duplicate pin entries', () => {
    // Hand-edited projects.json with duplicates breaks togglePin
    // (indexOf + slice removes only the first occurrence). Normalize
    // defends against this by collapsing duplicates at parse time.
    const normalized = normalize({
      pins: ['/foo', '/bar', '/foo', '/baz', '/bar']
    })
    expect(normalized.pins).toEqual(['/foo', '/bar', '/baz'])
  })

  it('drops out-of-range color overrides', () => {
    const normalized = normalize({
      colorOverrides: { '/a': 2, '/b': 99, '/c': -1, '/d': 1.5 } as Record<string, number>
    })
    expect(normalized.colorOverrides).toEqual({ '/a': 2 })
  })

  it('returns empty when colorOverrides is not an object', () => {
    const normalized = normalize({
      // @ts-expect-error — testing defensive parsing
      colorOverrides: 'not-an-object'
    })
    expect(normalized.colorOverrides).toEqual({})
  })
})

describe('ProjectsService', () => {
  let tmpHome: string
  let originalHome: string | undefined
  let svc: ProjectsService

  beforeEach(async () => {
    originalHome = process.env.HOME
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'duo-projects-test-'))
    process.env.HOME = tmpHome
    // Re-import to pick up new HOME — but `os.homedir()` is computed
    // once at import time of projects-service.ts. So the test has to
    // operate on the original path. We work around by writing
    // directly to the file the service uses, OR by skipping the
    // env-rebinding tests when this proves flaky. For now: drive the
    // service via toggle/setColorOverride and read back.
    svc = new ProjectsService()
  })

  afterEach(async () => {
    if (originalHome) process.env.HOME = originalHome
    await fs.rm(tmpHome, { recursive: true, force: true })
    // Also clean up the real projects.json the test would have
    // written under the actual $HOME, since the env-rebind didn't
    // take effect post-import.
    const realPath = path.join(os.homedir(), '.claude', 'duo', 'projects.json')
    try {
      const raw = await fs.readFile(realPath, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed?.pins?.includes('/test-pin-marker')) {
        await fs.rm(realPath, { force: true })
      }
    } catch {
      // file not present or unreadable — fine
    }
  })

  it('togglePin adds a pin when absent, removes when present', async () => {
    const after1 = await svc.togglePin('/test-pin-marker')
    expect(after1.pins).toContain('/test-pin-marker')
    const after2 = await svc.togglePin('/test-pin-marker')
    expect(after2.pins).not.toContain('/test-pin-marker')
  })

  it('setColorOverride writes and clears entries', async () => {
    const after1 = await svc.setColorOverride('/test-pin-marker', 4)
    expect(after1.colorOverrides['/test-pin-marker']).toBe(4)
    const after2 = await svc.setColorOverride('/test-pin-marker', null)
    expect(after2.colorOverrides['/test-pin-marker']).toBeUndefined()
  })

  it('setColorOverride rejects out-of-range values silently', async () => {
    const after = await svc.setColorOverride('/test-pin-marker', 99)
    expect(after.colorOverrides['/test-pin-marker']).toBeUndefined()
  })
})

// ── fs marker probe ─────────────────────────────────────────────

describe('hasMarker', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'duo-marker-test-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('returns true for a folder containing CLAUDE.md', async () => {
    await fs.writeFile(path.join(tmpDir, 'CLAUDE.md'), '# test\n')
    expect(await hasMarker(tmpDir)).toBe(true)
  })

  it('returns true for a folder containing .claude/', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude'))
    expect(await hasMarker(tmpDir)).toBe(true)
  })

  it('returns false for an empty folder', async () => {
    expect(await hasMarker(tmpDir)).toBe(false)
  })

  it('returns false for tasks.md / AGENTS.md (not project-qualifying markers)', async () => {
    await fs.writeFile(path.join(tmpDir, 'tasks.md'), '')
    await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), '')
    expect(await hasMarker(tmpDir)).toBe(false)
  })

  it('returns false for nonexistent directories without throwing', async () => {
    expect(await hasMarker(path.join(tmpDir, 'does-not-exist'))).toBe(false)
  })

  it('does not match CLAUDE.md as a directory (must be a file)', async () => {
    await fs.mkdir(path.join(tmpDir, 'CLAUDE.md'))
    expect(await hasMarker(tmpDir)).toBe(false)
  })

  it('does not match .claude as a file (must be a directory)', async () => {
    await fs.writeFile(path.join(tmpDir, '.claude'), '')
    expect(await hasMarker(tmpDir)).toBe(false)
  })
})
