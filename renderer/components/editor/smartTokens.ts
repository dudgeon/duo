// ENH-208 Vault — smart insertion tokens (D21), the model layer.
//
// `@today`-family tokens that rank ALONGSIDE file results in the shipped
// AtMention (`@`) suggester. Selecting one inserts PLAIN TEXT (an ISO date
// by default; long-form + time variants as sibling entries) — not a
// wikilink. Pure + deterministic (an `asOf` Date is injectable) so it unit
// tests without the editor; the AtMention popover integration (interleaving
// these with VaultFile items + branching the insert) is the UI layer that
// sits on top of this.
//
// Extensible via a token-provider REGISTRY: dates ship now; a future
// provider (e.g. user/snippet tokens) registers an entry-builder without a
// new trigger. `/` stays reserved for a possible future block-insert menu.

/** One selectable smart token. `insertText` is what lands in the doc. */
export interface SmartToken {
  /** Stable id, e.g. `date:today:iso`. */
  id: string
  /** The word matched against the typed query (e.g. `today`). */
  keyword: string
  /** Popover display label (e.g. `today` / `today · long form`). */
  label: string
  /** A preview of the value that will be inserted (e.g. `2026-06-09`). */
  detail: string
  /** The plain text inserted on select. */
  insertText: string
}

/** A provider turns the as-of moment into its candidate tokens. Register
 *  more in {@link TOKEN_PROVIDERS}. */
export type TokenProvider = (asOf: Date) => SmartToken[]

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function startOfDay(d: Date): Date {
  const t = new Date(d)
  t.setHours(0, 0, 0, 0)
  return t
}
function addDays(d: Date, n: number): Date {
  const t = new Date(d)
  t.setDate(t.getDate() + n)
  return t
}
/** Local YYYY-MM-DD (matches the vault's date-only frontmatter). */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
/** Long form, e.g. `June 9, 2026`. */
export function longDate(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}
/** Local time HH:MM. */
export function isoTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** The date provider: today / tomorrow / yesterday (ISO default + a
 *  long-form sibling each) and now (date-time + time-only). */
export const dateTokenProvider: TokenProvider = (asOf) => {
  const today = startOfDay(asOf)
  const tomorrow = addDays(today, 1)
  const yesterday = addDays(today, -1)
  const day = (keyword: string, d: Date): SmartToken[] => [
    { id: `date:${keyword}:iso`, keyword, label: keyword, detail: isoDate(d), insertText: isoDate(d) },
    { id: `date:${keyword}:long`, keyword, label: `${keyword} · long form`, detail: longDate(d), insertText: longDate(d) },
  ]
  return [
    ...day('today', today),
    ...day('tomorrow', tomorrow),
    ...day('yesterday', yesterday),
    {
      id: 'date:now:datetime',
      keyword: 'now',
      label: 'now · date + time',
      detail: `${isoDate(asOf)} ${isoTime(asOf)}`,
      insertText: `${isoDate(asOf)} ${isoTime(asOf)}`,
    },
    { id: 'date:now:time', keyword: 'now', label: 'now · time', detail: isoTime(asOf), insertText: isoTime(asOf) },
  ]
}

/** The registry. Future providers append here. */
export const TOKEN_PROVIDERS: TokenProvider[] = [dateTokenProvider]

function scoreToken(t: SmartToken, q: string): number {
  const k = t.keyword.toLowerCase()
  if (k === q) return 1000
  if (k.startsWith(q)) return 500
  if (k.includes(q)) return 200
  // a query like "long" / "time" surfaces the variant siblings
  if (t.label.toLowerCase().includes(q)) return 50
  return -1
}

/**
 * Tokens matching `query`, best-first. Returns `[]` for an empty query, so
 * a bare `@` shows file results only — tokens surface once the user starts
 * typing a keyword (`@tod` → today/tomorrow). The default (ISO) entry of a
 * keyword outranks its long-form sibling because it scores identically and
 * is emitted first (stable sort).
 */
export function smartTokensFor(query: string, asOf: Date = new Date(), limit = 8): SmartToken[] {
  const q = query.toLowerCase().trim()
  if (!q) return []
  const all = TOKEN_PROVIDERS.flatMap((p) => p(asOf))
  return all
    .map((t) => ({ t, score: scoreToken(t, q) }))
    .filter((s) => s.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.t)
}

/** Type guard so the AtMention `command` can branch SmartToken vs VaultFile. */
export function isSmartToken(item: unknown): item is SmartToken {
  return (
    !!item &&
    typeof item === 'object' &&
    typeof (item as SmartToken).insertText === 'string' &&
    typeof (item as SmartToken).keyword === 'string'
  )
}
