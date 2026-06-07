// ENH-191 P4 (seam 2) — the per-window byTab prune, extracted as a pure module
// so the C13 cross-window-delete fix is unit-testable without React/DOM.
//
// THE C13 BUG (App.tsx:2759-2779): cozy/fontBump byTab maps live in ONE shared
// localStorage key, and the prune rebuilds the whole map from only THIS window's
// live tab ids — so the moment a second window mounts, its prune silently
// deletes window 1's still-live entries. The fix has two parts: (a) move each
// window's byTab into its OWN per-window state (seam 3, so the maps are
// physically separate), and (b) prune each window's map against only ITS live
// tab ids — this function. Operating on one window's map, it structurally cannot
// touch another window's entries.

/**
 * Keep only the entries whose tab id is still live in this window; drop the
 * rest. Pure: returns a new map, never mutates the input. `T` is the per-tab
 * value (a cozy boolean, a fontBump number, …).
 */
export function pruneByTab<T>(
  byTab: Record<string, T>,
  liveTabIds: Iterable<string>
): Record<string, T> {
  const live = liveTabIds instanceof Set ? liveTabIds : new Set(liveTabIds)
  const pruned: Record<string, T> = {}
  for (const id of Object.keys(byTab)) {
    if (live.has(id)) pruned[id] = byTab[id]
  }
  return pruned
}
