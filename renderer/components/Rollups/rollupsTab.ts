// ENH-243 — pure helpers for the pinned Rollups tab (slot 2, right after
// Vault). Same conditional-synthesized pattern as vaultTab.ts: present only
// while a default vault is set, keyed by a sentinel path, NEVER persisted
// (the session envelope filters it out alongside Home/Vault; App re-syncs it
// from `vault.getDefault` at mount).

import type { FileTab } from '../WorkingPane'
import { isHomeTab } from '../Home/homeTab'
import { isVaultTab } from '../Vault/vaultTab'

/** Constant id the Rollups tab always carries (stable, like Home/Vault). */
export const ROLLUPS_TAB_ID = 'f:rollups'

/** Sentinel path — never hits the filesystem, never persisted. */
export const ROLLUPS_TAB_PATH = 'duo://rollups'

/** Synthesize the Rollups FileTab. */
export function makeRollupsTab(): FileTab {
  return {
    id: ROLLUPS_TAB_ID,
    type: 'rollups',
    path: ROLLUPS_TAB_PATH,
    title: 'Rollups',
    mime: 'application/x-duo-rollups',
  }
}

/** True when a tab is the synthesized Rollups surface (matches on type, like
 *  isVaultTab, so a malformed restore can't smuggle a second one through). */
export function isRollupsTab(tab: { type: FileTab['type'] }): boolean {
  return tab.type === 'rollups'
}

/** Reconcile the Rollups tab's presence to whether a default vault exists.
 *  Inserts a single Rollups tab immediately AFTER Vault (else after Home,
 *  else at the front) when `present`; removes it when `!present`. Idempotent —
 *  returns the SAME array reference when nothing changes. */
export function syncRollupsTab(fileTabs: FileTab[], present: boolean): FileTab[] {
  const count = fileTabs.filter(isRollupsTab).length
  if (present) {
    if (count === 1) return fileTabs
    const without = fileTabs.filter((t) => !isRollupsTab(t))
    const vaultIdx = without.findIndex(isVaultTab)
    const homeIdx = without.findIndex(isHomeTab)
    const at = vaultIdx >= 0 ? vaultIdx + 1 : homeIdx >= 0 ? homeIdx + 1 : 0
    const next = [...without]
    next.splice(at, 0, makeRollupsTab())
    return next
  }
  if (count === 0) return fileTabs
  return fileTabs.filter((t) => !isRollupsTab(t))
}
