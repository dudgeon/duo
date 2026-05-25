// ENH-182 (Sprint 22) — pure project derivation.
//
// This module is the side-effect-free core of the project-as-filter-
// layer feature. It's shared so both main and renderer can import it
// (main: CLI verbs in Phase 4; renderer: the rail UI in Phase 1+).
// Anything that touches fs / git lives in `core/projects-service.ts`,
// which composes on top of this.
//
// Decisions reference: docs/prd/enh-182-project-centric-ux.md.
//   D2  qualification = (gitRoot || marker) && workingIn
//   D5  membership = deepest qualifying ancestor
//   D12 lifecycle = auto add/remove + pin (pinned roots persist)
//   R2  color = hash(rootPath) % 6, override allowed

import type { Project, ProjectsFile } from './types'

/** Number of distinct hues in the project color system. Mirrors the
 *  six `--project-*` tokens defined in `skill/references/duo-atelier.css`
 *  (and mirrored into `renderer/styles/globals.css` in Phase 1).
 *  Past six projects, R2 says rotate shade variants — that's a Phase 1+
 *  rendering concern, not a derivation concern. */
export const NUM_PROJECT_COLORS = 6

// ── path helpers (Posix only — Duo is macOS) ──────────────────────

function dirname(p: string): string {
  if (p === '/') return '/'
  const trimmed = p.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  if (idx <= 0) return '/'
  return trimmed.slice(0, idx)
}

function basename(p: string): string {
  if (p === '/') return ''
  const trimmed = p.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  return idx < 0 ? trimmed : trimmed.slice(idx + 1)
}

/**
 * Hash-stable color index in [0, NUM_PROJECT_COLORS). The hash is a
 * simple djb2 over the absolute path; deterministic across runs and
 * platforms so the same project root always lights up in the same
 * hue without persisting anything.
 */
export function hashColorIndex(rootPath: string): number {
  let h = 5381
  for (let i = 0; i < rootPath.length; i++) {
    h = ((h << 5) + h + rootPath.charCodeAt(i)) >>> 0
  }
  return h % NUM_PROJECT_COLORS
}

/**
 * All ancestor directories of `dir`, from `dir` itself up to (but not
 * including) the filesystem root's parent loop. The list always
 * includes `dir`, then each successive parent, ending with `/`.
 */
export function ancestors(dir: string): string[] {
  const out: string[] = []
  let cur = dir
  while (true) {
    out.push(cur)
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return out
}

/**
 * Find the deepest path in `qualifying` that is an ancestor of (or
 * equal to) `startDir`. Returns `null` when no qualifying ancestor
 * exists.
 *
 * "Deepest" = longest path (longer paths nest inside shorter ones).
 * This is the D5 rule: a tab/terminal belongs to its deepest
 * qualifying enclosing root.
 */
export function deepestEnclosingRoot(
  startDir: string,
  qualifying: ReadonlySet<string>
): string | null {
  for (const ancestor of ancestors(startDir)) {
    if (qualifying.has(ancestor)) {
      // `ancestors` walks from `startDir` UP to the FS root, so the
      // FIRST hit is also the deepest by definition. Return early.
      return ancestor
    }
  }
  return null
}

// ── pure derivation ───────────────────────────────────────────────

/** Per-folder probe result. The orchestrator fills this in from
 *  `getGitStatus(dir)` + an fs check for `CLAUDE.md` / `.claude/`.
 *  The pure derivation never touches fs/git itself. */
export interface QualificationResult {
  isGitRoot: boolean
  hasMarker: boolean
}

export interface DeriveProjectsInput {
  /** Open terminals — only `id` and `cwd` are consulted. */
  terminals: ReadonlyArray<{ id: string; cwd: string }>
  /** Open working tabs (file kind only — browser tabs handled
   *  separately). Only `id` and `path` are consulted. */
  workingTabs: ReadonlyArray<{ id: string; path: string }>
  /** Set of working-tab paths that are pinned (Stage 24 pins.json).
   *  Pinned tabs do NOT count toward "working in" for D2 — pin a
   *  reference doc and it shouldn't qualify your home folder as a
   *  project. */
  pinnedTabPaths: ReadonlySet<string>
  /** Set of project roots the user has pinned via the rail's
   *  right-click menu (D12). These appear in the rail even if no
   *  tabs/terminals currently sit under them. */
  pinnedProjects: ReadonlySet<string>
  /** Color overrides from the persisted slice (R2). Keyed by
   *  absolute root path; values clamped 0..NUM_PROJECT_COLORS-1. */
  colorOverrides: Readonly<Record<string, number>>
  /** Side-effect-free probe. The orchestrator constructs this from
   *  pre-fetched `getGitStatus` results + `hasMarker` checks. Each
   *  unique candidate folder is probed at most once (memoization
   *  inside this function ensures it). */
  qualify: (dir: string) => QualificationResult
}

export interface DeriveProjectsOutput {
  /** Project list, sorted alphabetically by `name` (then `root` as
   *  tiebreaker) for stable render order. */
  projects: Project[]
  /** Terminal-id → project root (or null when no qualifying ancestor). */
  terminalMembership: Record<string, string | null>
  /** Tab-id → project root (or null when no qualifying ancestor). */
  tabMembership: Record<string, string | null>
}

/**
 * The Phase 0 core. Pure, deterministic, fully testable.
 *
 * Algorithm:
 *   1. Gather all candidate folders by walking up the directory tree
 *      from every terminal cwd and every non-pinned tab's dirname.
 *   2. Memoize-call `qualify(dir)` for each unique candidate; the
 *      qualifying set = candidates where `isGitRoot || hasMarker`.
 *      Add pinned project roots (they may not be candidates if no
 *      tabs reference them).
 *   3. Compute membership for each terminal/tab as the deepest
 *      qualifying ancestor (D5).
 *   4. The project set = (roots that own ≥1 member) ∪ pinnedProjects.
 *   5. Build Project objects. `colorIndex` = `colorOverrides[root]` if
 *      present and in range, else `hashColorIndex(root)`.
 */
export function deriveProjects(input: DeriveProjectsInput): DeriveProjectsOutput {
  const { terminals, workingTabs, pinnedTabPaths, pinnedProjects, colorOverrides, qualify } = input

  // ── Step 1+2 — gather candidates and probe them once each ──
  const qualCache = new Map<string, QualificationResult>()
  const probe = (dir: string): QualificationResult => {
    let cached = qualCache.get(dir)
    if (!cached) {
      cached = qualify(dir)
      qualCache.set(dir, cached)
    }
    return cached
  }

  const qualifyingSet = new Set<string>()
  const considerAncestors = (startDir: string): void => {
    for (const dir of ancestors(startDir)) {
      const { isGitRoot, hasMarker } = probe(dir)
      if (isGitRoot || hasMarker) qualifyingSet.add(dir)
    }
  }

  for (const t of terminals) {
    if (t.cwd) considerAncestors(t.cwd)
  }
  for (const tab of workingTabs) {
    if (pinnedTabPaths.has(tab.path)) continue
    if (!tab.path) continue
    considerAncestors(dirname(tab.path))
  }
  for (const pinned of pinnedProjects) {
    probe(pinned)
    qualifyingSet.add(pinned)
  }

  // ── Step 3 — membership (deepest qualifying ancestor) ──
  const terminalMembership: Record<string, string | null> = {}
  for (const t of terminals) {
    terminalMembership[t.id] = t.cwd ? deepestEnclosingRoot(t.cwd, qualifyingSet) : null
  }

  const tabMembership: Record<string, string | null> = {}
  for (const tab of workingTabs) {
    tabMembership[tab.id] = tab.path
      ? deepestEnclosingRoot(dirname(tab.path), qualifyingSet)
      : null
  }

  // ── Step 4 — project set = roots owning ≥1 member ∪ pinned ──
  const projectRoots = new Set<string>()
  for (const root of Object.values(terminalMembership)) {
    if (root) projectRoots.add(root)
  }
  for (const root of Object.values(tabMembership)) {
    if (root) projectRoots.add(root)
  }
  for (const root of pinnedProjects) projectRoots.add(root)

  // ── Step 5 — build Project objects ──
  const projects: Project[] = [...projectRoots].map((root) => {
    const q = probe(root)
    const override = colorOverrides[root]
    const colorIndex =
      typeof override === 'number' && override >= 0 && override < NUM_PROJECT_COLORS
        ? override
        : hashColorIndex(root)
    return {
      root,
      name: basename(root) || root,
      isGitRoot: q.isGitRoot,
      hasMarker: q.hasMarker,
      colorIndex,
      pinned: pinnedProjects.has(root)
    }
  })

  projects.sort((a, b) => {
    const byName = a.name.localeCompare(b.name)
    return byName !== 0 ? byName : a.root.localeCompare(b.root)
  })

  return { projects, terminalMembership, tabMembership }
}

// ── persisted-slice normalization (used by ProjectsService) ─────

/** Normalize a partially-parsed projects.json: drop malformed pins,
 *  clamp override values, fill missing fields with defaults. Lives
 *  here (and not in projects-service.ts) so the renderer can also
 *  re-validate snapshots received over IPC. */
export function normalizeProjectsFile(parsed: Partial<ProjectsFile>): ProjectsFile {
  const pins = Array.isArray(parsed.pins)
    ? parsed.pins.filter((p): p is string => typeof p === 'string' && p.length > 0)
    : []
  const colorOverrides: Record<string, number> = {}
  if (parsed.colorOverrides && typeof parsed.colorOverrides === 'object') {
    for (const [k, v] of Object.entries(parsed.colorOverrides)) {
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < NUM_PROJECT_COLORS) {
        colorOverrides[k] = v
      }
    }
  }
  return { version: 1, pins, colorOverrides }
}
