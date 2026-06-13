// ENH-212 — pure helpers for the permanent Home tab (slot 0).
//
// Home is synthesized at App mount in every window (D9 / D11) and NEVER
// persisted: the session envelope filters it out (App.tsx:806 persist
// filter) and restore re-mints fresh ids for the file tabs it DID persist
// (keyed off path). Because Home is keyed by its sentinel PATH 'duo://home'
// — not by id — a persisted `activeWorking` of that path resolves against
// the constant-id Home tab the seed installs before restore runs.
//
// These helpers are extracted as pure functions so the seed/filter
// round-trip is unit-testable without mounting App (homeTab.test.ts):
//
//   - HOME_TAB_ID / HOME_TAB_PATH — the constants restore + persist key on.
//   - makeHomeTab()     — the synthesized FileTab (constant id).
//   - filterPersistableFileTabs() — drops Home from the persist envelope.
//   - seedHomeFirst()   — guarantees exactly one Home tab, sorted leftmost,
//                         in front of a freshly-restored fileTabs list.

import type { FileTab } from '../WorkingPane'

/** Constant id the Home tab always carries. Unlike file tabs (whose ids are
 *  minted per session), Home's id is stable so the persist filter, the
 *  close-refusal guard, and the strip's leftmost sort can all key on it. */
export const HOME_TAB_ID = 'f:home'

/** Sentinel path. Home is not file-backed; this never hits the filesystem
 *  (the restore exists-gate must never see it — it is never persisted). */
export const HOME_TAB_PATH = 'duo://home'

/** Synthesize the Home FileTab. Same shape every window (D9) — nothing is
 *  cloned, Home is identical everywhere (incl. blank ⌥⌘N windows). */
export function makeHomeTab(): FileTab {
  return {
    id: HOME_TAB_ID,
    type: 'home',
    path: HOME_TAB_PATH,
    title: 'Home',
    mime: 'application/x-duo-home'
  }
}

/** True when a tab is the synthesized Home surface. Matches on type rather
 *  than id so a malformed restore can't smuggle a second Home through. */
export function isHomeTab(tab: { type: FileTab['type'] }): boolean {
  return tab.type === 'home'
}

/** Drop the Home tab from a fileTabs array before it enters the session
 *  envelope (D9 — Home is re-synthesized at mount, never restored). */
export function filterPersistableFileTabs(fileTabs: FileTab[]): FileTab[] {
  return fileTabs.filter(t => !isHomeTab(t))
}

/** Return `fileTabs` with exactly ONE Home tab, sorted leftmost.
 *
 *  Restore mints fresh ids for persisted file tabs but never persists Home,
 *  so the restored list contains zero Home tabs in the normal case. We still
 *  defend against a duplicate (a corrupt envelope, a forward-migration edge)
 *  by stripping any Home tabs the restore produced and prepending the single
 *  constant-id Home — the id every other Home subsystem keys on. */
export function seedHomeFirst(fileTabs: FileTab[]): FileTab[] {
  const withoutHome = fileTabs.filter(t => !isHomeTab(t))
  return [makeHomeTab(), ...withoutHome]
}
