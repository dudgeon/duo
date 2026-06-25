// ENH-228 — pure helpers for the pinned Vault tab (slot 1, right after Home).
//
// Unlike Home (always present), the Vault tab is CONDITIONAL: it exists only
// while a default vault is set (D4), and re-points at whatever the default is
// (D3). It is synthesized in the renderer and NEVER persisted (the session
// envelope filters it out alongside Home; App re-syncs it from `vault.getDefault`
// at mount). Keyed by its sentinel PATH 'duo://vault' / constant id 'f:vault',
// the same pattern Home uses (homeTab.ts) so close-refusal + the strip's
// leftmost sort can key on it.

import type { FileTab } from '../WorkingPane'
import { isHomeTab } from '../Home/homeTab'

/** Constant id the Vault tab always carries (stable, like Home's). */
export const VAULT_TAB_ID = 'f:vault'

/** Sentinel path. The Vault view is not file-backed; this never hits the
 *  filesystem (it is never persisted, so the restore exists-gate never sees it). */
export const VAULT_TAB_PATH = 'duo://vault'

/** Synthesize the Vault FileTab. */
export function makeVaultTab(): FileTab {
  return {
    id: VAULT_TAB_ID,
    type: 'vault',
    path: VAULT_TAB_PATH,
    title: 'Vault',
    mime: 'application/x-duo-vault',
  }
}

/** True when a tab is the synthesized Vault surface. Matches on type (not id)
 *  so a malformed restore can't smuggle a second Vault through. */
export function isVaultTab(tab: { type: FileTab['type'] }): boolean {
  return tab.type === 'vault'
}

/** Reconcile the Vault tab's presence to whether a default vault exists.
 *  Inserts a single Vault tab immediately AFTER Home when `present` and it's
 *  missing; removes it when `!present`. Idempotent — returns the SAME array
 *  reference when nothing changes (so a no-op effect doesn't churn React state).
 *  Defends against a duplicate by stripping any extra Vault tabs first. */
export function syncVaultTab(fileTabs: FileTab[], present: boolean): FileTab[] {
  const count = fileTabs.filter(isVaultTab).length
  if (present) {
    if (count === 1) return fileTabs
    // Build the desired list: every non-Vault tab, with exactly one Vault tab
    // spliced right after Home (or at the front when Home is somehow absent).
    const withoutVault = fileTabs.filter((t) => !isVaultTab(t))
    const homeIdx = withoutVault.findIndex(isHomeTab)
    const at = homeIdx >= 0 ? homeIdx + 1 : 0
    const next = [...withoutVault]
    next.splice(at, 0, makeVaultTab())
    return next
  }
  if (count === 0) return fileTabs
  return fileTabs.filter((t) => !isVaultTab(t))
}
