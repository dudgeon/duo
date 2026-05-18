// BUG-138 Phase 2 — coverage for the silent sidecar→inline migration.
//
// Tests are pure-string-in / pure-string-out (the migration runs
// before the editor mounts the body) so this file uses the default
// `node` vitest environment.

import { describe, it, expect } from 'vitest'
import type { SidecarComment, SidecarV1 } from '../Page/sidecar'
import {
  bodyHasCriticMarkup,
  collapseRepliesIntoBody,
  migrateSidecarCommentsToInline
} from './migrateSidecarComments'

function comment(over: Partial<SidecarComment>): SidecarComment {
  return {
    id: 'msg-1',
    anchorId: 'c-1',
    author: 'dudgeon',
    ts: '2026-05-18T12:00:00Z',
    body: 'first thought',
    excerpt: 'target text',
    contextBefore: '',
    contextAfter: '',
    ...over
  }
}

function sidecar(comments: SidecarComment[]): SidecarV1 {
  return { version: 1, comments }
}

describe('bodyHasCriticMarkup', () => {
  it('returns false for prose with no CriticMarkup', () => {
    expect(bodyHasCriticMarkup('Plain markdown body, *with italics*.')).toBe(false)
  })
  it('detects insertion token', () => {
    expect(bodyHasCriticMarkup('Hello {++world++}.')).toBe(true)
  })
  it('detects deletion token', () => {
    expect(bodyHasCriticMarkup('Hello {--world--}.')).toBe(true)
  })
  it('detects substitution token', () => {
    expect(bodyHasCriticMarkup('Hello {~~old~>new~~}.')).toBe(true)
  })
  it('detects highlight token', () => {
    expect(bodyHasCriticMarkup('Hello {==marked==}.')).toBe(true)
  })
  it('detects comment token', () => {
    expect(bodyHasCriticMarkup('Hello {>>id:c-1|body<<}.')).toBe(true)
  })
})

describe('collapseRepliesIntoBody', () => {
  it('returns empty string for no entries', () => {
    expect(collapseRepliesIntoBody([])).toBe('')
  })
  it('returns the single body verbatim for a single entry', () => {
    expect(collapseRepliesIntoBody([comment({ body: 'only thought' })])).toBe('only thought')
  })
  it('joins lead + replies with `↪ @author <ts>:` separators (single-line, no blank lines)', () => {
    const lead = comment({ id: 'msg-1', body: 'lead', author: 'dudgeon', ts: '2026-05-18T12:00:00Z' })
    const r1 = comment({ id: 'msg-2', body: 'reply one', author: 'claude', ts: '2026-05-18T12:01:00Z' })
    const r2 = comment({ id: 'msg-3', body: 'reply two', author: 'dudgeon', ts: '2026-05-18T12:02:00Z' })
    expect(collapseRepliesIntoBody([lead, r1, r2])).toBe(
      'lead\n↪ @claude 2026-05-18T12:01:00Z: reply one\n↪ @dudgeon 2026-05-18T12:02:00Z: reply two'
    )
  })

  it('collapses blank lines inside reply bodies to soft breaks (no `\\n\\n`)', () => {
    const lead = comment({ id: 'msg-1', body: 'paragraph one\n\nparagraph two', author: 'dudgeon', ts: '2026-05-18T12:00:00Z' })
    const r1 = comment({ id: 'msg-2', body: 'reply with\n\nblank line', author: 'claude', ts: '2026-05-18T12:01:00Z' })
    const joined = collapseRepliesIntoBody([lead, r1])
    expect(joined).not.toMatch(/\n\n/)
    expect(joined).toContain('paragraph one\nparagraph two')
    expect(joined).toContain('reply with\nblank line')
  })
})

describe('migrateSidecarCommentsToInline', () => {
  it('is a no-op when sidecar.comments is undefined', () => {
    const sc: SidecarV1 = { version: 1 }
    const result = migrateSidecarCommentsToInline('body', sc)
    expect(result.bodyChanged).toBe(false)
    expect(result.sidecarChanged).toBe(false)
    expect(result.migrated).toBe(0)
    expect(result.body).toBe('body')
  })

  it('is a no-op when sidecar.comments is empty', () => {
    const result = migrateSidecarCommentsToInline('body', sidecar([]))
    expect(result.bodyChanged).toBe(false)
    expect(result.migrated).toBe(0)
  })

  it('is a no-op when the body already contains CriticMarkup (idempotent)', () => {
    const body = 'Already has {++insertion++} here.\nAnd target text here.'
    const sc = sidecar([comment({ excerpt: 'target text' })])
    const result = migrateSidecarCommentsToInline(body, sc)
    expect(result.bodyChanged).toBe(false)
    expect(result.sidecarChanged).toBe(false)
    expect(result.body).toBe(body)
    // Sidecar should be untouched, even the orphans bucket stays empty.
    expect(result.sidecar.comments?.length).toBe(1)
  })

  it('migrates a single anchored comment into the body', () => {
    const body = 'Some prose with target text in it.'
    const sc = sidecar([comment({
      anchorId: 'c-1',
      author: 'dudgeon',
      ts: '2026-05-18T12:00:00Z',
      body: 'good point',
      excerpt: 'target text'
    })])
    const result = migrateSidecarCommentsToInline(body, sc)
    expect(result.migrated).toBe(1)
    expect(result.orphans).toBe(0)
    expect(result.bodyChanged).toBe(true)
    expect(result.sidecarChanged).toBe(true)
    expect(result.body).toBe(
      'Some prose with {==target text==}{>>id:c-1|author:dudgeon|ts:2026-05-18T12:00:00Z|good point<<} in it.'
    )
    expect(result.sidecar.comments).toEqual([])
  })

  it('collapses multi-entry thread into one anchored comment body (single-line, no blank lines)', () => {
    const body = 'Prose with target text in it.'
    const sc = sidecar([
      comment({ id: 'msg-1', anchorId: 'c-1', body: 'lead body', ts: '2026-05-18T12:00:00Z' }),
      comment({ id: 'msg-2', anchorId: 'c-1', body: 'reply 1', author: 'claude', ts: '2026-05-18T12:01:00Z' }),
      comment({ id: 'msg-3', anchorId: 'c-1', body: 'reply 2', author: 'dudgeon', ts: '2026-05-18T12:02:00Z' })
    ])
    const result = migrateSidecarCommentsToInline(body, sc)
    expect(result.migrated).toBe(1)
    expect(result.body).toContain('{==target text==}')
    expect(result.body).toContain('lead body')
    expect(result.body).toContain('↪ @claude 2026-05-18T12:01:00Z: reply 1')
    expect(result.body).toContain('↪ @dudgeon 2026-05-18T12:02:00Z: reply 2')
    // Critical: the embedded body must never contain a blank line — see
    // collapseRepliesIntoBody's docstring.
    const tokenStart = result.body.indexOf('{>>')
    const tokenEnd = result.body.indexOf('<<}')
    expect(result.body.slice(tokenStart, tokenEnd)).not.toMatch(/\n\n/)
    // All 3 entries should be removed since they shared an anchorId.
    expect(result.sidecar.comments).toEqual([])
  })

  it('leaves orphans in the sidecar when re-anchor fails', () => {
    const body = 'Plain prose with nothing relevant.'
    const sc = sidecar([
      comment({ anchorId: 'c-1', excerpt: 'missing fixture target' }) // not in body
    ])
    const result = migrateSidecarCommentsToInline(body, sc)
    expect(result.migrated).toBe(0)
    expect(result.orphans).toBe(1)
    // No body change.
    expect(result.body).toBe(body)
    // No sidecar change (the result helper bails early when nothing migrates).
    expect(result.sidecarChanged).toBe(false)
    expect(result.sidecar.comments?.length).toBe(1)
  })

  it('migrates one anchor + leaves an orphan when both are present', () => {
    const body = 'Found target text but nothing else here.'
    const sc = sidecar([
      comment({ anchorId: 'c-1', excerpt: 'target text', body: 'on this' }),
      comment({ anchorId: 'c-2', excerpt: 'missing anchor text', body: 'will be orphaned' })
    ])
    const result = migrateSidecarCommentsToInline(body, sc)
    expect(result.migrated).toBe(1)
    expect(result.orphans).toBe(1)
    expect(result.body).toContain('{==target text==}{>>id:c-1|')
    // Orphan stays in the sidecar.
    expect(result.sidecar.comments?.length).toBe(1)
    expect(result.sidecar.comments?.[0].anchorId).toBe('c-2')
  })

  it('migrates multiple non-overlapping anchors in reverse-order to preserve offsets', () => {
    const body = 'First target text and second other phrase.'
    const sc = sidecar([
      comment({ anchorId: 'c-1', excerpt: 'target text', body: 'first comment' }),
      comment({ anchorId: 'c-2', excerpt: 'other phrase', body: 'second comment' })
    ])
    const result = migrateSidecarCommentsToInline(body, sc)
    expect(result.migrated).toBe(2)
    expect(result.body).toBe(
      'First {==target text==}{>>id:c-1|author:dudgeon|ts:2026-05-18T12:00:00Z|first comment<<} and second {==other phrase==}{>>id:c-2|author:dudgeon|ts:2026-05-18T12:00:00Z|second comment<<}.'
    )
  })

  it('treats overlapping anchors as: first wins, later overlappers become orphans', () => {
    // Two anchors whose excerpts overlap in the body.
    const body = 'A wider phrase here.'
    const sc = sidecar([
      comment({ anchorId: 'c-1', excerpt: 'wider phrase', body: 'first wins' }),
      comment({ anchorId: 'c-2', excerpt: 'phrase here', body: 'overlaps, orphaned' })
    ])
    const result = migrateSidecarCommentsToInline(body, sc)
    expect(result.migrated).toBe(1)
    expect(result.orphans).toBe(1)
    expect(result.body).toContain('{==wider phrase==}{>>id:c-1|')
    expect(result.sidecar.comments?.[0].anchorId).toBe('c-2')
  })

  it('uses contextBefore/contextAfter to disambiguate duplicate excerpts', () => {
    const body = 'Match here once.\nMatch here twice.'
    const sc = sidecar([
      comment({
        anchorId: 'c-1',
        excerpt: 'Match here',
        contextBefore: '',
        contextAfter: ' twice', // should pick the second occurrence
        body: 'the second one'
      })
    ])
    const result = migrateSidecarCommentsToInline(body, sc)
    expect(result.migrated).toBe(1)
    expect(result.body).toBe(
      'Match here once.\n{==Match here==}{>>id:c-1|author:dudgeon|ts:2026-05-18T12:00:00Z|the second one<<} twice.'
    )
  })

  it('skips entries with empty excerpt (defensive)', () => {
    const sc = sidecar([
      comment({ anchorId: 'c-1', excerpt: '', body: 'no anchor text' })
    ])
    const result = migrateSidecarCommentsToInline('body', sc)
    expect(result.migrated).toBe(0)
    expect(result.orphans).toBe(1)
  })

  it('preserves other sidecar fields untouched', () => {
    const sc: SidecarV1 = {
      version: 1,
      comments: [comment({ anchorId: 'c-1', excerpt: 'target text' })],
      scripts: { allowed: 'once' },
      resolvedThreads: { 'c-1': { ts: '2026-05-18T12:00:00Z', by: 'dudgeon' } },
      recentEdits: [
        { ts: '2026-05-18T12:00:00Z', author: 'dudgeon', kind: 'set' }
      ],
      properties: { custom: 'value' }
    }
    const result = migrateSidecarCommentsToInline('Prose with target text.', sc)
    expect(result.migrated).toBe(1)
    expect(result.sidecar.scripts).toEqual({ allowed: 'once' })
    expect(result.sidecar.resolvedThreads).toEqual({ 'c-1': { ts: '2026-05-18T12:00:00Z', by: 'dudgeon' } })
    expect(result.sidecar.recentEdits?.length).toBe(1)
    expect(result.sidecar.properties).toEqual({ custom: 'value' })
  })
})
