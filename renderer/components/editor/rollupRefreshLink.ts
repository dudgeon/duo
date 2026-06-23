// ENH-229 phase 2 (fast-follow) — "refresh from Markdown". A rendered MD rollup
// carries an action link `[↻ Refresh](duo://rollup/refresh?base=<target>)`.
// Clicking it in Duo's markdown editor emits a `rollup:refresh` event on the
// bus (same event the HTML Refresh button emits), which a watching Claude
// (`duo events --follow`) fulfills by regenerating + summarizing. On GitHub /
// any other viewer the `duo:` link is inert.

/** Parse a `duo://rollup/refresh?base=<target>` action link. Returns the rollup
 *  target (URL-decoded; '' if absent), or null when the href isn't a
 *  rollup-refresh action. Pure — unit-tested; the editor click handler routes
 *  the result to `window.electron.events.emit`. */
export function parseRollupRefreshUri(href: string): { base: string } | null {
  const m = /^duo:\/\/rollup\/refresh(?:\?(.*))?$/i.exec(href.trim())
  if (!m) return null
  return { base: new URLSearchParams(m[1] ?? '').get('base') ?? '' }
}
