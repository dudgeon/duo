// ENH-188 — pure tab-reorder transform shared by the terminal strip
// (App.tsx § reorderTerminalTab) and extractable by any future reorder
// surface. Mirrors WorkingPane.reorderTab's insert-before/after
// semantics, with one added subtlety: when only a SUBSEQUENCE of the
// array is visible (ENH-182 project focus), the reorder happens within
// the visible subsequence and the result is re-threaded back into the
// slots the visible items originally occupied — so hidden items keep
// their absolute positions and a reorder while focused never disturbs
// another project's tab order.

/**
 * Reorder `sourceId` relative to `targetId` within the visible
 * subsequence of `items` (those for which `isVisible` is true), then
 * splice the reordered visible items back into their original absolute
 * slots. Hidden items are untouched.
 *
 * Direction-aware (matches WorkingPane.reorderTab): if the source was
 * originally LEFT of the target, it lands AFTER the target
 * (drag-rightward intent); if RIGHT, it lands BEFORE (drag-leftward).
 *
 * Returns the original array reference unchanged on any no-op (self-drop,
 * unknown id, or either id not visible) so callers can rely on identity
 * for change detection.
 */
export function reorderVisible<T extends { id: string }>(
  items: T[],
  sourceId: string,
  targetId: string,
  isVisible: (item: T) => boolean
): T[] {
  if (sourceId === targetId) return items
  const visible = items.filter(isVisible)
  const srcIdx = visible.findIndex(t => t.id === sourceId)
  const tgtIdx = visible.findIndex(t => t.id === targetId)
  if (srcIdx < 0 || tgtIdx < 0) return items
  const without = visible.filter(t => t.id !== sourceId)
  const newTgtIdx = without.findIndex(t => t.id === targetId)
  if (newTgtIdx < 0) return items
  const insertAt = srcIdx < tgtIdx ? newTgtIdx + 1 : newTgtIdx
  const newVisible = [...without.slice(0, insertAt), visible[srcIdx], ...without.slice(insertAt)]
  // Re-thread: walk the full array; each slot that held a visible item
  // receives the next item from the reordered visible list, hidden items
  // pass through in place.
  const visibleIds = new Set(visible.map(t => t.id))
  let vi = 0
  return items.map(t => (visibleIds.has(t.id) ? newVisible[vi++] : t))
}
