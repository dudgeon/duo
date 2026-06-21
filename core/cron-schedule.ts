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

/** A human-readable label for a schedule (Tier 1 — presets get friendly
 *  text; raw cron echoes the expression; a future describer can enrich it). */
export function describeSchedule(s: CronSchedule): string {
  if (s.kind === 'cron') return `cron \`${s.expr.trim()}\``
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
