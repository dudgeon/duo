import { describe, it, expect } from 'vitest'
import { VAULT_TAB_ID, VAULT_TAB_PATH, makeVaultTab, isVaultTab, syncVaultTab } from './vaultTab'
import { makeHomeTab } from '../Home/homeTab'
import type { FileTab } from '../WorkingPane'

function editorTab(id: string, path: string): FileTab {
  return { id, type: 'editor', path, title: path.split('/').pop()!, mime: 'text/markdown' }
}

describe('vaultTab — synthesis', () => {
  it('makeVaultTab carries the constant id, sentinel path, and vault type', () => {
    const tab = makeVaultTab()
    expect(tab.id).toBe(VAULT_TAB_ID)
    expect(tab.path).toBe(VAULT_TAB_PATH)
    expect(tab.type).toBe('vault')
    expect(isVaultTab(tab)).toBe(true)
    expect(isVaultTab(makeHomeTab())).toBe(false)
  })
})

describe('syncVaultTab — present-when-default (D4)', () => {
  it('inserts the Vault tab right after Home when present and missing', () => {
    const before: FileTab[] = [makeHomeTab(), editorTab('e1', '/a.md')]
    const after = syncVaultTab(before, true)
    expect(after.map((t) => t.type)).toEqual(['home', 'vault', 'editor'])
    expect(after[1].id).toBe(VAULT_TAB_ID)
  })

  it('inserts at the front when Home is somehow absent', () => {
    const after = syncVaultTab([editorTab('e1', '/a.md')], true)
    expect(after.map((t) => t.type)).toEqual(['vault', 'editor'])
  })

  it('removes the Vault tab when not present', () => {
    const before = syncVaultTab([makeHomeTab(), editorTab('e1', '/a.md')], true)
    const after = syncVaultTab(before, false)
    expect(after.some(isVaultTab)).toBe(false)
    expect(after.map((t) => t.type)).toEqual(['home', 'editor'])
  })

  it('is idempotent — returns the SAME array reference when nothing changes', () => {
    const present = syncVaultTab([makeHomeTab()], true)
    expect(syncVaultTab(present, true)).toBe(present) // already present → no churn
    const absent = [makeHomeTab(), editorTab('e1', '/a.md')]
    expect(syncVaultTab(absent, false)).toBe(absent) // already absent → no churn
  })

  it('collapses a duplicate Vault tab to exactly one', () => {
    const dup: FileTab[] = [makeHomeTab(), makeVaultTab(), editorTab('e1', '/a.md'), makeVaultTab()]
    const after = syncVaultTab(dup, true)
    expect(after.filter(isVaultTab)).toHaveLength(1)
    expect(after.map((t) => t.type)).toEqual(['home', 'vault', 'editor'])
  })
})
