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
import { targetKey, slugStem } from '../markdown/vaultLinks'

/** BUG-260 — the identity keys a PROBE value may fold to. `targetKey`
 *  preserves punctuation (`Track: Context…` → `track:-context-…`), but the
 *  slugger that NAMES files strips it (`track-context-…`), so a display-name
 *  probe against a slug-named note missed. Probe with both folds; a Link
 *  probe already carries a real target, so it keys once. */
function probeKeys(v: unknown): string[] {
  if (v instanceof Link) return [targetKey(v.target, 'wikilink')]
  const s = String(v)
  const keys = [targetKey(s, 'wikilink')]
  const slug = slugStem(s)
  if (!keys.includes(slug)) keys.push(slug)
  return keys
}

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
    // ENH-229 — OKF stores entity refs as standard-markdown rel links
    // `[Display](./people/alice-park.md)` (D7), not wikilinks. Fold a LOCAL
    // .md rel link into a Link so it resolves + renders like a wikilink
    // (link target = the filename stem; targetKey folds it move-proof).
    // External/non-.md links stay plain strings (no regression).
    const md = v.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (md) {
      const href = md[2].trim()
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(href) && /\.md$/i.test(href)) {
        const stem = href.split('/').pop()!.replace(/\.md$/i, '')
        let target = stem
        try {
          target = decodeURIComponent(stem)
        } catch {
          /* keep raw stem if it isn't valid percent-encoding */
        }
        return new Link(target, md[1].trim())
      }
    }
    return v
  }
  if (Array.isArray(v)) return v.map((x) => parseLinkish(x, asOf))
  if (v instanceof Date) {
    return new DuoDate(new Date(v.getTime() + v.getTimezoneOffset() * 60000), asOf)
  }
  return v
}

/** `== this` / link-group equality. ENH-255 review fix: link-ish operands
 *  fold through targetKey (same identity fold as {@link memberEq}), so
 *  `parent == this` matches `[[Q3 Launch]]` / `[[q3-launch|Growth]]` alias +
 *  case variants exactly like `contains()` does. Plain scalars stay strict. */
function gbEq(a: unknown, b: unknown): boolean {
  const linkish = (x: unknown) =>
    x instanceof Link || (!!x && typeof x === 'object' && typeof (x as { name?: unknown }).name === 'string')
  const name = (x: any) => (x instanceof Link ? x.target : x && x.name ? x.name : x)
  if (linkish(a) || linkish(b)) {
    // BUG-260 — both operands probe with BOTH folds (targetKey + slugStem),
    // so a display name with punctuation matches its slug-named note.
    const ka = probeKeys(a instanceof Link ? a : String(name(a)))
    const kb = probeKeys(b instanceof Link ? b : String(name(b)))
    return ka.some((k) => kb.includes(k))
  }
  return name(a) === name(b)
}

/** Identity-folded element equality for membership predicates (ENH-255).
 *  When either side is a Link, both fold through targetKey so the match keys
 *  off the linked note's IDENTITY (`Q3 Launch` ≡ `q3-launch`), never its
 *  display alias. Plain scalars compare loosely by string so `"3" == 3`
 *  frontmatter drift doesn't break membership. */
export function memberEq(el: unknown, probe: unknown): boolean {
  if (el instanceof Link || probe instanceof Link) {
    // BUG-260 — probe with BOTH folds (targetKey + slugStem): a display-name
    // probe with punctuation (`Track: Context…`) must match its slug-named
    // note (`track-context-…`), which targetKey alone missed.
    const ke = probeKeys(el)
    const kp = probeKeys(probe)
    return ke.some((k) => kp.includes(k))
  }
  return el === probe || String(el) === String(probe)
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
        const raw = other instanceof Link ? other : String((other as any)?.name ?? other)
        // _rawLinks are folded keys (ENH-216); probe with BOTH folds
        // (targetKey + slugStem — BUG-260) so a punctuated display name
        // matches its slug-named note.
        return probeKeys(raw).some((k) => this._rawLinks.includes(k))
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
  // ENH-255 — Bases membership predicates. The lint vocabulary always listed
  // contains/containsAll/containsAny, but the engine never implemented them,
  // so a multi-valued filter linted clean yet errored at eval (and `passes`
  // used to swallow that as an empty view). List membership folds Link
  // identity via memberEq; string contains is a plain substring probe.
  // ENH-255 review fix — Duo's prototype additions are tagged with a marker
  // symbol so a PRE-EXISTING foreign definition (some other library's
  // Array.prototype.contains…) is detected, not silently deferred to: we
  // never overwrite it (that could break the foreign code), but we warn once
  // naming the collision so a subtly-different `contains` semantics doesn't
  // read as a Duo engine bug.
  const DUO_ENGINE_FN = Symbol.for('duo.vault.engineFn')
  const def = (proto: object, name: string, value: unknown) => {
    if (name in proto) {
      const existing = (proto as Record<string, unknown>)[name]
      const isDuo =
        typeof existing === 'function' && (existing as unknown as Record<symbol, unknown>)[DUO_ENGINE_FN] === true
      if (!isDuo) {
        console.warn(
          `duo vault engine: ${proto === Array.prototype ? 'Array' : proto === String.prototype ? 'String' : 'Object'}` +
            `.prototype.${name} is already defined by other code — keeping the foreign definition; ` +
            'Bases membership semantics (Link identity fold) may differ for this method.',
        )
      }
      return
    }
    if (typeof value === 'function') {
      Object.defineProperty(value, DUO_ENGINE_FN, { value: true, enumerable: false })
    }
    Object.defineProperty(proto, name, { value, enumerable: false, writable: true, configurable: true })
  }
  const probesOf = (args: unknown[]): unknown[] => (args.length === 1 && Array.isArray(args[0]) ? args[0] : args)
  def(Array.prototype, 'contains', function (this: unknown[], probe: unknown) {
    return this.some((el) => memberEq(el, probe))
  })
  def(Array.prototype, 'containsAny', function (this: unknown[], ...args: unknown[]) {
    return probesOf(args).some((p) => this.some((el) => memberEq(el, p)))
  })
  def(Array.prototype, 'containsAll', function (this: unknown[], ...args: unknown[]) {
    return probesOf(args).every((p) => this.some((el) => memberEq(el, p)))
  })
  def(String.prototype, 'contains', function (this: string, probe: unknown) {
    return this.includes(String(probe))
  })
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

/** ENH-259 — the transitive ancestors of `file` up ONE property's link chain.
 *  Follows `properties[propName]` (a Link or array of Links), resolves each to
 *  its EngineFile via `file.links` (which includes frontmatter links, so
 *  `parent: [[X]]` is in the graph), and recurses on that parent's OWN
 *  `propName` — so `neighborhood.parent → city → state → country` all surface,
 *  irrespective of the intermediate levels' types. Returns the ancestor Links
 *  (identity-folded via `.contains()`); cycle-guarded by folded key; a
 *  multi-valued parent contributes the union of its chains. The starting file
 *  itself is never in the result. */
export function collectAncestors(file: EngineFile, propName: string): Link[] {
  const out: Link[] = []
  const seen = new Set<string>()
  const walk = (f: EngineFile) => {
    const raw = f.properties[propName]
    for (const val of Array.isArray(raw) ? raw : [raw]) {
      if (!(val instanceof Link)) continue
      const key = targetKey(val.target, 'wikilink')
      if (seen.has(key)) continue
      seen.add(key)
      out.push(val)
      const parent = f.links.find((l) => targetKey(l.name, 'wikilink') === key)
      if (parent) walk(parent)
    }
  }
  walk(file)
  return out
}

/** ENH-261 — the NEAREST ancestor of `file` up `propName`'s link chain whose
 *  frontmatter `type` equals `typeName`. BFS so "nearest" holds even with
 *  multi-valued parents; cycle-guarded by folded identity. Returns the
 *  ancestor's Link (the display text the child wrote) or null. This is the
 *  resolver behind the `ancestor:<prop>:<type>` group/column token — "group
 *  initiatives by GOAL" walks parent→parent→… until a goal-typed note. An
 *  unresolvable link (no note in the corpus) can't be type-checked, so it is
 *  skipped rather than matched. */
export function nearestAncestorOfType(file: EngineFile, propName: string, typeName: string): Link | null {
  const seen = new Set<string>()
  let frontier: EngineFile[] = [file]
  while (frontier.length) {
    const next: EngineFile[] = []
    for (const f of frontier) {
      const raw = f.properties[propName]
      for (const val of Array.isArray(raw) ? raw : [raw]) {
        if (!(val instanceof Link)) continue
        const key = targetKey(val.target, 'wikilink')
        if (seen.has(key)) continue
        seen.add(key)
        const target = f.links.find((l) => targetKey(l.name, 'wikilink') === key)
        if (!target) continue
        if (target.properties.type === typeName) return val
        next.push(target)
      }
    }
    frontier = next
  }
  return null
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
    // ENH-259 — transitive ancestors up a property's chain (any_parent):
    // `ancestors("parent").contains("California")` matches a state anywhere
    // above a neighborhood. Identity-folded by the same contains() as ENH-258.
    ancestors: (propName: unknown) => collectAncestors(file, String(propName)),
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

/** Tri-state filter result: a definite boolean, or 'error' — the branch
 *  couldn't be evaluated AND that indeterminacy reaches the result. */
type TriState = boolean | 'error'
interface TriResult {
  v: TriState
  /** The erroring leaf expressions that made `v` 'error' (empty otherwise). */
  errs: { expr: string; error: string }[]
}

/** Error-aware filter evaluation (ENH-255 review fix). An error only
 *  propagates when it actually decides the node's value:
 *  - `and`: any definite-false branch wins (false, no error reported — the
 *    row was genuinely excluded); else any erroring branch → 'error'.
 *  - `or`: any definite-true branch wins (true, no error reported — the row
 *    rendered fine); else any erroring branch → 'error'.
 *  - `not`: an erroring child is indeterminate, so the negation is too —
 *    'error' (NOT error→false→negated→included, which would include every
 *    row a broken not: filter touched). Else `!every(child)` as before. */
function passesTri(
  filterNode: unknown,
  file: EngineFile,
  thisFile: EngineFile | null,
  formulas: Record<string, unknown>,
  asOf: Date,
): TriResult {
  if (filterNode == null) return { v: true, errs: [] }
  if (typeof filterNode === 'string') {
    const r = evalExpr(filterNode, file, thisFile, formulas, asOf)
    if (isEvalError(r)) return { v: 'error', errs: [{ expr: filterNode, error: r.__error }] }
    return { v: Boolean(r), errs: [] }
  }
  const node = filterNode as Record<string, unknown>
  const kids = (list: unknown[]): TriResult[] => list.map((n) => passesTri(n, file, thisFile, formulas, asOf))
  const errsOf = (rs: TriResult[]) => rs.filter((r) => r.v === 'error').flatMap((r) => r.errs)
  if (node.and) {
    const rs = kids(node.and as unknown[])
    if (rs.some((r) => r.v === false)) return { v: false, errs: [] }
    if (rs.some((r) => r.v === 'error')) return { v: 'error', errs: errsOf(rs) }
    return { v: true, errs: [] }
  }
  if (node.or) {
    const rs = kids(node.or as unknown[])
    if (rs.some((r) => r.v === true)) return { v: true, errs: [] }
    if (rs.some((r) => r.v === 'error')) return { v: 'error', errs: errsOf(rs) }
    return { v: false, errs: [] }
  }
  if (node.not) {
    const rs = kids(node.not as unknown[])
    if (rs.some((r) => r.v === 'error')) return { v: 'error', errs: errsOf(rs) }
    return { v: !rs.every((r) => r.v === true), errs: [] }
  }
  // BUG-260 — an UNQUOTED filter expression whose value contains ": " is
  // parsed by YAML as a single-pair MAPPING, not a string (e.g.
  // `- tracks == "Track: Context"` → { 'tracks == "Track': 'Context"' }).
  // Before this fix that node fell through to `true` — the filter was
  // SILENTLY DROPPED. Reconstruct the original expression when the shape is
  // unambiguous; anything else non-empty is a surfaced error, never a pass.
  const keys = Object.keys(node)
  if (keys.length === 1 && typeof node[keys[0]] === 'string') {
    return passesTri(`${keys[0]}: ${node[keys[0]]}`, file, thisFile, formulas, asOf)
  }
  if (keys.length > 0) {
    return {
      v: 'error',
      errs: [{
        expr: JSON.stringify(filterNode),
        error: 'filter clause is not a string — an unquoted expression containing ": " parses as a YAML mapping; quote the line',
      }],
    }
  }
  return { v: true, errs: [] }
}

/** Evaluate a filter node (string expr, or `and`/`or`/`not` group). A filter
 *  expression that ERRORS still fails the row (warn-and-render, D15) — an
 *  indeterminate branch never INCLUDES a row (even under `not:`). It reports
 *  through `onError` (ENH-255), but ONLY when the error actually decided the
 *  row's exclusion: an erroring `or:` branch beside a passing one, or beside
 *  a definite-false `and:` sibling, is silent — the row's fate was the same
 *  with or without the error, so warning would claim rows "failed" that
 *  rendered fine (or were genuinely filtered). */
export function passes(
  filterNode: unknown,
  file: EngineFile,
  thisFile: EngineFile | null,
  formulas: Record<string, unknown>,
  asOf: Date,
  onError?: (expr: string, error: string) => void,
): boolean {
  const r = passesTri(filterNode, file, thisFile, formulas, asOf)
  if (r.v === 'error') {
    for (const e of r.errs) onError?.(e.expr, e.error)
    return false
  }
  return r.v
}

/** Default as-of date (local midnight today) for relative formulas. */
export function defaultAsOf(): Date {
  return new Date()
}
