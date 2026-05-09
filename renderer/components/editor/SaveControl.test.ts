// Sprint 10 ENH-103 — pin down the SaveControl state-routing
// priority. The pill is presentational; the load-bearing logic is
// the {dirty, saving, saveError} → state map. Drift in the priority
// order silently breaks the four-state UX.

import { describe, it, expect } from 'vitest'
import { deriveSaveControlState } from './SaveControl'

describe('deriveSaveControlState — priority order', () => {
  it('returns "saved" when nothing is happening', () => {
    expect(deriveSaveControlState({ dirty: false, saving: false, saveError: null })).toBe('saved')
  })

  it('returns "unsaved" when dirty without saving or error', () => {
    expect(deriveSaveControlState({ dirty: true, saving: false, saveError: null })).toBe('unsaved')
  })

  it('returns "saving" when saving (regardless of dirty)', () => {
    expect(deriveSaveControlState({ dirty: false, saving: true, saveError: null })).toBe('saving')
    expect(deriveSaveControlState({ dirty: true, saving: true, saveError: null })).toBe('saving')
  })

  it('returns "failed" when saveError is set', () => {
    expect(deriveSaveControlState({ dirty: false, saving: false, saveError: 'ENOSPC' })).toBe('failed')
  })

  it('failed beats saving — defensive against a stuck saving flag', () => {
    // Hypothetical: save IPC throws after setSaving(true) but before
    // finally{setSaving(false)} runs (e.g. component unmount race).
    // The user-facing state should be the failure (actionable), not
    // a stuck spinner (no recovery affordance).
    expect(deriveSaveControlState({ dirty: false, saving: true, saveError: 'EIO' })).toBe('failed')
  })

  it('failed beats unsaved — retry affordance is the priority signal', () => {
    // Right after a save fails, the buffer is still dirty (we never
    // updated lastSavedRef). The pill must say "Failed — retry," not
    // a plain "Save," so the user knows the last attempt errored.
    expect(deriveSaveControlState({ dirty: true, saving: false, saveError: 'EIO' })).toBe('failed')
  })

  it('saving beats unsaved — spinner over Save action', () => {
    // While the autosave-debounced or ⌘S-triggered save is in flight,
    // the buffer is still considered dirty until lastSavedRef updates.
    // The pill should show the spinner, not a "Save" action that
    // would queue a redundant write if clicked.
    expect(deriveSaveControlState({ dirty: true, saving: true, saveError: null })).toBe('saving')
  })

  it('empty-string saveError counts as no error (only truthy strings trigger failed)', () => {
    // Defensive: setSaveError('') would be a bug, but the pill should
    // not flip to "Failed — retry" without a real message to surface.
    expect(deriveSaveControlState({ dirty: true, saving: false, saveError: '' })).toBe('unsaved')
  })
})
