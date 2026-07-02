// ENH-243 — the synthesized Rollups tab's reconcile helper (mirrors
// vaultTab.test.ts: presence gate, slot-after-Vault ordering, idempotence,
// duplicate defense).

import { describe, it, expect } from 'vitest'
import type { FileTab } from '../WorkingPane'
import { makeRollupsTab, isRollupsTab, syncRollupsTab, ROLLUPS_TAB_ID } from './rollupsTab'
import { makeVaultTab } from '../Vault/vaultTab'
import { makeHomeTab } from '../Home/homeTab'

const editor = (id: string): FileTab => ({
  id: `f:${id}`,
  type: 'editor',
  path: `/tmp/${id}.md`,
  title: `${id}.md`,
  mime: 'text/markdown',
})

describe('syncRollupsTab (ENH-243)', () => {
  it('inserts exactly one Rollups tab right after Vault', () => {
    const tabs = [makeHomeTab(), makeVaultTab(), editor('a')]
    const next = syncRollupsTab(tabs, true)
    expect(next.map((t) => t.type)).toEqual(['home', 'vault', 'rollups', 'editor'])
    expect(next.filter(isRollupsTab)).toHaveLength(1)
    expect(next.find(isRollupsTab)?.id).toBe(ROLLUPS_TAB_ID)
  })

  it('falls back to after-Home when Vault is absent (transient during sync)', () => {
    const next = syncRollupsTab([makeHomeTab(), editor('a')], true)
    expect(next.map((t) => t.type)).toEqual(['home', 'rollups', 'editor'])
  })

  it('is idempotent — same array reference when nothing changes', () => {
    const tabs = [makeHomeTab(), makeVaultTab(), makeRollupsTab(), editor('a')]
    expect(syncRollupsTab(tabs, true)).toBe(tabs)
    const without = [makeHomeTab(), editor('a')]
    expect(syncRollupsTab(without, false)).toBe(without)
  })

  it('removes the tab when no default vault exists', () => {
    const tabs = [makeHomeTab(), makeVaultTab(), makeRollupsTab(), editor('a')]
    const next = syncRollupsTab(tabs, false)
    expect(next.some(isRollupsTab)).toBe(false)
  })

  it('strips duplicates smuggled in by a malformed restore', () => {
    const tabs = [makeHomeTab(), makeVaultTab(), makeRollupsTab(), makeRollupsTab(), editor('a')]
    const next = syncRollupsTab(tabs, true)
    expect(next.filter(isRollupsTab)).toHaveLength(1)
  })
})
