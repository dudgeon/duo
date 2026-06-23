// ENH-229 phase 2 — the rollup "product" layer on top of the render engine.
//
// Change-summary on regenerate (req #7): a rendered artifact SELF-EMBEDS a
// machine-readable rows snapshot + a summary log inside HTML comments (valid +
// invisible in both HTML and Markdown — and on GitHub). A regenerate reads the
// prior artifact's snapshot, the CLI computes a deterministic diff, an
// interactive Claude turns it into a narrative, and `duo rollup render
// --summary "<prose>"` embeds it (latest pinned + a collapsible history). No
// sidecar cache (§D9-clean) — the artifact carries its own history.
//
// This module is PURE (no fs, no engine): it (de)serializes the embedded
// blocks, diffs two snapshots, and manages the summary log. render.ts builds
// the snapshot; the CLI orchestrates read-prior → diff/summarize → re-render.

/** One row of a rollup, captured for diffing. `key` is the row's stable
 *  identity (the note's vault-relative path); `cells` are the displayed column
 *  values as plain strings, keyed by column spec. */
export interface RollupRow {
  key: string
  cells: Record<string, string>
}
export interface RollupSnapshot {
  /** Schema version, so a future format change can migrate rather than misread. */
  v: 1
  views: { name: string; rows: RollupRow[] }[]
}
/** One change-summary entry (newest-first in the log). */
export interface SummaryEntry {
  /** As-of date label the summary was written against (e.g. 2026-Jun-23). */
  date: string
  /** The narrative + notables prose (authored by interactive Claude). */
  text: string
}

export interface RollupDiff {
  views: {
    name: string
    added: RollupRow[]
    removed: RollupRow[]
    changed: { key: string; fields: { col: string; from: string; to: string }[] }[]
  }[]
  totals: { added: number; removed: number; changed: number }
  /** True when there is no prior snapshot to diff against (a first render). */
  firstRun: boolean
}

/** An agent-visible HTML comment at the top of every rollup artifact, so a
 *  fresh agent that opens the file understands what it is + how to regenerate
 *  it (and not to hand-edit it). `>` is stripped from the target so it can't
 *  terminate the comment. */
export function rollupDocComment(target: string): string {
  const t = String(target).replace(/[<>]/g, '')
  return (
    '<!-- Duo rollup (generated · ENH-229) — a view computed over this vault\'s note ' +
    'frontmatter, NOT a hand-authored note. Regenerate with `duo rollup render ' +
    t +
    '` (do not hand-edit). The duo:rollup-snapshot / duo:rollup-summary comments below are ' +
    'machine state for change-diffing (`duo rollup diff`). Docs: ~/.claude/skills/duo/references/rollup.md -->'
  )
}

const SNAPSHOT_OPEN = '<!--duo:rollup-snapshot '
const SUMMARY_OPEN = '<!--duo:rollup-summary '
const CLOSE = '-->'
const HISTORY_CAP = 12

/** JSON for embedding inside an HTML comment: escape `<`/`>` to their `\uXXXX`
 *  forms (still valid JSON, decoded back by JSON.parse) so a cell value or
 *  summary containing `-->` or `</script>` can't terminate the comment early
 *  and corrupt the artifact + the next diff. */
function commentSafeJson(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
}

/** Serialize the embedded snapshot comment (goes at the end of the artifact). */
export function snapshotComment(snap: RollupSnapshot): string {
  return SNAPSHOT_OPEN + commentSafeJson(snap) + CLOSE
}
/** Serialize the embedded summary-log comment. */
export function summaryLogComment(log: SummaryEntry[]): string {
  return SUMMARY_OPEN + commentSafeJson(log) + CLOSE
}

function extractJson<T>(content: string, open: string): T | null {
  const start = content.indexOf(open)
  if (start === -1) return null
  const from = start + open.length
  const end = content.indexOf(CLOSE, from)
  if (end === -1) return null
  try {
    return JSON.parse(content.slice(from, end).trim()) as T
  } catch {
    return null // a corrupt/partial block degrades to "no prior" rather than throwing
  }
}

/** Read a prior artifact's embedded rows snapshot (HTML or Markdown), or null. */
export function extractSnapshot(content: string): RollupSnapshot | null {
  const snap = extractJson<RollupSnapshot>(content, SNAPSHOT_OPEN)
  if (!snap || snap.v !== 1 || !Array.isArray(snap.views)) return null
  return snap
}
/** Read a prior artifact's embedded summary log (newest-first), or []. */
export function extractSummaryLog(content: string): SummaryEntry[] {
  const log = extractJson<SummaryEntry[]>(content, SUMMARY_OPEN)
  return Array.isArray(log) ? log.filter((e) => e && typeof e.text === 'string') : []
}

/** Prepend a new summary entry (newest-first), capped to {@link HISTORY_CAP}. */
export function prependSummary(log: SummaryEntry[], entry: SummaryEntry): SummaryEntry[] {
  return [entry, ...log].slice(0, HISTORY_CAP)
}

/** Diff a prior snapshot against the freshly-evaluated one. Pure + deterministic
 *  — added / removed / changed rows per view, by row key, with per-field deltas
 *  for changed rows. `prior == null` → firstRun (everything is "current"). */
export function diffSnapshots(prior: RollupSnapshot | null, current: RollupSnapshot): RollupDiff {
  // First render — nothing to diff against. Report empty deltas + the flag so
  // the caller writes "initial rollup" rather than listing every row as "added".
  if (prior == null) return { views: [], totals: { added: 0, removed: 0, changed: 0 }, firstRun: true }
  const views: RollupDiff['views'] = []
  let tAdded = 0
  let tRemoved = 0
  let tChanged = 0
  const priorByView = new Map(prior.views.map((v) => [v.name, v]))
  const currentNames = new Set(current.views.map((v) => v.name))
  for (const cv of current.views) {
    const pv = priorByView.get(cv.name)
    const priorRows = new Map((pv?.rows ?? []).map((r) => [r.key, r]))
    const added: RollupRow[] = []
    const changed: RollupDiff['views'][number]['changed'] = []
    const seen = new Set<string>() // dedup current rows by key (one diff entry per key)
    for (const row of cv.rows) {
      if (seen.has(row.key)) continue
      seen.add(row.key)
      const pr = priorRows.get(row.key)
      if (!pr) {
        added.push(row)
        continue
      }
      const fields: { col: string; from: string; to: string }[] = []
      const cols = new Set([...Object.keys(pr.cells), ...Object.keys(row.cells)])
      for (const col of cols) {
        const from = pr.cells[col] ?? ''
        const to = row.cells[col] ?? ''
        if (from !== to) fields.push({ col, from, to })
      }
      if (fields.length) changed.push({ key: row.key, fields })
    }
    const removed = (pv?.rows ?? []).filter((r) => !seen.has(r.key))
    tAdded += added.length
    tRemoved += removed.length
    tChanged += changed.length
    views.push({ name: cv.name, added, removed, changed })
  }
  // A view present in prior but gone from current → all its rows are removed
  // (e.g. a base edited to drop a view). Without this it'd vanish silently.
  for (const pv of prior.views) {
    if (currentNames.has(pv.name)) continue
    tRemoved += pv.rows.length
    views.push({ name: pv.name, added: [], removed: pv.rows, changed: [] })
  }
  return { views, totals: { added: tAdded, removed: tRemoved, changed: tChanged }, firstRun: false }
}
