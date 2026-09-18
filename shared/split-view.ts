// ENH-041 / BUG-270 — Split View aux ratio, one clamp for every caller.
//
// The aux slot's `splitPct` is the AUX column's width as a fraction of the
// working pane (0.20–0.80, locked spec § 7). The same clamp used to be
// re-typed in three places — `electron/main.ts` (`duo split-view resize`),
// `renderer/App.tsx` (the WORKING_AUX_RESIZE subscriber) and the divider drag
// in `renderer/components/WorkingPane.tsx` — which is how the CLI path drifted
// (BUG-270: resize only ever reached the file-aux slot).

/** Narrowest the aux column may be dragged / set (fraction of the pane). */
export const AUX_SPLIT_MIN = 0.20
/** Widest the aux column may be dragged / set (fraction of the pane). */
export const AUX_SPLIT_MAX = 0.80
/** The canonical "even" aux ratio (ENH-126 aux-open snap, ⌘⌥4, divider
 *  double-click). */
export const AUX_SPLIT_EVEN = 0.5

/**
 * Clamp a FRACTION (never a percentage) into
 * [{@link AUX_SPLIT_MIN}, {@link AUX_SPLIT_MAX}].
 *
 * This is the divider-drag / IPC-subscriber form: a drag past the pane's left
 * edge legitimately computes a fraction > 1 and must land on the MAXIMUM aux
 * width, so it must never be re-read as a percentage.
 *
 * A non-finite input falls back to {@link AUX_SPLIT_EVEN} rather than
 * poisoning the layout: `splitPct` feeds a CSS `flex-grow` on both columns,
 * and a `NaN` (or a negative `1 - pct`) invalidates the shorthand — the main
 * column collapses and the aux takes the whole pane.
 */
export function clampAuxSplitFraction(frac: number): number {
  if (typeof frac !== 'number' || !Number.isFinite(frac)) return AUX_SPLIT_EVEN
  return Math.min(Math.max(frac, AUX_SPLIT_MIN), AUX_SPLIT_MAX)
}

/**
 * CLI-facing clamp: accepts either a decimal fraction (`0.35`) or a
 * percentage (`35`) — anything greater than 1 is read as a percentage, then
 * clamped by {@link clampAuxSplitFraction}. Only for typed input
 * (`duo split-view resize <pct>`); measured geometry uses the fraction form.
 */
export function clampAuxSplitPct(pct: number): number {
  const decimal = typeof pct === 'number' && pct > 1 ? pct / 100 : pct
  return clampAuxSplitFraction(decimal)
}
