// ENH-208 Vault — smart-token registry tests (D21). Deterministic via a
// fixed asOf. Locks the date math, the query ranking, and the
// surface-only-when-typing behavior the AtMention popover relies on.

import { describe, it, expect } from 'vitest'
import {
  smartTokensFor,
  dateTokenProvider,
  isSmartToken,
  isoDate,
  longDate,
  isoTime,
} from './smartTokens'

// A Tuesday afternoon — easy to reason about ± a day.
const AS_OF = new Date('2026-06-09T14:32:00')

describe('date formatting helpers', () => {
  it('formats ISO / long / time in local terms', () => {
    expect(isoDate(AS_OF)).toBe('2026-06-09')
    expect(longDate(AS_OF)).toBe('June 9, 2026')
    expect(isoTime(AS_OF)).toBe('14:32')
  })
})

describe('dateTokenProvider', () => {
  const tokens = dateTokenProvider(AS_OF)

  it('yields today / tomorrow / yesterday with correct ISO values', () => {
    const byId = Object.fromEntries(tokens.map((t) => [t.id, t.insertText]))
    expect(byId['date:today:iso']).toBe('2026-06-09')
    expect(byId['date:tomorrow:iso']).toBe('2026-06-10')
    expect(byId['date:yesterday:iso']).toBe('2026-06-08')
  })

  it('yields a long-form sibling for each day token', () => {
    expect(tokens.find((t) => t.id === 'date:today:long')!.insertText).toBe('June 9, 2026')
    expect(tokens.find((t) => t.id === 'date:tomorrow:long')!.insertText).toBe('June 10, 2026')
  })

  it('yields now as date+time and time-only', () => {
    expect(tokens.find((t) => t.id === 'date:now:datetime')!.insertText).toBe('2026-06-09 14:32')
    expect(tokens.find((t) => t.id === 'date:now:time')!.insertText).toBe('14:32')
  })
})

describe('smartTokensFor — query ranking', () => {
  it('returns nothing for an empty query (bare @ shows files only)', () => {
    expect(smartTokensFor('', AS_OF)).toEqual([])
    expect(smartTokensFor('   ', AS_OF)).toEqual([])
  })

  it('an exact keyword surfaces its tokens, ISO default first', () => {
    const r = smartTokensFor('today', AS_OF)
    expect(r[0].id).toBe('date:today:iso') // default ISO outranks long-form sibling
    expect(r.map((t) => t.id)).toContain('date:today:long')
  })

  it('a shared prefix surfaces every matching keyword (@to → today + tomorrow)', () => {
    const ids = smartTokensFor('to', AS_OF).map((t) => t.id)
    expect(ids).toContain('date:today:iso')
    expect(ids).toContain('date:tomorrow:iso')
    expect(ids).not.toContain('date:yesterday:iso') // "yesterday" doesn't start with "to"
  })

  it('matches a variant word in the label (e.g. "time")', () => {
    expect(smartTokensFor('time', AS_OF).map((t) => t.id)).toContain('date:now:time')
  })

  it('is case-insensitive and respects the limit', () => {
    expect(smartTokensFor('TODAY', AS_OF).length).toBe(smartTokensFor('today', AS_OF).length)
    expect(smartTokensFor('o', AS_OF, 3).length).toBeLessThanOrEqual(3)
  })

  it('returns [] for a query that matches nothing', () => {
    expect(smartTokensFor('zzz', AS_OF)).toEqual([])
  })
})

describe('isSmartToken type guard', () => {
  it('distinguishes a token from a VaultFile-shaped object', () => {
    expect(isSmartToken(smartTokensFor('today', AS_OF)[0])).toBe(true)
    expect(isSmartToken({ basename: 'Alice Park', relPath: 'people/Alice Park.md' })).toBe(false)
    expect(isSmartToken(null)).toBe(false)
  })
})
