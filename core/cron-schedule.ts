// ENH-223 — schedule math for scheduled ("cron") Claude sessions.
//
// Pure + dependency-free. The PRD (D8) locked "add a small cron-parser
// dependency"; Tier 1 ships this self-contained engine instead so the
// feature builds + tests offline with no new runtime dependency and a
// clean esbuild/electron-vite bundle. The whole surface is isolated here
// behind `nextFireAfterSchedule` / `describeSchedule` / `parseScheduleArgs`
// so swapping in `cron-parser` later (if expression coverage needs to grow)
// is a one-file change. Times are LOCAL — `daily at 09:00` fires at the
// wall-clock 9am (DST handled naturally by reading local Date fields).
//
// Supported cron grammar (standard 5-field): minute hour day-of-month
// month day-of-week, each field `*`, a number, `a-b`, `*/s`, `a-b/s`, or a
// comma list of those. DOM/DOW use the usual "either matches when both are
// restricted" rule. DOW accepts 0-7 (0 and 7 = Sunday).

import type { CronSchedule } from '../shared/types'

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
// Greatest day-of-month each month can have (index 1..12). February is 29
// because the engine DOES fire on Feb 29 in leap years — so a Feb-29 schedule
// is describable, but Feb 30/31 (and Apr/Jun/Sep/Nov 31) never occur.
const MAX_DAY_OF_MONTH = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const WEEKDAY_ABBR: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
}

// How far ahead nextFireAfter will scan before giving up (a schedule that
// can never match — e.g. `0 0 30 2 *`, Feb 30 — returns null rather than
// looping forever). 366 days covers every valid annual schedule.
const MAX_SCAN_MINUTES = 366 * 24 * 60

interface CronFields {
  minute: Set<number>
  hour: Set<number>
  dom: Set<number>
  month: Set<number>
  dow: Set<number>
  domRestricted: boolean
  dowRestricted: boolean
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Parse one cron field into the set of matching values in [min,max].
 *  `dow` normalizes 7→0. Throws on malformed input. */
function parseField(raw: string, min: number, max: number, isDow = false): Set<number> {
  const out = new Set<number>()
  const norm = (n: number) => (isDow && n === 7 ? 0 : n)
  for (const part of raw.split(',')) {
    const piece = part.trim()
    if (piece === '') throw new Error(`empty cron field segment in "${raw}"`)
    // step: <range-or-*>/<step>
    let rangePart = piece
    let step = 1
    const slash = piece.indexOf('/')
    if (slash !== -1) {
      rangePart = piece.slice(0, slash)
      const stepStr = piece.slice(slash + 1)
      step = Number(stepStr)
      if (!Number.isInteger(step) || step <= 0) throw new Error(`bad step "${stepStr}" in "${raw}"`)
    }
    let lo: number
    let hi: number
    if (rangePart === '*') {
      lo = min
      hi = max
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-')
      lo = Number(a)
      hi = Number(b)
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) throw new Error(`bad range "${rangePart}" in "${raw}"`)
    } else {
      lo = Number(rangePart)
      hi = lo
      if (!Number.isInteger(lo)) throw new Error(`bad value "${rangePart}" in "${raw}"`)
    }
    if (lo < min || hi > max || lo > hi) {
      throw new Error(`cron field "${piece}" out of range [${min}-${max}] in "${raw}"`)
    }
    for (let v = lo; v <= hi; v += step) out.add(norm(v))
  }
  return out
}

/** Parse a standard 5-field cron expression into matchable field sets.
 *  Throws on anything that isn't exactly 5 valid fields. */
export function parseCronExpr(expr: string): CronFields {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) {
    throw new Error(`cron expression must have 5 fields (minute hour day-of-month month day-of-week); got ${fields.length}: "${expr}"`)
  }
  const [m, h, dom, mon, dow] = fields
  return {
    minute: parseField(m, 0, 59),
    hour: parseField(h, 0, 23),
    dom: parseField(dom, 1, 31),
    month: parseField(mon, 1, 12),
    dow: parseField(dow, 0, 7, true),
    domRestricted: dom.trim() !== '*',
    dowRestricted: dow.trim() !== '*',
  }
}

/** Translate a CronSchedule (preset or raw) to a 5-field cron string. */
export function scheduleToCronExpr(s: CronSchedule): string {
  if (s.kind === 'cron') return s.expr.trim()
  switch (s.preset) {
    case 'hourly':
      return `${s.minute} * * * *`
    case 'daily':
      return `${s.minute} ${s.hour} * * *`
    case 'weekdays':
      return `${s.minute} ${s.hour} * * 1-5`
    case 'weekly':
      return `${s.minute} ${s.hour} * * ${s.weekday}`
  }
}

/** True if `date` (read in LOCAL time) matches the cron fields. */
function matchesFields(date: Date, f: CronFields): boolean {
  if (!f.minute.has(date.getMinutes())) return false
  if (!f.hour.has(date.getHours())) return false
  if (!f.month.has(date.getMonth() + 1)) return false
  const domOk = f.dom.has(date.getDate())
  const dowOk = f.dow.has(date.getDay())
  // Standard cron: when BOTH dom and dow are restricted, match if EITHER
  // hits; when only one is restricted, that one must hit; when neither is
  // restricted, the day is unconstrained.
  if (f.domRestricted && f.dowRestricted) return domOk || dowOk
  if (f.domRestricted) return domOk
  if (f.dowRestricted) return dowOk
  return true
}

/** Validate a schedule (throws with a readable message on a bad cron expr).
 *  Used by `duo cron add` before persisting. */
export function validateSchedule(s: CronSchedule): void {
  // Throws if unparseable.
  parseCronExpr(scheduleToCronExpr(s))
}

/**
 * The next fire time STRICTLY AFTER `after`, computed in local time, or null
 * if no occurrence falls within the scan horizon (an impossible schedule).
 * Minute-granularity: seconds/ms are zeroed and we step minute-by-minute.
 */
export function nextFireAfter(fields: CronFields, after: Date): Date | null {
  const d = new Date(after.getTime())
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1) // strictly after `after`
  for (let i = 0; i < MAX_SCAN_MINUTES; i++) {
    if (matchesFields(d, fields)) return d
    d.setMinutes(d.getMinutes() + 1)
  }
  return null
}

/** Convenience: next fire for a CronSchedule strictly after `after`. */
export function nextFireAfterSchedule(s: CronSchedule, after: Date): Date | null {
  return nextFireAfter(parseCronExpr(scheduleToCronExpr(s)), after)
}

// --- Advanced-cron describer (hand-rolled, no dependency) -------------------
// Turns a 5-field cron expression into natural English for the F3 live preview
// and the Home/CLI schedule labels. The cardinal rule: NEVER describe a
// schedule it can't render accurately — every helper returns null on a shape
// it doesn't confidently handle, and `describeCron` falls back to echoing the
// raw expression. Better to show `0 9-17/2 1,15 * 1-5` verbatim than to lie
// about when it fires. Working from the PARSED sets (not the raw text) keeps
// the description honest regardless of syntactic form (`*/15` and `0,15,30,45`
// describe identically because they ARE identical).

/** Ordinal suffix: 1→1st, 2→2nd, 3→3rd, 11→11th, 21→21st, 31→31st. */
function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

/** Join ['a'] → 'a'; ['a','b'] → 'a and b'; ['a','b','c'] → 'a, b and c'. */
function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

function sortedVals(s: Set<number>): number[] {
  return [...s].sort((a, b) => a - b)
}

function isFull(s: Set<number>, min: number, max: number): boolean {
  return s.size === max - min + 1
}

function eqArr(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** If `vals` is exactly {0, step, 2·step, …} tiling [0, max] with step > 1,
 *  AND the step evenly divides the field's cyclic period (max + 1), return
 *  step; else null. The period check is essential: a slash-7 minute field
 *  tiles 0..59 as {0,7,…,56} but 7 doesn't divide 60, so the field RESETS at
 *  the hour boundary (…:56 → next :00 is a 4-minute gap, not 7) — "every 7
 *  minutes" would be a lie about the cadence at the wrap. Only steps that
 *  divide 60 (minutes) / 24 (hours) fire at a truly uniform interval. */
function detectStep(vals: number[], max: number): number | null {
  if (vals.length < 2 || vals[0] !== 0) return null
  const step = vals[1]
  if (step <= 1) return null
  if ((max + 1) % step !== 0) return null // step must divide the cyclic period
  const expected: number[] = []
  for (let v = 0; v <= max; v += step) expected.push(v)
  return eqArr(vals, expected) ? step : null
}

/** If `vals` is a contiguous run lo..hi (step 1, length > 1, not the full
 *  range), return [lo, hi]; else null. Renders `9-17` as a "from…to" range. */
function detectRange(vals: number[], min: number, max: number): [number, number] | null {
  if (vals.length < 2) return null
  const lo = vals[0]
  const hi = vals[vals.length - 1]
  if (lo === min && hi === max) return null // full range — caller treats as "*"
  for (let i = 0; i < vals.length; i++) if (vals[i] !== lo + i) return null
  return [lo, hi]
}

/** The time-of-day component (minute + hour fields). Returns a structured
 *  result so the caller can phrase it with the day clause, or null if the
 *  shape isn't one we render. */
type TimeDesc =
  | { kind: 'point'; times: string[] } // fires at discrete clock times
  | { kind: 'phrase'; text: string } // a frequency ("every 15 minutes")

function describeTime(minute: Set<number>, hour: Set<number>): TimeDesc | null {
  const mins = sortedVals(minute)
  const hours = sortedVals(hour)
  const minAll = isFull(minute, 0, 59)
  const hourAll = isFull(hour, 0, 23)

  if (minAll && hourAll) return { kind: 'phrase', text: 'every minute' }

  // every N minutes (a minute step across all hours)
  if (hourAll) {
    const ms = detectStep(mins, 59)
    if (ms) return { kind: 'phrase', text: `every ${ms} minutes` }
  }

  if (mins.length === 1) {
    const m = mins[0]
    // every N hours (an hour step), optionally at a non-zero minute
    const hs = detectStep(hours, 23)
    if (hs) {
      return { kind: 'phrase', text: m === 0 ? `every ${hs} hours` : `every ${hs} hours at :${pad2(m)}` }
    }
    if (hourAll) {
      return { kind: 'phrase', text: m === 0 ? 'every hour, on the hour' : `every hour at :${pad2(m)}` }
    }
    // hourly across a contiguous window (e.g. 9-17 → business hours)
    const hr = detectRange(hours, 0, 23)
    if (hr) return { kind: 'phrase', text: `every hour from ${pad2(hr[0])}:${pad2(m)} to ${pad2(hr[1])}:${pad2(m)}` }
    if (hours.length === 1) return { kind: 'point', times: [`${pad2(hours[0])}:${pad2(m)}`] }
    if (hours.length <= 6) return { kind: 'point', times: hours.map((h) => `${pad2(h)}:${pad2(m)}`) }
  }

  return null
}

/** The day component (day-of-month + day-of-week, with month restriction).
 *  Returns a structured day kind + month info, or null on a shape we won't
 *  render (notably the both-restricted "either matches" case, which is too
 *  ambiguous to phrase safely). */
type DayDesc =
  | { kind: 'everyday' }
  | { kind: 'weekdays' }
  | { kind: 'weekends' }
  | { kind: 'dows'; days: number[] } // specific weekdays (0=Sun)
  | { kind: 'doms'; days: number[] } // specific days of month

type MonthDesc = { all: true } | { all: false; months: number[] }

function describeDay(
  dom: Set<number>,
  month: Set<number>,
  dow: Set<number>,
  domRestricted: boolean,
  dowRestricted: boolean,
): { day: DayDesc; month: MonthDesc } | null {
  // Standard cron's "either matches when BOTH are restricted" is genuinely
  // ambiguous in English — echo rather than risk misleading text.
  if (domRestricted && dowRestricted) return null

  const monthAll = isFull(month, 1, 12)
  const months = sortedVals(month)
  if (!monthAll && months.length > 6) return null // too many to read cleanly
  const monthDesc: MonthDesc = monthAll ? { all: true } : { all: false, months }

  let day: DayDesc
  if (dowRestricted) {
    const d = sortedVals(dow)
    if (isFull(dow, 0, 6)) day = { kind: 'everyday' }
    else if (eqArr(d, [1, 2, 3, 4, 5])) day = { kind: 'weekdays' }
    else if (eqArr(d, [0, 6])) day = { kind: 'weekends' }
    else if (d.length <= 4) day = { kind: 'dows', days: d }
    else return null
  } else if (domRestricted) {
    const days = sortedVals(dom)
    if (days.length > 4) return null
    // Honesty: "on the <days> of <months>" claims it fires on each day in each
    // month. If any (day, month) pair is calendar-impossible (e.g. the 31st of
    // April, or anything past the 29th of February), that's a lie about a fire
    // that never happens — echo instead. monthAll → check all 12.
    const monthsToCheck = monthAll ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : months
    for (const d of days) for (const m of monthsToCheck) if (d > MAX_DAY_OF_MONTH[m]) return null
    day = { kind: 'doms', days }
  } else {
    day = { kind: 'everyday' }
  }

  return { day, month: monthDesc }
}

/** Month qualifier when days are addressed by day-of-month: " of each month",
 *  " of January", " of January and July". */
function monthOfClause(m: MonthDesc): string {
  if (m.all) return ' of each month'
  return ` of ${joinList(m.months.map((n) => MONTH_NAMES[n]))}`
}

/** Month qualifier for everything else: "" (every month), " in January", … */
function monthInClause(m: MonthDesc): string {
  if (m.all) return ''
  return ` in ${joinList(m.months.map((n) => MONTH_NAMES[n]))}`
}

/** Weekday list, pluralized for the "on …" form: "Mondays", "Mondays and
 *  Fridays". */
function weekdayPlurals(days: number[]): string {
  return joinList(days.map((n) => `${WEEKDAY_NAMES[n]}s`))
}

/** Weekday list, singular for the "every …" form: "Monday", "Monday and
 *  Friday". */
function weekdaySingulars(days: number[]): string {
  return joinList(days.map((n) => WEEKDAY_NAMES[n]))
}

/**
 * Describe a 5-field cron expression in natural English, e.g.
 *   `0 9 * * 1-5`     → "every weekday at 09:00"
 *   `0 9 1,15 * *`    → "at 09:00 on the 1st and 15th of each month"
 *   `0 9-17 * * *`    → "every hour from 09:00 to 17:00"
 * (a slash-step minute field like 15 renders as "every 15 minutes").
 * Falls back to the raw-echo `cron \`<expr>\`` on any expression it can't
 * render accurately (unparseable, an exotic field shape, or the ambiguous
 * both-day-fields-restricted case).
 */
export function describeCron(expr: string): string {
  const echo = `cron \`${expr.trim()}\``
  let f: CronFields
  try {
    f = parseCronExpr(expr)
  } catch {
    return echo
  }

  const time = describeTime(f.minute, f.hour)
  const dayInfo = describeDay(f.dom, f.month, f.dow, f.domRestricted, f.dowRestricted)
  if (!time || !dayInfo) return echo
  const { day, month } = dayInfo

  // day-of-month is phrased with "of <month>"; everything else with "in <month>".
  const monthTail = day.kind === 'doms' ? monthOfClause(month) : monthInClause(month)

  if (time.kind === 'point') {
    const at = `at ${joinList(time.times)}`
    const single = time.times.length === 1
    switch (day.kind) {
      case 'everyday':
        return (single ? `every day ${at}` : `${at} every day`) + monthTail
      case 'weekdays':
        return (single ? `every weekday ${at}` : `${at} on weekdays`) + monthTail
      case 'weekends':
        return (single ? `every weekend day ${at}` : `${at} on weekends`) + monthTail
      case 'dows':
        return (single ? `every ${weekdaySingulars(day.days)} ${at}` : `${at} on ${weekdayPlurals(day.days)}`) + monthTail
      case 'doms':
        return `${at} on the ${joinList(day.days.map(ordinal))}${monthTail}`
    }
  }

  // frequency phrase ("every 15 minutes", "every hour at :15", …)
  const base = time.text
  switch (day.kind) {
    case 'everyday':
      return base + monthTail
    case 'weekdays':
      return `${base} on weekdays${monthTail}`
    case 'weekends':
      return `${base} on weekends${monthTail}`
    case 'dows':
      return `${base} on ${weekdayPlurals(day.days)}${monthTail}`
    case 'doms':
      return `${base} on the ${joinList(day.days.map(ordinal))}${monthTail}`
  }
}

/** A human-readable label for a schedule — presets get friendly text; raw cron
 *  is run through the hand-rolled `describeCron` describer (echoing the
 *  expression when it can't be rendered accurately). */
export function describeSchedule(s: CronSchedule): string {
  if (s.kind === 'cron') return describeCron(s.expr)
  switch (s.preset) {
    case 'hourly':
      return `every hour at :${pad2(s.minute)}`
    case 'daily':
      return `every day at ${pad2(s.hour)}:${pad2(s.minute)}`
    case 'weekdays':
      return `weekdays at ${pad2(s.hour)}:${pad2(s.minute)}`
    case 'weekly':
      return `every ${WEEKDAY_NAMES[s.weekday] ?? `day ${s.weekday}`} at ${pad2(s.hour)}:${pad2(s.minute)}`
  }
}

/** Parse `HH:MM` → {hour, minute}; throws on a bad value. */
function parseHourMinute(at: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(at.trim())
  if (!m) throw new Error(`--at must be HH:MM (24-hour), got "${at}"`)
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour < 0 || hour > 23) throw new Error(`--at hour out of range (0-23): "${at}"`)
  if (minute < 0 || minute > 59) throw new Error(`--at minute out of range (0-59): "${at}"`)
  return { hour, minute }
}

/** Resolve a weekday token (name, abbr, or 0-6) to 0=Sun..6=Sat. */
function parseWeekday(on: string): number {
  const key = on.trim().toLowerCase()
  if (key in WEEKDAY_ABBR) return WEEKDAY_ABBR[key]
  const n = Number(key)
  if (Number.isInteger(n) && n >= 0 && n <= 6) return n
  throw new Error(`--on must be a weekday (mon/tue/… or 0-6), got "${on}"`)
}

/**
 * Build a CronSchedule from the loose CLI args (`duo cron add`):
 *   { cron }                               → raw 5-field expression
 *   { every: 'hourly', at?: ':MM' | 'HH:MM' }
 *   { every: 'daily'|'weekdays', at?: 'HH:MM' (default 09:00) }
 *   { every: 'weekly', on, at?: 'HH:MM' }
 * Throws a readable error on anything malformed or missing.
 */
export function parseScheduleArgs(args: {
  cron?: string
  every?: string
  at?: string
  on?: string
}): CronSchedule {
  if (args.cron) {
    const expr = args.cron.trim()
    parseCronExpr(expr) // validate eagerly
    return { kind: 'cron', expr }
  }
  const every = args.every?.trim().toLowerCase()
  if (!every) {
    throw new Error('a schedule is required: pass --every <hourly|daily|weekdays|weekly> [--at HH:MM] [--on <weekday>] or --cron "<expr>"')
  }
  switch (every) {
    case 'hourly': {
      // --at accepts ":MM" or "HH:MM" (minute is what matters); default :00.
      let minute = 0
      if (args.at) {
        const t = args.at.trim()
        minute = t.startsWith(':') ? Number(t.slice(1)) : parseHourMinute(t).minute
        if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
          throw new Error(`hourly --at must be a minute :MM (0-59), got "${args.at}"`)
        }
      }
      return { kind: 'preset', preset: 'hourly', minute }
    }
    case 'daily': {
      const { hour, minute } = args.at ? parseHourMinute(args.at) : { hour: 9, minute: 0 }
      return { kind: 'preset', preset: 'daily', hour, minute }
    }
    case 'weekdays': {
      const { hour, minute } = args.at ? parseHourMinute(args.at) : { hour: 9, minute: 0 }
      return { kind: 'preset', preset: 'weekdays', hour, minute }
    }
    case 'weekly': {
      if (!args.on) throw new Error('--every weekly requires --on <weekday> (mon/tue/… or 0-6)')
      const weekday = parseWeekday(args.on)
      const { hour, minute } = args.at ? parseHourMinute(args.at) : { hour: 9, minute: 0 }
      return { kind: 'preset', preset: 'weekly', weekday, hour, minute }
    }
    default:
      throw new Error(`unknown --every preset "${every}". Expected hourly|daily|weekdays|weekly (or use --cron).`)
  }
}
