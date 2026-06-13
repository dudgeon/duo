// ENH-212 — Home re-entry surface. Pure selectors + formatters for the
// renderer. Everything here is deterministic (no IPC, no Date.now() reads
// hidden inside — callers pass `now` explicitly) so the whole module is
// unit-testable without a DOM or a clock. The component layer
// (HomeView / HeroPanel / SpineRow / SessionRow / GreetingLine) consumes
// these; it never re-derives any of this logic inline.

import type { GreetingData, HomeProject } from '@shared/types'
import { ancestors } from '@shared/projects'

/** Map colorIndex (0..5) → CSS var. Mirrors the six `--duo-project-*`
 *  tokens in `renderer/styles/globals.css` (which themselves mirror the
 *  Atelier kernel). Identical to ProjectRail's PROJECT_COLOR_TOKENS — the
 *  hue palette is the same everywhere so a project reads as the same
 *  color in the rail and on Home. */
const PROJECT_COLOR_TOKENS = [
  'var(--duo-project-pine)',
  'var(--duo-project-harbor)',
  'var(--duo-project-iris)',
  'var(--duo-project-plum)',
  'var(--duo-project-rose)',
  'var(--duo-project-moss)'
] as const

/** CSS color value for a project's hue dot. Defensive modulo + fallback so
 *  an out-of-range or NaN colorIndex never renders a missing-var dot. */
export function projectHue(colorIndex: number): string {
  const i = Number.isFinite(colorIndex)
    ? ((Math.trunc(colorIndex) % PROJECT_COLOR_TOKENS.length) + PROJECT_COLOR_TOKENS.length) % PROJECT_COLOR_TOKENS.length
    : 0
  return PROJECT_COLOR_TOKENS[i]
}

/** D5 — how many spine rows show before the "N older projects" expander
 *  folds the rest away. */
export const SPINE_FOLD_AFTER = 8

/** Hero / spine split (D1). The snapshot's `projects` arrive sorted by
 *  `lastActiveAt` desc, so the first two are the heroes and the rest form
 *  the spine stack. Pure slice — no re-sort (main owns the ordering). */
export function selectHeroes(projects: HomeProject[]): HomeProject[] {
  return projects.slice(0, 2)
}

export function selectSpine(projects: HomeProject[]): HomeProject[] {
  return projects.slice(2)
}

/** D5 — the spine fold. Returns the rows shown when collapsed (the first
 *  SPINE_FOLD_AFTER) plus how many are hidden behind the expander. When
 *  `expanded`, every spine row shows and `hiddenCount` is 0. A spine of
 *  exactly SPINE_FOLD_AFTER doesn't fold (no expander for a single extra
 *  saved row would be silly — the threshold is "more than 8"). */
export function foldSpine(
  spine: HomeProject[],
  expanded: boolean
): { visible: HomeProject[]; hiddenCount: number } {
  if (expanded || spine.length <= SPINE_FOLD_AFTER) {
    return { visible: spine, hiddenCount: 0 }
  }
  return {
    visible: spine.slice(0, SPINE_FOLD_AFTER),
    hiddenCount: spine.length - SPINE_FOLD_AFTER
  }
}

/** Compact age string for a millisecond delta. "just now" under a minute,
 *  then m / h / d / w grain. Negative deltas (clock skew — a file mtime in
 *  the future) clamp to "just now". Mirrors the briefing-line voice in the
 *  PRD's greeting example ("12 minutes ago" → "12m ago" in chips, full
 *  words in the greeting line via `ageWords`). */
export function ageShort(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < 60_000) return 'just now'
  const mins = Math.floor(ageMs / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  return `${weeks}w ago`
}

/** Long-form age for the greeting line ("12 minutes ago"). Same grain as
 *  ageShort but spelled out, with singular/plural agreement. */
export function ageWords(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < 60_000) return 'moments ago'
  const mins = Math.floor(ageMs / 60_000)
  if (mins < 60) return `${mins} ${plural(mins, 'minute')} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} ${plural(hours, 'hour')} ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} ${plural(days, 'day')} ago`
  const weeks = Math.floor(days / 7)
  return `${weeks} ${plural(weeks, 'week')} ago`
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`
}

/** D4 — the greeting line text, as a plain string (the component renders it
 *  as styled serif text, NOT a boxed banner). Carries the briefing data:
 *  who, how many open, the freshest thread + its age.
 *
 *  Degradations (locked in D4 + D12):
 *   - no firstName (os.userInfo() unavailable) → opens "Welcome back —"
 *     instead of "Welcome back, <name> —".
 *   - 0 open → "all quiet since <age of the freshest thread>".
 *   - 0 open AND no freshest (a brand-new machine with no sessions at all)
 *     → "all quiet" with no age tail.
 *
 *  `greeting.freshest.ageMs` is already an age (snapshot's generatedAt −
 *  modifiedAt) computed main-side; the surface re-fetches every 30s so it's
 *  never meaningfully stale. We use it directly — no clock read here, so the
 *  function stays pure + testable. */
export function greetingLine(greeting: GreetingData): string {
  const lead = greeting.firstName
    ? `Welcome back, ${greeting.firstName} —`
    : 'Welcome back —'

  // 0 open → "all quiet since <age>" (D4). The age anchors on the freshest
  // thread we know about; with no freshest at all we drop the "since" tail.
  if (greeting.openCount === 0) {
    if (greeting.freshest) {
      return `${lead} all quiet since ${ageWords(greeting.freshest.ageMs)}`
    }
    return `${lead} all quiet`
  }

  const sessions = `${greeting.openCount} ${plural(greeting.openCount, 'session')} open`
  if (greeting.freshest) {
    return `${lead} ${sessions}; freshest is ${greeting.freshest.title}, ${ageWords(greeting.freshest.ageMs)}`
  }
  return `${lead} ${sessions}`
}

/** Relative path → display label for a session's subPath badge (D8). Empty
 *  / root subPaths return null so the component can skip the badge. */
export function subPathLabel(subPath: string | undefined): string | null {
  if (!subPath) return null
  const trimmed = subPath.replace(/^\/+|\/+$/g, '')
  return trimmed === '' ? null : trimmed
}

/** Basename for a recent-file chip — last path segment, never the full
 *  absolute path. */
export function fileChipLabel(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}

/** § 4.3 [V] live-but-idle guard — set of project root paths that enclose
 *  an unattributed live `claude` cwd. A `resume` click on a session whose
 *  project root is in this set (and which has no open-pill) is gated behind
 *  a confirm, so the click can't fork a concurrently-running session that
 *  fails every join leg. A root matches when it equals, or is an ancestor
 *  of, one of `unattributedLiveCwds`. Empty/absent input ⇒ empty set. */
export function rootsWithUnattributedLiveClaude(
  projects: HomeProject[],
  unattributedLiveCwds: string[] | undefined
): Set<string> {
  const out = new Set<string>()
  if (!unattributedLiveCwds || unattributedLiveCwds.length === 0) return out
  const roots = new Set(projects.map((p) => p.rootPath))
  for (const cwd of unattributedLiveCwds) {
    for (const anc of ancestors(cwd)) {
      if (roots.has(anc)) out.add(anc)
    }
  }
  return out
}
