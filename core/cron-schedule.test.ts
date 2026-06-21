// ENH-223 — schedule math. Uses LOCAL Date construction + asserts on local
// fields so the suite is timezone-independent.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  parseCronExpr,
  scheduleToCronExpr,
  nextFireAfterSchedule,
  describeSchedule,
  describeCron,
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

  it('rolls over the year boundary (Dec 31 23:00 → Jan 1)', () => {
    const s: CronSchedule = { kind: 'preset', preset: 'daily', hour: 0, minute: 0 }
    const next = nextFireAfterSchedule(s, new Date(2026, 11, 31, 23, 0))!
    expect(next.getFullYear()).toBe(2027)
    expect(next.getMonth()).toBe(0) // January
    expect(next.getDate()).toBe(1)
    expect(next.getHours()).toBe(0)
  })

  it('rolls over the year boundary for a monthly day-of-month schedule', () => {
    // `0 9 1 * *` — 09:00 on the 1st of each month. From mid-December the next
    // 1st is next January.
    const s: CronSchedule = { kind: 'cron', expr: '0 9 1 * *' }
    const next = nextFireAfterSchedule(s, new Date(2026, 11, 15, 0, 0))!
    expect(next.getFullYear()).toBe(2027)
    expect(next.getMonth()).toBe(0) // January
    expect(next.getDate()).toBe(1)
    expect(next.getHours()).toBe(9)
  })
})

// This block deliberately forces a DST zone — the rest of the suite is
// timezone-independent (LOCAL Date construction + local-field assertions). The
// scheduler steps minute-by-minute over LOCAL wall-clock fields, so DST
// transitions are exercised by how getHours()/getMinutes() behave across the
// spring-forward gap and the fall-back repeat.
describe('DST (America/New_York)', () => {
  let prevTZ: string | undefined
  beforeAll(() => {
    prevTZ = process.env.TZ
    process.env.TZ = 'America/New_York'
  })
  afterAll(() => {
    if (prevTZ === undefined) delete process.env.TZ
    else process.env.TZ = prevTZ
  })

  it('skips a nonexistent wall-time on spring-forward (02:30 on the gap day)', () => {
    // 2026-03-08: clocks jump 02:00 → 03:00, so 02:30 never occurs that day.
    // A daily 02:30 schedule, asked from 01:00 that morning, lands on the NEXT
    // day's 02:30 — the gap-day occurrence is skipped.
    const s: CronSchedule = { kind: 'preset', preset: 'daily', hour: 2, minute: 30 }
    const next = nextFireAfterSchedule(s, new Date(2026, 2, 8, 1, 0))!
    // Pins current behavior: the nonexistent 02:30 on spring-forward is SKIPPED
    // (D5 catch-up will not recover it). Flagged for owner review.
    expect(next.getFullYear()).toBe(2026)
    expect(next.getMonth()).toBe(2) // March
    expect(next.getDate()).toBe(9) // the day AFTER the gap
    expect(next.getHours()).toBe(2)
    expect(next.getMinutes()).toBe(30)
  })

  it('fires a duplicated wall-time only once on fall-back (01:30 twice → next is the following day)', () => {
    // 2026-11-01: clocks fall back 02:00 → 01:00, so 01:30 occurs twice. The
    // scheduler steps minute-by-minute, so the FIRST 01:30 it finds is the one
    // it fires; computing the next fire FROM that result advances to the next
    // day rather than re-firing the duplicated 01:30 within the same day.
    const s: CronSchedule = { kind: 'preset', preset: 'daily', hour: 1, minute: 30 }
    const first = nextFireAfterSchedule(s, new Date(2026, 10, 1, 0, 30))!
    expect(first.getFullYear()).toBe(2026)
    expect(first.getMonth()).toBe(10) // November
    expect(first.getDate()).toBe(1)
    expect(first.getHours()).toBe(1)
    expect(first.getMinutes()).toBe(30)

    // The FOLLOWING fire (computed strictly after the first) is Nov 2 — the
    // duplicated 01:30 is not fired a second time.
    const second = nextFireAfterSchedule(s, first)!
    expect(second.getDate()).toBe(2)
    expect(second.getHours()).toBe(1)
    expect(second.getMinutes()).toBe(30)
    expect(second.getTime()).toBeGreaterThan(first.getTime())
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
    // raw cron now flows through the hand-rolled describer
    expect(describeSchedule({ kind: 'cron', expr: '0 9 * * 1-5' })).toBe('every weekday at 09:00')
  })
})

describe('describeCron', () => {
  it('describes daily / point-in-time schedules', () => {
    expect(describeCron('0 9 * * *')).toBe('every day at 09:00')
    expect(describeCron('30 14 * * *')).toBe('every day at 14:30')
    expect(describeCron('5 0 * * *')).toBe('every day at 00:05')
  })

  it('describes weekday / weekend / named-day schedules', () => {
    expect(describeCron('0 9 * * 1-5')).toBe('every weekday at 09:00')
    expect(describeCron('0 9 * * 0,6')).toBe('every weekend day at 09:00')
    expect(describeCron('0 9 * * 1')).toBe('every Monday at 09:00')
    expect(describeCron('0 9 * * 1,3,5')).toBe('every Monday, Wednesday and Friday at 09:00')
    // 0 and 7 both mean Sunday
    expect(describeCron('0 9 * * 7')).toBe('every Sunday at 09:00')
    // 0-6 covers the whole week → every day
    expect(describeCron('0 9 * * 0-6')).toBe('every day at 09:00')
  })

  it('describes day-of-month schedules with month qualifier', () => {
    expect(describeCron('0 9 1 * *')).toBe('at 09:00 on the 1st of each month')
    expect(describeCron('0 9 1,15 * *')).toBe('at 09:00 on the 1st and 15th of each month')
    expect(describeCron('0 0 1 1 *')).toBe('at 00:00 on the 1st of January')
    expect(describeCron('30 6 2,22 * *')).toBe('at 06:30 on the 2nd and 22nd of each month')
  })

  it('describes month-restricted (non-DOM) schedules', () => {
    expect(describeCron('0 9 * 6 1')).toBe('every Monday at 09:00 in June')
    expect(describeCron('0 9 * 1,7 *')).toBe('every day at 09:00 in January and July')
  })

  it('describes sub-hourly and hourly frequencies', () => {
    expect(describeCron('* * * * *')).toBe('every minute')
    expect(describeCron('*/15 * * * *')).toBe('every 15 minutes')
    expect(describeCron('*/5 * * * *')).toBe('every 5 minutes')
    expect(describeCron('0 * * * *')).toBe('every hour, on the hour')
    expect(describeCron('15 * * * *')).toBe('every hour at :15')
  })

  it('describes multi-hour-step and windowed-hourly frequencies', () => {
    expect(describeCron('0 */2 * * *')).toBe('every 2 hours')
    expect(describeCron('30 */2 * * *')).toBe('every 2 hours at :30')
    expect(describeCron('0 9-17 * * *')).toBe('every hour from 09:00 to 17:00')
  })

  it('describes multiple discrete times', () => {
    expect(describeCron('0 9,17 * * *')).toBe('at 09:00 and 17:00 every day')
    expect(describeCron('0 9,13,17 * * 1-5')).toBe('at 09:00, 13:00 and 17:00 on weekdays')
  })

  it('appends a day qualifier to frequency phrases', () => {
    expect(describeCron('*/15 * * * 1-5')).toBe('every 15 minutes on weekdays')
    expect(describeCron('0 * * * 1')).toBe('every hour, on the hour on Mondays')
  })

  it('echoes the raw expression for shapes it cannot render accurately', () => {
    // both day-fields restricted — ambiguous "either matches"
    expect(describeCron('0 9 1 * 1')).toBe('cron `0 9 1 * 1`')
    // exotic minute shape (non-zero-anchored step)
    expect(describeCron('5-50/9 9 * * *')).toBe('cron `5-50/9 9 * * *`')
    // unparseable → echo, never throw
    expect(describeCron('not a cron')).toBe('cron `not a cron`')
  })

  // --- adversarial-audit regressions (workflow wf_6cce5cc2) -------------------

  it('does NOT claim "every N" for steps that do not divide the cyclic period', () => {
    // 7,13,25,50 don't divide 60 → minute field resets at the hour boundary,
    // so the cadence is uneven at the wrap. Must NOT say "every N minutes".
    for (const expr of ['*/7 * * * *', '*/13 * * * *', '*/25 * * * *', '*/50 * * * *']) {
      expect(describeCron(expr)).not.toMatch(/every \d+ minutes/)
    }
    // 5,7,9,11,13 don't divide 24 → resets at the day boundary.
    for (const expr of ['0 */5 * * *', '0 */7 * * *', '0 */9 * * *', '0 */11 * * *']) {
      expect(describeCron(expr)).not.toMatch(/every \d+ hours/)
    }
    // these honestly become explicit-time lists (they fire at fixed clocks)
    expect(describeCron('0 */5 * * *')).toBe('at 00:00, 05:00, 10:00, 15:00 and 20:00 every day')
    expect(describeCron('0 */11 * * *')).toBe('at 00:00, 11:00 and 22:00 every day')
  })

  it('still says "every N" for steps that DO divide the period', () => {
    expect(describeCron('*/15 * * * *')).toBe('every 15 minutes')
    expect(describeCron('*/20 * * * *')).toBe('every 20 minutes')
    expect(describeCron('*/30 * * * *')).toBe('every 30 minutes')
    expect(describeCron('0 */2 * * *')).toBe('every 2 hours')
    expect(describeCron('0 */6 * * *')).toBe('every 6 hours')
    expect(describeCron('0 */12 * * *')).toBe('every 12 hours')
  })

  it('echoes impossible calendar dates rather than describing a fire that never happens', () => {
    // these never fire — the month has no such day
    expect(describeCron('0 9 31 4 *')).toBe('cron `0 9 31 4 *`') // April has no 31st
    expect(describeCron('0 9 30 2 *')).toBe('cron `0 9 30 2 *`') // Feb has no 30th
    expect(describeCron('0 0 30 2 *')).toBe('cron `0 0 30 2 *`')
    expect(describeCron('0 9 31 6 *')).toBe('cron `0 9 31 6 *`') // June has no 31st
    // partial impossibility — the 31st never occurs in Feb, so the whole
    // "15th and 31st of February" phrasing would lie about the 31st
    expect(describeCron('0 9 15,31 2 *')).toBe('cron `0 9 15,31 2 *`')
    expect(describeCron('0 9 31 1,2 *')).toBe('cron `0 9 31 1,2 *`')
    expect(describeCron('0 9 1,15,31 4 *')).toBe('cron `0 9 1,15,31 4 *`')
    // Feb 29 DOES fire in leap years → still describable
    expect(describeCron('0 9 29 2 *')).toBe('at 09:00 on the 29th of February')
    // a possible date with the same month is still described
    expect(describeCron('0 9 15 4 *')).toBe('at 09:00 on the 15th of April')
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
