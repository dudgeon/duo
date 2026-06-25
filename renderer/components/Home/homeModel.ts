// ENH-212 — Home re-entry surface. Pure selectors + formatters for the
// renderer. Everything here is deterministic (no IPC, no Date.now() reads
// hidden inside — callers pass `now` explicitly) so the whole module is
// unit-testable without a DOM or a clock. The component layer
// (HomeView / HeroPanel / SpineRow / SessionRow / GreetingLine) consumes
// these; it never re-derives any of this logic inline.

import type { GreetingData, HomeProject, CronJobView, CatchupCard, AttentionReason } from '@shared/types'
import { deepestEnclosingRoot, hashColorIndex } from '@shared/projects'

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

/**
 * D6 — assign each cron job to its owning project card. A job's home is the
 * SURFACED hero/spine card whose root is the deepest enclosing ancestor of the
 * job's cwd; jobs whose project isn't surfaced (folded spine, a project with no
 * Home sessions, or a cwd under no known root) collect in `unmatched` for the
 * aggregated "Scheduled" block — so nothing is hidden. Pure: `allRoots` is the
 * full qualifying set (so deepest-enclosing resolves correctly even when a
 * surfaced root nests inside another), `surfacedRoots` gates what actually nests.
 */
export function assignCronJobs(
  jobs: CronJobView[],
  allRoots: readonly string[],
  surfacedRoots: ReadonlySet<string>
): { byRoot: Map<string, CronJobView[]>; unmatched: CronJobView[] } {
  const qualifying = new Set(allRoots)
  const byRoot = new Map<string, CronJobView[]>()
  const unmatched: CronJobView[] = []
  for (const job of jobs) {
    const root = deepestEnclosingRoot(job.cwd, qualifying)
    if (root && surfacedRoots.has(root)) {
      const list = byRoot.get(root)
      if (list) list.push(job)
      else byRoot.set(root, [job])
    } else {
      unmatched.push(job)
    }
  }
  return { byRoot, unmatched }
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

/** Round-2 feedback #3 — the greeting split so the freshest-thread TITLE can
 *  render as a clickable accent span (focus/resume that session) while the
 *  rest stays plain serif text. `freshestTitle` is null when the greeting has
 *  no freshest thread (nothing to make clickable); the component then renders
 *  `before` alone. Mirrors greetingLine()'s wording exactly so the two never
 *  drift. Pure + testable. */
export function greetingParts(greeting: GreetingData): {
  before: string
  freshestTitle: string | null
  after: string
} {
  const lead = greeting.firstName
    ? `Welcome back, ${greeting.firstName} —`
    : 'Welcome back —'

  if (!greeting.freshest) {
    // No freshest thread → nothing clickable; reuse the plain line verbatim.
    return { before: greetingLine(greeting), freshestTitle: null, after: '' }
  }

  if (greeting.openCount === 0) {
    return {
      before: `${lead} all quiet since `,
      freshestTitle: null,
      after: ageWords(greeting.freshest.ageMs),
    }
  }

  const sessions = `${greeting.openCount} ${plural(greeting.openCount, 'session')} open`
  return {
    before: `${lead} ${sessions}; freshest is `,
    freshestTitle: greeting.freshest.title,
    after: `, ${ageWords(greeting.freshest.ageMs)}`,
  }
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

/** Round-2 feedback #3 — the freshest session across all projects (max
 *  modifiedAt), returned with its project so the greeting's clickable title
 *  can focus/resume it. Null when there are no sessions. Pure + testable. */
export function freshestSession(
  projects: HomeProject[]
): { project: HomeProject; session: import('@shared/types').HomeSession } | null {
  let best: { project: HomeProject; session: import('@shared/types').HomeSession } | null = null
  for (const project of projects) {
    for (const session of project.sessions) {
      if (!best || session.modifiedAt > best.session.modifiedAt) best = { project, session }
    }
  }
  return best
}

// ── ENH-231 — Async Catch-Up presentation helpers (pure, testable) ─────────
// The SERVER assembles the columns/tiers (electron/home-snapshot.ts is
// authoritative); these are display-only derivations the board components
// consume so the JSX never re-derives label/class/action logic inline.

/** Posix basename. */
function baseName(p: string): string {
  const t = p.replace(/\/+$/, '')
  const i = t.lastIndexOf('/')
  return i < 0 ? t : t.slice(i + 1)
}

/** Short repo/project label for a card — the session cwd's basename. */
export function repoLabel(cwd: string): string {
  return baseName(cwd) || cwd || '—'
}

/** Split a session cwd into its repo label + an optional worktree slug so two
 *  worktrees of one repo are distinguishable (parity with Projects Home's
 *  subPath badge). Recognizes Duo's `.../<repo>/.claude/worktrees/<slug>`
 *  convention; otherwise the cwd basename is the repo and there's no worktree. */
export function worktreeInfo(cwd: string): { repo: string; worktree?: string } {
  const m = cwd.match(/^(.*?)\/\.claude\/worktrees\/([^/]+)\/?$/)
  if (m) return { repo: baseName(m[1]) || m[1], worktree: m[2] }
  return { repo: baseName(cwd) || cwd || '—' }
}

/** Stable hue for a card, hashed off its cwd — the same palette the project
 *  rail + Home spine use, so a project reads as one color everywhere. */
export function cardHue(cwd: string): string {
  return projectHue(hashColorIndex(cwd || ''))
}

/** The Needs-you reason chip: visible label + the shared both-theme-legible
 *  banner class (ENH-231 §9: plan→warn, question→info, blocked→error). */
export function attentionChip(reason: AttentionReason): { label: string; bannerClass: string } {
  switch (reason) {
    case 'plan-to-approve':
      return { label: '📋 plan to approve', bannerClass: 'duo-banner-warn' }
    case 'question':
      return { label: '💬 question', bannerClass: 'duo-banner-info' }
    case 'blocked':
      return { label: '⛔ blocked', bannerClass: 'duo-banner-error' }
  }
}

const DOC_EXT = /\.(md|markdown|html?)$/i
function isDocFile(p: string): boolean {
  return DOC_EXT.test(p)
}

export type DigestPrimary = { kind: 'session' | 'artifact'; label: string; path?: string }
export type DigestSecondary = { kind: 'session' | 'pr' | 'file' | 'diff'; label: string; value?: string }

/** D7 — the card's PRIMARY action. A Done card whose work product is an md/html
 *  file leads with the artifact (Duo's canvas/playground home turf). Otherwise
 *  re-entry: a Duo-hosted live session FOCUSES (never forks); an external-live or
 *  closed session opens/resumes (external opening forks, behind the confirm). The
 *  worktree-gone case is handled by the caller (no re-entry — the cwd is gone). */
export function digestPrimaryAction(card: CatchupCard): DigestPrimary {
  const doc = (card.artifacts.createdFiles ?? []).find(isDocFile)
  if (card.state === 'done' && doc) return { kind: 'artifact', label: `Open ${baseName(doc)} →`, path: doc }
  if (card.open?.kind === 'duo') return { kind: 'session', label: 'Focus session →' }
  return { kind: 'session', label: 'Open session →' }
}

/** D7 — the quieter SECONDARY link. When the artifact leads, re-entry is the
 *  secondary; otherwise precedence is PR > new doc > diff. Null when none. */
export function digestSecondaryAction(card: CatchupCard): DigestSecondary | null {
  if (digestPrimaryAction(card).kind === 'artifact') return { kind: 'session', label: 'Open session' }
  const a = card.artifacts
  if (a.pr) return { kind: 'pr', label: `Review PR #${a.pr.number}`, value: a.pr.url }
  const doc = (a.createdFiles ?? []).find(isDocFile)
  if (doc) return { kind: 'file', label: `Open ${baseName(doc)}`, value: doc }
  if (card.gitBranch) return { kind: 'diff', label: 'View diff' }
  return null
}

/** The "Next:" line for a working/closed card — agent self-narration if it
 *  narrated, else the first not-yet-done todo, else null. */
export function digestNextLine(card: CatchupCard): string | null {
  if (card.narrative?.next) return card.narrative.next
  const todo = card.todos.find((t) => t.status !== 'completed')
  return todo?.text ?? null
}

/** The Needs-you body line — the agent's note if narrated, else the last
 *  assistant block (the honest fallback), else what the user last asked. */
export function digestNeedsLine(card: CatchupCard): string | null {
  return card.narrative?.note ?? card.fallbackSnippet ?? card.youAsked ?? null
}

/** CSS class for a compact row's state dot. Compact rows are CLOSED (ended with
 *  no deliverable; resumable), so the default is the muted closed dot; the
 *  attention/live branches are defensive (shouldn't occur in a compact row). */
export function compactDotClass(card: CatchupCard): string {
  if (card.attention) return 'duo-cu-dot-attn'
  if (card.open) return 'duo-cu-dot-live'
  return 'duo-cu-dot-closed'
}

/** Flatten a markdown-bearing transcript line into a short plain-text preview
 *  for a card (the raw last-assistant block is full markdown — fenced code,
 *  bold, links — which reads as machinery on a card). Drops fenced code blocks
 *  entirely, unwraps inline code / emphasis / links, collapses whitespace, and
 *  truncates. The card additionally CSS-line-clamps, so this is the upper bound
 *  on payload, not the visible height. */
export function toPlainPreview(text: string, max = 180): string {
  const flat = text
    .replace(/```[\s\S]*?```/g, ' ') // drop fenced code blocks (the bash noise)
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`([^`]+)`/g, '$1') // unwrap inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1') // unbold
    .replace(/(^|\s)\*([^*\n]+)\*/g, '$1$2') // unitalic
    .replace(/(^|\s)_([^_\n]+)_/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '') // headings
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → text
    .replace(/^\s*[-*+]\s+/gm, '') // list bullets
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat
}
