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

// ── qualification policy ──────────────────────────────────────────

/**
 * Should this `dir` be blocked from qualifying as a project, even if
 * it has a marker or is a git repo?
 *
 * The user's home dir holds the global Claude Code config (`~/.claude/`),
 * which appears in the dir's listing AS a `.claude/` directory entry.
 * Naively that would make `~` qualify (D2 says "has CLAUDE.md or
 * .claude/" → marker hit). Every random `/tmp/foo` cwd would then walk
 * up to `~` and report "home dir" as its project. That's wrong.
 *
 * What we DO want: a user working IN `~/.claude/` (editing skills,
 * agents, the global CLAUDE.md, etc.) gets `~/.claude/` as the project.
 * That works because `~/.claude/` has its OWN CLAUDE.md inside it (the
 * user's global instructions) — marker hit, and the dir itself isn't
 * excluded by this policy.
 *
 * Exclusions (only the dir itself, never subdirs):
 *   • `/` — filesystem root.
 *   • `$HOME` — to block the false-positive above.
 *   • `/Users/<name>` pattern — fallback when HOME isn't injected
 *     (renderer context doesn't always carry process.env).
 *
 * Subdirectories of $HOME (including `~/.claude/`, `~/Documents/`,
 * etc.) are NOT excluded — they can qualify normally on their own
 * merits.
 */
export function isExcludedFromQualification(
  dir: string,
  homeDir?: string | null
): boolean {
  if (dir === '/') return true
  if (homeDir && dir === homeDir) return true
  // Fallback when homeDir wasn't passed (renderer caller without
  // process.env access). On macOS, `/Users/<name>` is always a home
  // dir; subdirectories never match this regex.
  if (/^\/Users\/[^/]+\/?$/.test(dir)) return true
  return false
}

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
  /** Whether the directory still exists on disk. Only consulted for
   *  pinned roots: a pin is its own qualification (D12 — "pin alone
   *  qualifies"), so a markerless-but-existing pinned folder still
   *  renders. But a pin whose folder was DELETED is a ghost tile and is
   *  dropped. `undefined` (probe pending / orchestrator doesn't supply
   *  it) is treated as "exists" so we never drop a pin speculatively. */
  exists?: boolean
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
 *   5. Build Project objects. `colorIndex` = `hashColorIndex(root)`
 *      (hash-stable; manual overrides cut in ENH-191 P0).
 */
export function deriveProjects(input: DeriveProjectsInput): DeriveProjectsOutput {
  const { terminals, workingTabs, pinnedTabPaths, pinnedProjects, qualify } = input

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
    const q = probe(pinned)
    // D12 — a pinned root is its own qualification (the user asserted
    // this folder is a project even if markers came and went). The one
    // exception: a pin whose directory was DELETED is a ghost. Drop it
    // once an existence probe confirms the dir is gone. `exists ===
    // undefined` (probe pending / not wired) keeps the pin.
    if (q.exists === false) continue
    qualifyingSet.add(pinned)
  }

  // ── Step 3 — membership (deepest qualifying ancestor) ──
  const terminalMembership: Record<string, string | null> = {}
  for (const t of terminals) {
    terminalMembership[t.id] = t.cwd ? deepestEnclosingRoot(t.cwd, qualifyingSet) : null
  }

  const tabMembership: Record<string, string | null> = {}
  for (const tab of workingTabs) {
    // BUG-193 — a PINNED tab is a cross-project reference (D2): it never
    // counts toward "working in", so it gets NO membership. Without this,
    // a pinned tab whose own deepest project isn't in `qualifyingSet`
    // (pinned tabs are skipped during candidate-gathering above, so their
    // ancestors are never added) would resolve to the shallowest
    // qualifying ancestor contributed by some OTHER member — e.g. a
    // git-repo parent like `~/Documents` — spuriously spawning that parent
    // as a project tile AND making the D11 auto-switch steal focus to it
    // whenever the pinned tab is active. Null membership fixes both, and
    // matches how the visibility filter already special-cases pinned tabs.
    if (pinnedTabPaths.has(tab.path)) {
      tabMembership[tab.id] = null
      continue
    }
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
  for (const root of pinnedProjects) {
    // Mirror the ghost-pin drop from step 2: a deleted pinned folder
    // never becomes a rendered project.
    if (probe(root).exists === false) continue
    projectRoots.add(root)
  }

  // ── Step 5 — build Project objects ──
  const projects: Project[] = [...projectRoots].map((root) => {
    const q = probe(root)
    const colorIndex = hashColorIndex(root)
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

// ── tile abbreviations (ENH-186) ──────────────────────────────────
//
// Project tiles in the rail show a 2–3 character abbreviation of the
// project name. The naive "first two characters" rule collapsed every
// `ai*` / `aipm*` project to a duplicative "AI" tile. These helpers
// derive a word-aware, collision-free abbreviation for the whole
// visible set at once (collision detection needs every name in hand,
// so this is a set operation, not a per-tile one).

/**
 * Split a project display name into words for abbreviation. Word
 * delimiters are whitespace, hyphen, underscore, and dot; camelCase /
 * PascalCase boundaries are also treated as breaks ("aiPlatform" →
 * ["ai", "Platform"], "AIPlatform" → ["AI", "Platform"]). A leading
 * dot is stripped first (".claude" → ["claude"]); empty segments drop.
 */
export function splitProjectWords(name: string): string[] {
  return name
    .replace(/^\.+/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s\-_.]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0)
}

// Width caps keep tiles legible in the ~40px rail: at most three
// word-initials for multi-word names, at most four leading letters for
// single-word names. Past the cap, a numeric suffix disambiguates.
const MAX_MULTIWORD_INITIALS = 3
const MAX_SINGLEWORD_LETTERS = 4

/** The letter/initial candidate for a name at escalation `level`
 *  (0 = baseline). Multi-word → initials of the first (2 + level) words;
 *  single-word → the first (2 + level) letters. Both capped; an empty
 *  name collapses to "?". */
function letterCandidate(words: string[], level: number): string {
  if (words.length >= 2) {
    const take = Math.min(2 + level, MAX_MULTIWORD_INITIALS, words.length)
    return words
      .slice(0, take)
      .map((w) => w[0])
      .join('')
      .toUpperCase()
  }
  const word = words[0] ?? ''
  if (!word) return '?'
  const take = Math.min(2 + level, MAX_SINGLEWORD_LETTERS, word.length)
  return word.slice(0, Math.max(take, 1)).toUpperCase()
}

/** Whether `letterCandidate` can still grow a longer candidate for this
 *  name at `level`. Once false, only a numeric suffix can disambiguate. */
function canEscalate(words: string[], level: number): boolean {
  if (words.length >= 2) {
    return 2 + level < Math.min(MAX_MULTIWORD_INITIALS, words.length)
  }
  const word = words[0] ?? ''
  return 2 + level < Math.min(MAX_SINGLEWORD_LETTERS, word.length)
}

/**
 * Compute a short, collision-free abbreviation for every project tile.
 *
 * Rules (ENH-186):
 *   • Multi-word name → first letters of the first two words
 *     ("ai-pm-tools" → "AP"). When two tiles collide because their
 *     first two words match, expand to three initials ("APT" / "APD").
 *   • Single-word name → first two letters ("platform" → "PL"). On
 *     collision, extend one letter at a time ("PLA", "PLAT").
 *   • When the letter/initial ladder is exhausted and tiles still
 *     collide — e.g. "ai-pm-data" and "ai-pm-dashboard" both reduce to
 *     "APD", or two two-word names share initials — a numeric suffix
 *     disambiguates by sort order ("APD", "APD2"). The first tile keeps
 *     the clean form.
 *
 * Pure + deterministic: the same set of {root, name} pairs always
 * yields the same result regardless of input order. Returns a map keyed
 * by project `root`.
 */
export function computeProjectAbbreviations(
  projects: ReadonlyArray<{ root: string; name: string }>
): Map<string, string> {
  // Sort up front so numeric disambiguators are stable and independent
  // of the caller's array order.
  const ordered = [...projects].sort(
    (a, b) => a.name.localeCompare(b.name) || a.root.localeCompare(b.root)
  )

  const words = new Map<string, string[]>()
  const level = new Map<string, number>()
  for (const p of ordered) {
    words.set(p.root, splitProjectWords(p.name))
    level.set(p.root, 0)
  }

  const candidateFor = (root: string): string =>
    letterCandidate(words.get(root)!, level.get(root)!)

  const groupByCandidate = (): Map<string, string[]> => {
    const groups = new Map<string, string[]>()
    for (const p of ordered) {
      const c = candidateFor(p.root)
      const bucket = groups.get(c)
      if (bucket) bucket.push(p.root)
      else groups.set(c, [p.root])
    }
    return groups
  }

  // Phase A — grow letter/initial candidates to break collisions
  // wherever a longer candidate is available. Levels only increase and
  // are capped, so this converges; the guard is a backstop.
  for (let guard = 0; guard < 32; guard++) {
    let advanced = false
    for (const roots of groupByCandidate().values()) {
      if (roots.length < 2) continue
      for (const root of roots) {
        if (canEscalate(words.get(root)!, level.get(root)!)) {
          level.set(root, level.get(root)! + 1)
          advanced = true
        }
      }
    }
    if (!advanced) break
  }

  // Phase B — numeric suffix for groups that still collide after the
  // ladder is exhausted. Members arrive in sorted order, so the first
  // keeps the clean form and the rest get "…2", "…3", …
  const result = new Map<string, string>()
  for (const [candidate, roots] of groupByCandidate()) {
    if (roots.length === 1) {
      result.set(roots[0], candidate)
      continue
    }
    roots.forEach((root, i) => {
      result.set(root, i === 0 ? candidate : `${candidate}${i + 1}`)
    })
  }
  return result
}

// ── persisted-slice normalization (used by ProjectsService) ─────

/** Normalize a partially-parsed projects.json: drop malformed pins,
 *  dedupe pin entries, fill missing fields with defaults. Lives here
 *  (and not in projects-service.ts) so the renderer can also re-validate
 *  snapshots received over IPC. */
export function normalizeProjectsFile(parsed: Partial<ProjectsFile>): ProjectsFile {
  // BUG-164 (v0.8.0 fold-in) — Array.from(new Set(...)) dedupes a
  // hand-edited projects.json with duplicate pin entries. Without
  // this, togglePin's indexOf-then-splice removes only the first
  // occurrence, leaving zombie copies behind.
  const pins = Array.isArray(parsed.pins)
    ? Array.from(new Set(parsed.pins.filter((p): p is string => typeof p === 'string' && p.length > 0)))
    : []
  // Manual color overrides were cut in ENH-191 P0; any legacy
  // `colorOverrides` key in an existing projects.json is ignored.
  return { version: 1, pins }
}
