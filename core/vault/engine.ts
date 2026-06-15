// ENH-208 Vault — the Bases expression engine (PR2). A faithful port of
// the prototype's `render.mjs` evaluator: it implements EXACTLY the subset
// of Obsidian Bases expressions the fixtures use (and the locked extension
// points — `if`→ternary, link `== this`, date math, date-only = local
// midnight, `file.name` = extension-less, child→parent backlink chains).
// The engine and the linter (`lint.ts`) share one vocabulary; anything
// outside it renders as a ⚠ cell rather than throwing (D15 warn-and-render).
//
// SECURITY / TRUST: expressions are evaluated via `new Function` + `with`.
// `.base` files are local vault files authored by the user or Claude — the
// same trust level as any file the user opens in the editor. The engine
// never fetches or evaluates remote content. (Phase 3 note: if this module
// is ever run inside the renderer, move eval into a Worker/vm sandbox; the
// `ensureEngineGlobals` patch below is deferred to first render to keep a
// bare import side-effect-free.)

import type { VaultFile } from './types'
import { targetKey } from '../markdown/vaultLinks'

export const DAY_MS = 86400000

/** Wraps a JS Date with the Bases date API the fixtures use. */
export class DuoDate {
  d: Date
  constructor(d: Date | number | string, private asOf: Date) {
    this.d = d instanceof Date ? d : new Date(d)
  }
  valueOf(): number {
    return this.d.getTime()
  }
  relative(): string {
    const days = Math.round((this.d.getTime() - this.asOf.getTime()) / DAY_MS)
    if (days === 0) return 'today'
    if (days > 0) return 'in ' + days + (days === 1 ? ' day' : ' days')
    return -days + (days === -1 ? ' day ago' : ' days ago')
  }
  format(fmt: string): string {
    const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return fmt
      .replace('YYYY', String(this.d.getFullYear()))
      .replace('MMM', M[this.d.getMonth()])
      .replace('DD', String(this.d.getDate()).padStart(2, '0'))
      .replace('D', String(this.d.getDate()))
  }
  toString(): string {
    return this.format('MMM D, YYYY')
  }
}

const DUR_UNITS: Record<string, number> = {
  s: 1000, second: 1000, seconds: 1000,
  m: 60000, minute: 60000, minutes: 60000,
  h: 3600000, hour: 3600000, hours: 3600000,
  d: DAY_MS, day: DAY_MS, days: DAY_MS,
  w: 7 * DAY_MS, week: 7 * DAY_MS, weeks: 7 * DAY_MS,
  M: 30 * DAY_MS, month: 30 * DAY_MS, months: 30 * DAY_MS,
  y: 365 * DAY_MS, year: 365 * DAY_MS, years: 365 * DAY_MS,
}
function GB_DUR(s: unknown): number {
  const m = String(s).trim().match(/^(\d+)\s*([A-Za-z]+)$/)
  if (!m || !(m[2] in DUR_UNITS)) throw new Error('bad duration: ' + s)
  return Number(m[1]) * DUR_UNITS[m[2]]
}

/** A wikilink value with an optional display alias. */
export class Link {
  target: string
  display: string
  constructor(target: string, display?: string) {
    this.target = target
    this.display = display || target
  }
  toString(): string {
    return this.display
  }
}

/** Convert a frontmatter scalar into engine value space: `[[X]]` → Link,
 *  a date scalar → DuoDate (shifted UTC→local midnight so day math matches
 *  the written date), arrays mapped recursively, everything else verbatim. */
function parseLinkish(v: unknown, asOf: Date): unknown {
  if (typeof v === 'string') {
    const m = v.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/)
    if (m) return new Link(m[1].trim(), m[2] && m[2].trim())
    return v
  }
  if (Array.isArray(v)) return v.map((x) => parseLinkish(x, asOf))
  if (v instanceof Date) {
    return new DuoDate(new Date(v.getTime() + v.getTimezoneOffset() * 60000), asOf)
  }
  return v
}

function gbEq(a: unknown, b: unknown): boolean {
  const name = (x: any) => (x instanceof Link ? x.target : x && x.name ? x.name : x)
  return name(a) === name(b)
}

/** An engine-side note object — the shape `.base` expressions see as a row
 *  (`file.*`) and as link targets. Mirrors render.mjs's file objects. */
export interface EngineFile {
  name: string
  basename: string
  path: string
  folder: string
  ext: string
  mtime: DuoDate
  properties: Record<string, unknown>
  _rawLinks: string[]
  links: EngineFile[]
  backlinks: EngineFile[]
  hasTag(): boolean
  hasLink(other: unknown): boolean
  inFolder(f: string): boolean
  hasProperty(n: string): boolean
  asFile(): EngineFile
  toString(): string
}

/** Build engine files from parsed notes and wire the link graph
 *  (links + reverse backlinks), resolving wikilinks by basename. */
export function buildEngineFiles(notes: VaultFile[], asOf: Date): EngineFile[] {
  const files: EngineFile[] = notes.map((n) => {
    const properties: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(n.frontmatter)) properties[k] = parseLinkish(v, asOf)
    const f: EngineFile = {
      name: n.basename,
      basename: n.basename,
      path: n.relPath,
      folder: n.folder,
      ext: n.ext,
      mtime: new DuoDate(new Date(n.mtimeMs), asOf),
      properties,
      // ENH-216: `n.links` keys are syntax-plural (wikilink + mdlink), FOLDED
      // via vaultLinks.targetKey (`Q3 Launch`/`q3-launch` → `q3-launch`). The
      // graph wiring below keys `byName` by the SAME folded targetKey so the
      // lookup matches; frontmatter wikilink VALUES are still parsed as Link
      // objects (parseLinkish) and folded at the `hasLink` probe.
      _rawLinks: n.links,
      links: [],
      backlinks: [],
      hasTag: () => false,
      hasLink(other: unknown) {
        const raw = other instanceof Link ? other.target : (other as any)?.name ?? other
        // _rawLinks are folded keys (ENH-216); fold the probe to match.
        return this._rawLinks.includes(targetKey(String(raw), 'wikilink'))
      },
      inFolder(folder: string) {
        return this.folder === folder || this.folder.startsWith(folder + '/')
      },
      hasProperty(name: string) {
        return name in this.properties
      },
      asFile() {
        return this
      },
      toString() {
        return n.basename
      },
    }
    return f
  })
  // Key by the SAME folded targetKey the `_rawLinks` carry (ENH-216), so a
  // body `[[Q3 Launch]]` (folded → `q3-launch`) resolves to the note whose
  // basename is `Q3 Launch`. Before this, byName was keyed by the raw
  // case-preserved basename and every multi-word link silently missed.
  const byName = new Map(files.map((f) => [targetKey(f.name, 'wikilink'), f]))
  for (const f of files) {
    f.links = f._rawLinks.map((n) => byName.get(n)).filter(Boolean) as EngineFile[]
    for (const target of f.links) target.backlinks.push(f)
  }
  return files
}

// ── expression → JS source transforms (locked subset) ──────────────────────

function wrapImplicitLambdas(src: string): string {
  for (const fn of ['filter', 'map']) {
    let i: number
    while ((i = src.indexOf('.' + fn + '(')) !== -1) {
      const open = i + fn.length + 2
      let depth = 1
      let j = open
      while (j < src.length && depth > 0) {
        if (src[j] === '(') depth++
        else if (src[j] === ')') depth--
        j++
      }
      const inner = src.slice(open, j - 1)
      src = src.slice(0, open) + '(value)=>(' + inner + ')' + src.slice(j - 1)
      src = src.slice(0, i) + '.GB_' + fn + src.slice(i + 1 + fn.length)
    }
    src = src.replaceAll('.GB_' + fn, '.' + fn)
  }
  return src
}

function splitTopLevel(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  let quote: string | null = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      cur += c
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      cur += c
      continue
    }
    if (c === '(') depth++
    if (c === ')') depth--
    if (c === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  parts.push(cur)
  return parts
}

function transformIfs(src: string): string {
  const re = /(?<![\w.])if\s*\(/
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length
    let depth = 1
    let j = open
    while (j < src.length && depth > 0) {
      if (src[j] === '(') depth++
      else if (src[j] === ')') depth--
      j++
    }
    const args = splitTopLevel(src.slice(open, j - 1))
    const cond = args[0]
    const a = args[1] ?? 'null'
    const b = args[2] ?? 'null'
    src = src.slice(0, m.index) + '((' + cond + ') ? (' + a + ') : (' + b + '))' + src.slice(j)
  }
  return src
}

function transform(expr: unknown): string {
  let src = String(expr)
  src = wrapImplicitLambdas(src)
  src = transformIfs(src)
  src = src.replace(/([\w.[\]"]+)\s*==\s*this\b/g, 'gbEq($1, GB_THIS)')
  src = src.replace(/([\w.[\]"]+)\s*!=\s*this\b/g, '!gbEq($1, GB_THIS)')
  src = src.replace(/([-+])\s*"(\d+\s*[A-Za-z]+)"/g, (mm, op, dur) => {
    try {
      GB_DUR(dur)
      return op + ' GB_DUR("' + dur + '")'
    } catch {
      return mm
    }
  })
  return src
}

export const ICONS: Record<string, string> = {
  check: '<span style="color:#4a7d3e">✔</span>',
  'octagon-x': '<span style="color:#b13e3a">⛔</span>',
  'circle-dot': '<span style="color:#4a7d3e">◉</span>',
  'alarm-clock': '<span style="color:#b07527">⏰</span>',
  activity: '<span style="color:#3C6E93">∿</span>',
}

/** Bases gives numbers a `.round(digits)` method. Rather than mutate the
 *  global Number prototype at import time (which would leak into a Phase-3
 *  renderer share), we define it lazily + idempotently, non-enumerably, on
 *  first evaluation only. */
let globalsReady = false
function ensureEngineGlobals(): void {
  if (globalsReady) return
  globalsReady = true
  if (!('round' in Number.prototype)) {
    Object.defineProperty(Number.prototype, 'round', {
      value: function (this: number, digits = 0) {
        const f = 10 ** digits
        return Math.round(this * f) / f
      },
      enumerable: false,
      writable: true,
      configurable: true,
    })
  }
}

export interface EvalError {
  __error: string
  __expr: unknown
}
export function isEvalError(v: unknown): v is EvalError {
  return !!v && typeof v === 'object' && '__error' in (v as object)
}
export interface HtmlValue {
  __html: string
}

function makeCtx(
  file: EngineFile,
  thisFile: EngineFile | null,
  formulas: Record<string, unknown>,
  asOf: Date,
): Record<string, unknown> {
  const formulaCache: Record<string, unknown> = {}
  const formulaProxy = new Proxy(
    {},
    {
      has: () => true,
      get: (_t, k) => {
        if (typeof k !== 'string') return undefined
        if (!(k in formulaCache)) {
          formulaCache[k] = '__evaluating__'
          formulaCache[k] = formulas[k] ? evalExpr(formulas[k], file, thisFile, formulas, asOf) : null
        }
        return formulaCache[k]
      },
    },
  )
  const scope: Record<string, unknown> = {
    file,
    note: file.properties,
    formula: formulaProxy,
    GB_THIS: thisFile,
    gbEq,
    GB_DUR,
    today: () => new DuoDate(midnight(asOf), asOf),
    now: () => new DuoDate(new Date(asOf), asOf),
    date: (s: string) => new DuoDate(new Date(s), asOf),
    duration: GB_DUR,
    icon: (n: string) => ({ __html: ICONS[n] || '<span title="' + n + '">◇</span>' }),
    html: (s: unknown) => ({ __html: String(s) }),
    list: (x: unknown) => (Array.isArray(x) ? x : [x]),
    min: Math.min,
    max: Math.max,
    number: Number,
    link: (p: string, d?: string) => new Link(p, d),
  }
  return new Proxy(scope, {
    has: () => true,
    get: (t, k) => {
      if (typeof k !== 'string') return undefined
      if (k in t) return t[k]
      if (k in file.properties) return file.properties[k]
      return null
    },
  })
}

function midnight(d: Date): Date {
  const t = new Date(d)
  t.setHours(0, 0, 0, 0)
  return t
}

export function evalExpr(
  expr: unknown,
  file: EngineFile,
  thisFile: EngineFile | null,
  formulas: Record<string, unknown>,
  asOf: Date,
): unknown {
  ensureEngineGlobals()
  const src = transform(expr)
  try {
    // Function-constructor bodies are non-strict, so `with` is available.
    // eslint-disable-next-line no-new-func
    const fn = new Function('ctx', 'with (ctx) { return (' + src + '); }')
    return fn(makeCtx(file, thisFile, formulas, asOf))
  } catch (e) {
    return { __error: e instanceof Error ? e.message : String(e), __expr: expr }
  }
}

/** Evaluate a filter node (string expr, or `and`/`or`/`not` group). */
export function passes(
  filterNode: unknown,
  file: EngineFile,
  thisFile: EngineFile | null,
  formulas: Record<string, unknown>,
  asOf: Date,
): boolean {
  if (filterNode == null) return true
  if (typeof filterNode === 'string') {
    const r = evalExpr(filterNode, file, thisFile, formulas, asOf)
    return Boolean(r) && !isEvalError(r)
  }
  const node = filterNode as Record<string, unknown>
  if (node.and) return (node.and as unknown[]).every((n) => passes(n, file, thisFile, formulas, asOf))
  if (node.or) return (node.or as unknown[]).some((n) => passes(n, file, thisFile, formulas, asOf))
  if (node.not) return !(node.not as unknown[]).every((n) => passes(n, file, thisFile, formulas, asOf))
  return true
}

/** Default as-of date (local midnight today) for relative formulas. */
export function defaultAsOf(): Date {
  return new Date()
}
