// ENH-229 phase 2 — pure rollup-layer tests: snapshot/summary (de)serialization,
// summary-log management, and the deterministic diff.

import { describe, it, expect } from 'vitest'
import {
  snapshotComment,
  summaryLogComment,
  extractSnapshot,
  extractSummaryLog,
  prependSummary,
  diffSnapshots,
  type RollupSnapshot,
} from './rollup'

const snap = (rows: Record<string, string>[]): RollupSnapshot => ({
  v: 1,
  views: [{ name: 'Tasks', rows: rows.map((cells) => ({ key: cells.key, cells })) }],
})

describe('ENH-229 rollup core — snapshot + summary embedding', () => {
  it('snapshot round-trips through the embedded comment', () => {
    const s = snap([{ key: 'notes/a.md', status: 'blocked' }])
    const embedded = 'irrelevant body\n' + snapshotComment(s) + '\nmore'
    expect(extractSnapshot(embedded)).toEqual(s)
  })

  it('summary log round-trips, newest-first, filtering garbage entries', () => {
    const log = [{ date: '2026-Jun-23', text: 'latest' }, { date: '2026-Jun-20', text: 'older' }]
    expect(extractSummaryLog(summaryLogComment(log))).toEqual(log)
  })

  it('extractSnapshot returns null on corrupt JSON (degrades to no-prior)', () => {
    expect(extractSnapshot('<!--duo:rollup-snapshot {not json-->')).toBeNull()
    expect(extractSnapshot('no markers here')).toBeNull()
  })

  it('embedded comment survives values containing --> / </style> (no early termination)', () => {
    const s = snap([{ key: 'notes/x.md', title: 'danger --> here </style> <b>' }])
    const comment = snapshotComment(s)
    // the ONLY "-->" is the real terminator at the very end
    expect(comment.indexOf('-->')).toBe(comment.length - 3)
    expect(extractSnapshot('body ' + comment + ' tail')).toEqual(s)
  })

  it('prependSummary is newest-first and capped', () => {
    let log = [] as { date: string; text: string }[]
    for (let i = 0; i < 15; i++) log = prependSummary(log, { date: 'd' + i, text: 't' + i })
    expect(log[0].text).toBe('t14') // newest first
    expect(log.length).toBe(12) // HISTORY_CAP
  })
})

describe('ENH-229 rollup core — diff', () => {
  it('firstRun when there is no prior snapshot', () => {
    const d = diffSnapshots(null, snap([{ key: 'notes/a.md', status: 'blocked' }]))
    expect(d.firstRun).toBe(true)
    expect(d.totals).toEqual({ added: 0, removed: 0, changed: 0 })
  })

  it('detects added, removed, and per-field changed rows', () => {
    const prior = snap([
      { key: 'notes/a.md', status: 'blocked' },
      { key: 'notes/b.md', status: 'on-track' },
    ])
    const current = snap([
      { key: 'notes/a.md', status: 'done' }, // changed
      { key: 'notes/c.md', status: 'on-track' }, // added
      // b.md removed
    ])
    const d = diffSnapshots(prior, current)
    expect(d.firstRun).toBe(false)
    expect(d.totals).toEqual({ added: 1, removed: 1, changed: 1 })
    const v = d.views[0]
    expect(v.added.map((r) => r.key)).toEqual(['notes/c.md'])
    expect(v.removed.map((r) => r.key)).toEqual(['notes/b.md'])
    expect(v.changed).toEqual([{ key: 'notes/a.md', fields: [{ col: 'status', from: 'blocked', to: 'done' }] }])
  })

  it('a renamed/new view shows its rows as all-added (no false changes)', () => {
    const prior: RollupSnapshot = { v: 1, views: [{ name: 'Old', rows: [{ key: 'x', cells: { key: 'x' } }] }] }
    const current: RollupSnapshot = { v: 1, views: [{ name: 'New', rows: [{ key: 'x', cells: { key: 'x' } }] }] }
    const d = diffSnapshots(prior, current)
    expect(d.totals).toEqual({ added: 1, removed: 0, changed: 0 })
  })
})
