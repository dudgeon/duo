import { describe, it, expect } from 'vitest'
import {
  HOME_TAB_ID,
  HOME_TAB_PATH,
  makeHomeTab,
  isHomeTab,
  filterPersistableFileTabs,
  seedHomeFirst
} from './homeTab'
import type { FileTab } from '../WorkingPane'

/** A non-Home editor tab with a session-local id (as restore mints). */
function editorTab(id: string, path: string): FileTab {
  return { id, type: 'editor', path, title: path.split('/').pop()!, mime: 'text/markdown' }
}

describe('homeTab — constants + synthesis', () => {
  it('makeHomeTab carries the constant id, sentinel path, and home type', () => {
    const tab = makeHomeTab()
    expect(tab.id).toBe(HOME_TAB_ID)
    expect(tab.id).toBe('f:home')
    expect(tab.path).toBe(HOME_TAB_PATH)
    expect(tab.path).toBe('duo://home')
    expect(tab.type).toBe('home')
    expect(tab.title).toBe('Home')
  })

  it('isHomeTab matches on type, not id', () => {
    expect(isHomeTab(makeHomeTab())).toBe(true)
    // A tab that lies about its id but is genuinely an editor is NOT Home.
    expect(isHomeTab({ type: 'editor' })).toBe(false)
    // A tab with type 'home' but a non-constant id is STILL Home (defends
    // the dedup path against a malformed restore).
    expect(isHomeTab({ type: 'home' })).toBe(true)
  })
})

describe('filterPersistableFileTabs — D9 (Home is never persisted)', () => {
  it('drops the Home tab from the persist envelope', () => {
    const tabs = [makeHomeTab(), editorTab('a', '/x/notes.md')]
    const persistable = filterPersistableFileTabs(tabs)
    expect(persistable).toHaveLength(1)
    expect(persistable.every(t => t.type !== 'home')).toBe(true)
    expect(persistable[0].path).toBe('/x/notes.md')
  })

  it('a fileTabs array containing Home serializes WITHOUT it', () => {
    const tabs = [editorTab('a', '/x/a.md'), makeHomeTab(), editorTab('b', '/x/b.md')]
    const persistable = filterPersistableFileTabs(tabs)
    // duo://home must never reach disk (the restore exists-gate must never
    // see it — it would fail files.exists and be silently dropped, but we
    // assert it is filtered upstream of that path entirely).
    expect(persistable.map(t => t.path)).toEqual(['/x/a.md', '/x/b.md'])
    expect(persistable.some(t => t.path === HOME_TAB_PATH)).toBe(false)
  })

  it('is a no-op when there is no Home tab', () => {
    const tabs = [editorTab('a', '/x/a.md')]
    expect(filterPersistableFileTabs(tabs)).toEqual(tabs)
  })
})

describe('seedHomeFirst — synthesize-before-restore', () => {
  it('prepends exactly one Home tab to a restored list', () => {
    const restored = [editorTab('r1', '/x/a.md'), editorTab('r2', '/x/b.md')]
    const seeded = seedHomeFirst(restored)
    const homes = seeded.filter(t => t.type === 'home')
    expect(homes).toHaveLength(1)
    expect(seeded[0].id).toBe(HOME_TAB_ID)
    expect(seeded[0].type).toBe('home')
    // Restored tabs follow, in order, untouched.
    expect(seeded.slice(1).map(t => t.path)).toEqual(['/x/a.md', '/x/b.md'])
  })

  it('seeds Home even into an empty (blank-window) restore', () => {
    const seeded = seedHomeFirst([])
    expect(seeded).toHaveLength(1)
    expect(seeded[0].id).toBe(HOME_TAB_ID)
    expect(seeded[0].type).toBe('home')
  })

  it('collapses a duplicate Home from a corrupt restore to exactly ONE', () => {
    // A malformed envelope that somehow round-tripped a home-typed tab.
    const corrupt: FileTab[] = [
      { id: 'stale-home', type: 'home', path: HOME_TAB_PATH, title: 'Home', mime: 'application/x-duo-home' },
      editorTab('r1', '/x/a.md')
    ]
    const seeded = seedHomeFirst(corrupt)
    const homes = seeded.filter(t => t.type === 'home')
    expect(homes).toHaveLength(1)
    // The surviving Home carries the CONSTANT id (the id every Home
    // subsystem — persist filter, close guard, strip sort — keys on).
    expect(homes[0].id).toBe(HOME_TAB_ID)
    expect(seeded.slice(1).map(t => t.path)).toEqual(['/x/a.md'])
  })

  it('round-trip: filter → restore → seed yields exactly one Home', () => {
    // Live fileTabs (Home + 2 editors) → persist filter → "restore" (ids
    // re-minted, Home absent) → seed.
    const live = [makeHomeTab(), editorTab('a', '/x/a.md'), editorTab('b', '/x/b.md')]
    const persisted = filterPersistableFileTabs(live)
    const restored = persisted.map((t, i) => editorTab(`fresh-${i}`, t.path))
    const seeded = seedHomeFirst(restored)
    expect(seeded.filter(t => t.type === 'home')).toHaveLength(1)
    expect(seeded[0].id).toBe(HOME_TAB_ID)
    expect(seeded.map(t => t.path)).toEqual([HOME_TAB_PATH, '/x/a.md', '/x/b.md'])
  })
})
