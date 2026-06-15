// BUG-207 — the sidecar must not be materialized for fresh notes that carry
// no load-bearing metadata. `sidecarHasLoadBearingContent` is the predicate
// `writeSidecar` gates on; the two pure-UI prefs (now in localStorage) must
// NOT count, so a sidecar holding only them reads as empty.

import { describe, it, expect } from 'vitest'
import {
  emptySidecar,
  sidecarHasLoadBearingContent,
  type SidecarV1
} from './sidecar'

describe('sidecarHasLoadBearingContent (BUG-207)', () => {
  it('is false for an empty sidecar', () => {
    expect(sidecarHasLoadBearingContent(emptySidecar())).toBe(false)
  })

  it('is false for a sidecar holding ONLY the deprecated UI prefs', () => {
    const sc: SidecarV1 = {
      version: 1,
      suggestingMode: true,
      frontmatterPanelCollapsed: false
    }
    expect(sidecarHasLoadBearingContent(sc)).toBe(false)
  })

  it('is true when scripts are set', () => {
    expect(sidecarHasLoadBearingContent({ version: 1, scripts: { allowed: 'once' } })).toBe(true)
  })

  it('is true when a comment exists', () => {
    const sc: SidecarV1 = {
      version: 1,
      comments: [
        { id: 'c1', anchorId: 'a1', author: 'user', ts: '2026-01-01T00:00:00Z', body: 'hi' }
      ]
    }
    expect(sidecarHasLoadBearingContent(sc)).toBe(true)
  })

  it('is true when a resolved-thread record exists', () => {
    const sc: SidecarV1 = {
      version: 1,
      resolvedThreads: { a1: { ts: '2026-01-01T00:00:00Z', by: 'user' } }
    }
    expect(sidecarHasLoadBearingContent(sc)).toBe(true)
  })

  it('is true when recent edits exist', () => {
    const sc: SidecarV1 = {
      version: 1,
      recentEdits: [{ ts: '2026-01-01T00:00:00Z', author: 'user', kind: 'set' }]
    }
    expect(sidecarHasLoadBearingContent(sc)).toBe(true)
  })

  it('is true when free-form properties exist', () => {
    expect(sidecarHasLoadBearingContent({ version: 1, properties: { foo: 1 } })).toBe(true)
  })

  it('is false for empty collections (no comments / no resolved threads)', () => {
    const sc: SidecarV1 = { version: 1, comments: [], resolvedThreads: {}, properties: {} }
    expect(sidecarHasLoadBearingContent(sc)).toBe(false)
  })
})
