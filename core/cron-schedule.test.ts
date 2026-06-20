// ENH-221 — schedule math. Uses LOCAL Date construction + asserts on local
// fields so the suite is timezone-independent.
import { describe, it, expect } from 'vitest'
import {
  parseCronExpr,
  scheduleToCronExpr,
  nextFireAfterSchedule,
  describeSchedule,
  validateSchedule,
  parseScheduleArgs,
} from './cron-schedule'
import type { CronSchedule } from '../shared/types'

describe('parseCronExpr', () => {
  it('parses a 5-field expression', () => {
    const f = parseCronExpr('30 9 * * 1-5')
    expect(f.minute.has(30)).toBe(true)
    expect(f.hour.has(9)).toBe(true)
    expect(f.dow.has(1)).toBe(true)
    expect(f.dow.has(5)).toBe(true)
    expect(f.dow.has(0)).toBe(false)
    expect(f.domRestricted).toBe(false)
    expect(f.dowRestricted).toBe(true)
  })

  it('supports lists, ranges, and steps', () => {
    const f = parseCronExpr('0,30 */6 1-3 * *')
    expect([...f.minute].sort((a, b) => a - b)).toEqual([0, 30])
    expect([...f.hour].sort((a, b) => a - b)).toEqual([0, 6, 12, 18])
    expect([...f.dom].sort((a, b) => a - b)).toEqual([1, 2, 3])
  })

  it('normalizes day-of-week 7 to 0 (Sunday)', () => {
    expect(parseCronExpr('0 0 * * 7').dow.has(0)).toBe(true)
  })

  it('rejects wrong field counts and out-of-range values', () => {
    expect(() => parseCronExpr('* * * *')).toThrow(/5 fields/)
    expect(() => parseCronExpr('60 * * * *')).toThrow(/range/)
    expect(() => parseCronExpr('* 24 * * *')).toThrow(/range/)
    expect(() => parseCronExpr('x * * * *')).toThrow()
  })
})

describe('scheduleToCronExpr', () => {
  it('translates presets', () => {
    expect(scheduleToCronExpr({ kind: 'preset', preset: 'hourly', minute: 15 })).toBe('15 * * * *')
    expect(scheduleToCronExpr({ kind: 'preset', preset: 'daily', hour: 9, minute: 0 })).toBe('0 9 * * *')
    expect(scheduleToCronExpr({ kind: 'preset', preset: 'weekdays', hour: 8, minute: 30 })).toBe('30 8 * * 1-5')
    expect(scheduleToCronExpr({ kind: 'preset', preset: 'weekly', weekday: 3, hour: 9, minute: 0 })).toBe('0 9 * * 3')
  })
})

describe('nextFireAfterSchedule', () => {
  it('daily — same day when before the time', () => {
    const s: CronSchedule = { kind: 'preset', preset: 'daily', hour: 9, minute: 0 }
    const next = nextFireAfterSchedule(s, new Date(2026, 0, 1, 8, 0, 0))!
    expect(next.getDate()).toBe(1)
    expect(next.getHours()).toBe(9)
    expect(next.getMinutes()).toBe(0)
  })

  it('daily — next day when already past the time', () => {
    const s: CronSchedule = { kind: 'preset', preset: 'daily', hour: 9, minute: 0 }
    const next = nextFireAfterSchedule(s, new Date(2026, 0, 1, 9, 30, 0))!
    expect(next.getDate()).toBe(2)
    expect(next.getHours()).toBe(9)
  })

  it('hourly at :15', () => {
    const s: CronSchedule = { kind: 'preset', preset: 'hourly', minute: 15 }
    expect(nextFireAfterSchedule(s, new Date(2026, 0, 1, 8, 0))!.getMinutes()).toBe(15)
    const past = nextFireAfterSchedule(s, new Date(2026, 0, 1, 8, 20))!
    expect(past.getHours()).toBe(9)
    expect(past.getMinutes()).toBe(15)
  })

  it('weekdays — skips the weekend (Fri 10:00 → Mon 09:00)', () => {
    // 2026-01-02 is a Friday.
    const s: CronSchedule = { kind: 'preset', preset: 'weekdays', hour: 9, minute: 0 }
    const next = nextFireAfterSchedule(s, new Date(2026, 0, 2, 10, 0))!
    expect(next.getDay()).toBe(1) // Monday
    expect(next.getDate()).toBe(5)
    expect(next.getHours()).toBe(9)
  })

  it('weekly on Wednesday', () => {
    const s: CronSchedule = { kind: 'preset', preset: 'weekly', weekday: 3, hour: 9, minute: 0 }
    const next = nextFireAfterSchedule(s, new Date(2026, 0, 5, 0, 0))! // Monday
    expect(next.getDay()).toBe(3) // Wednesday
    expect(next.getDate()).toBe(7)
  })

  it('honors the dom/dow either-match rule (both restricted)', () => {
    // Fires on the 13th OR any Friday. 2026-01-02 is a Friday, not the 13th.
    const s: CronSchedule = { kind: 'cron', expr: '0 9 13 * 5' }
    const next = nextFireAfterSchedule(s, new Date(2026, 0, 2, 0, 0))!
    expect(next.getDate()).toBe(2) // matched via Friday, not the 13th
    expect(next.getDay()).toBe(5)
  })

  it('returns null for an impossible schedule (Feb 30)', () => {
    const s: CronSchedule = { kind: 'cron', expr: '0 0 30 2 *' }
    expect(nextFireAfterSchedule(s, new Date(2026, 0, 1))).toBeNull()
  })
})

describe('describeSchedule', () => {
  it('produces friendly labels', () => {
    expect(describeSchedule({ kind: 'preset', preset: 'daily', hour: 9, minute: 5 })).toBe('every day at 09:05')
    expect(describeSchedule({ kind: 'preset', preset: 'weekdays', hour: 8, minute: 30 })).toBe('weekdays at 08:30')
    expect(describeSchedule({ kind: 'preset', preset: 'weekly', weekday: 3, hour: 9, minute: 0 })).toBe(
      'every Wednesday at 09:00'
    )
    expect(describeSchedule({ kind: 'preset', preset: 'hourly', minute: 15 })).toBe('every hour at :15')
    expect(describeSchedule({ kind: 'cron', expr: '0 9 * * 1-5' })).toBe('cron `0 9 * * 1-5`')
  })
})

describe('validateSchedule', () => {
  it('throws on a malformed cron expression', () => {
    expect(() => validateSchedule({ kind: 'cron', expr: 'nope' })).toThrow()
    expect(() => validateSchedule({ kind: 'preset', preset: 'daily', hour: 9, minute: 0 })).not.toThrow()
  })
})

describe('parseScheduleArgs', () => {
  it('parses raw cron', () => {
    expect(parseScheduleArgs({ cron: '0 9 * * 1-5' })).toEqual({ kind: 'cron', expr: '0 9 * * 1-5' })
  })

  it('parses daily with --at and defaults to 09:00', () => {
    expect(parseScheduleArgs({ every: 'daily', at: '09:30' })).toEqual({
      kind: 'preset',
      preset: 'daily',
      hour: 9,
      minute: 30,
    })
    expect(parseScheduleArgs({ every: 'daily' })).toEqual({ kind: 'preset', preset: 'daily', hour: 9, minute: 0 })
  })

  it('parses weekly with a weekday name', () => {
    expect(parseScheduleArgs({ every: 'weekly', on: 'wed', at: '08:00' })).toEqual({
      kind: 'preset',
      preset: 'weekly',
      weekday: 3,
      hour: 8,
      minute: 0,
    })
  })

  it('parses hourly with a bare minute', () => {
    expect(parseScheduleArgs({ every: 'hourly', at: ':15' })).toEqual({
      kind: 'preset',
      preset: 'hourly',
      minute: 15,
    })
  })

  it('rejects missing/invalid schedules', () => {
    expect(() => parseScheduleArgs({})).toThrow(/schedule is required/)
    expect(() => parseScheduleArgs({ every: 'weekly' })).toThrow(/--on/)
    expect(() => parseScheduleArgs({ every: 'bogus' })).toThrow(/unknown --every/)
    expect(() => parseScheduleArgs({ every: 'daily', at: '25:00' })).toThrow(/range/)
    expect(() => parseScheduleArgs({ cron: 'too few' })).toThrow()
  })
})
