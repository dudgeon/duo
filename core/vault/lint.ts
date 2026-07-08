// ENH-208 Vault — the `.base` linter (PR2, L1). Ported from the prototype's
// `lint.mjs`. Derives the corpus from frontmatter (L0) and statically checks
// a base's filter/formula expressions against it: bad types, unresolved
// `[[entities]]`, off-enum values, unknown functions, unknown view types —
// each with a Levenshtein "did you mean". Per D15 the findings are advisory:
// lint NEVER blocks a render (warn-and-render).

import fs from 'node:fs'
import path from 'node:path'
import { load as yamlLoad } from 'js-yaml'
import type { Corpus } from './types'
import { buildCorpus } from './corpus'
import { walk, readNotes } from './parse'

export interface LintFinding {
  severity: 'error' | 'warn'
  message: string
  /** Best-match correction, when one was found. */
  suggestion?: string
}
export interface LintResult {
  /** The base file (rel path) or the note (rel path) the def came from. */
  source: string
  /** For an embedded block: the host note's basename (`this` context). */
  embeddedIn?: string
  findings: LintFinding[]
  /** True when YAML failed to parse (the def couldn't be linted). */
  parseError?: string
}

// ── string distance ─────────────────────────────────────────────────────────
function lev(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[m][n]
}
function suggest(word: string, candidates: string[]): string | null {
  let best: string | null = null
  let bestD = Infinity
  for (const c of candidates) {
    const dd = lev(word.toLowerCase(), c.toLowerCase())
    if (dd < bestD) {
      bestD = dd
      best = c
    }
  }
  return best && bestD <= Math.max(2, Math.ceil(word.length / 3)) ? best : null
}

// ── lint vocabulary (Obsidian Bases 1.13.0) ─────────────────────────────────
// MUST track the engine's makeCtx scope (engine.ts) — same vocabulary table
// per the PRD. Unknown names are WARNINGS (D15), never hard errors.
const FUNCS = new Set([
  'file.hasTag', 'file.hasLink', 'file.inFolder', 'file.hasProperty', 'file.asLink',
  'today', 'now', 'date', 'duration', 'if', 'icon', 'html', 'list', 'min', 'max',
  'number', 'link', 'random', 'escapeHTML',
  // ENH-259 — transitive ancestor walk up a property's link chain.
  'ancestors',
])
const METHODS = new Set([
  'relative', 'format', 'date', 'time', 'isEmpty', 'round', 'toFixed', 'abs', 'ceil', 'floor',
  'contains', 'containsAll', 'containsAny', 'startsWith', 'endsWith', 'lower', 'title', 'trim',
  'replace', 'split', 'join', 'reverse', 'slice', 'sort', 'unique', 'filter', 'map', 'reduce',
  'flat', 'length', 'asFile', 'linksTo', 'keys', 'values', 'toString', 'matches', 'mean',
])
const VIEW_TYPES = ['table', 'cards', 'list', 'map']

interface BaseDefLike {
  filters?: unknown
  formulas?: Record<string, unknown>
  views?: { name?: string; type?: string; filters?: unknown; groupBy?: unknown; groups?: unknown }[]
}

function collectExprs(node: unknown, out: string[]): void {
  if (node == null) return
  if (typeof node === 'string') {
    out.push(node)
    return
  }
  if (Array.isArray(node)) {
    node.forEach((n) => collectExprs(n, out))
    return
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>
    for (const v of ['and', 'or', 'not']) if (obj[v]) collectExprs(obj[v], out)
  }
}

/** Lint one base definition against the corpus. */
export function lintBaseDef(def: BaseDefLike, corpus: Corpus): LintFinding[] {
  const findings: LintFinding[] = []
  const add = (severity: 'error' | 'warn', message: string, suggestion?: string) =>
    findings.push(suggestion ? { severity, message, suggestion } : { severity, message })

  const exprs: string[] = []
  collectExprs(def.filters, exprs)
  for (const v of def.views || []) collectExprs(v.filters, exprs)
  for (const f of Object.values(def.formulas || {})) exprs.push(String(f))

  const knownEntities = new Set([...corpus.entities.map((e) => e.name), ...Object.keys(corpus.aliases)])

  for (const e of exprs) {
    // type == "X"
    for (const m of e.matchAll(/\btype\s*[=!]=\s*"([^"]+)"/g)) {
      if (!corpus.types.includes(m[1])) {
        const s = suggest(m[1], corpus.types)
        add('error', `type == "${m[1]}" — no such type${s ? ` (did you mean "${s}"?)` : ''}. Known: ${corpus.types.join(', ')}`, s ?? undefined)
      }
    }
    // [[Entity]]
    for (const m of e.matchAll(/\[\[([^\]|#]+)/g)) {
      const name = m[1].trim()
      if (!knownEntities.has(name)) {
        const s = suggest(name, [...knownEntities])
        add('error', `[[${name}]] — unresolved entity${s ? ` (did you mean "${s}"?)` : ''}`, s ?? undefined)
      }
    }
    // PROP == "value" — enum check when PROP is a known typed property
    for (const m of e.matchAll(/\b(?:note\.)?(\w+)\s*==\s*"([^"]+)"/g)) {
      const [, prop, val] = m
      if (prop === 'type') continue
      for (const [key, vals] of Object.entries(corpus.enumsByType)) {
        if (key.endsWith('.' + prop) && !vals.includes(val)) {
          const s = suggest(val, vals)
          if (s)
            add('warn', `${prop} == "${val}" — no ${key.split('.')[0]} has this value (observed: ${vals.join(', ')}; did you mean "${s}"?)`, s)
        }
      }
    }
    // function calls
    for (const m of e.matchAll(/\b([a-z]\w*(?:\.\w+)?)\s*\(/gi)) {
      const fn = m[1]
      if (FUNCS.has(fn)) continue
      const tail = fn.includes('.') ? fn.split('.').pop()! : fn
      if (METHODS.has(tail)) continue
      if (fn.includes('.')) continue // x.method() on a value — can't resolve statically
      const s = suggest(fn, [...FUNCS])
      add('warn', `${fn}(…) — unknown function${s ? ` (did you mean "${s}"?)` : ''}`, s ?? undefined)
    }
  }

  // structural: view types
  for (const v of def.views || []) {
    if (v.type && !VIEW_TYPES.includes(v.type)) add('error', `view "${v.name || v.type}" — unknown view type "${v.type}"`)
    // ENH-255 — declared buckets: only meaningful under a groupBy, and every
    // entry needs a value (a bare string or {value, label}).
    // NOTE (review, finding n): the `groups:` shape is also validated in
    // render.ts normalizeDeclaredGroups (lenient) and builder.ts
    // parseBuilderBase (strict) — three modes, deliberately not unified;
    // change all three together.
    if (v.groups != null) {
      const vn = v.name || v.type || 'view'
      if (!v.groupBy) add('warn', `view "${vn}" — groups: declared without groupBy (buckets have nothing to group)`)
      if (!Array.isArray(v.groups)) {
        add('error', `view "${vn}" — groups: must be a list of values or {value, label} entries`)
      } else {
        for (const g of v.groups) {
          const ok = typeof g === 'string' || (g && typeof g === 'object' && typeof (g as { value?: unknown }).value === 'string')
          if (!ok) add('error', `view "${vn}" — groups: entry needs a string value (got ${JSON.stringify(g)})`)
        }
      }
    }
  }
  return findings
}

/** Lint a target: `--all` (every `.base` file + every embedded ```base block
 *  in every note), a `.base` file path, or a note path/name (its embedded
 *  blocks). `corpus` is computed once and shared. */
export function lintVault(root: string, target: '--all' | string): LintResult[] {
  const corpus = buildCorpus(root)
  const results: LintResult[] = []

  const lintBaseFile = (abs: string) => {
    const rel = path.relative(root, abs).split(path.sep).join('/')
    let def: BaseDefLike
    try {
      def = yamlLoad(fs.readFileSync(abs, 'utf8')) as BaseDefLike
    } catch (e) {
      results.push({ source: rel, findings: [], parseError: e instanceof Error ? e.message : String(e) })
      return
    }
    results.push({ source: rel, findings: lintBaseDef(def || {}, corpus) })
  }

  const lintNoteEmbeds = (relPath: string, basename: string, body: string) => {
    let i = 0
    for (const m of body.matchAll(/```base\n([\s\S]*?)```/g)) {
      i++
      let def: BaseDefLike
      try {
        def = yamlLoad(m[1]) as BaseDefLike
      } catch (e) {
        results.push({ source: relPath, embeddedIn: basename, findings: [], parseError: e instanceof Error ? e.message : String(e) })
        continue
      }
      results.push({ source: `${relPath}${i > 1 ? ` [block ${i}]` : ''}`, embeddedIn: basename, findings: lintBaseDef(def || {}, corpus) })
    }
  }

  if (target === '--all') {
    for (const abs of walk(root).filter((p) => p.endsWith('.base')).sort()) lintBaseFile(abs)
    for (const note of readNotes(root)) lintNoteEmbeds(note.relPath, note.basename, note.body)
  } else {
    const abs = path.isAbsolute(target) ? target : path.resolve(root, target)
    if (target.endsWith('.base')) {
      lintBaseFile(abs)
    } else {
      const notes = readNotes(root)
      const note = fs.existsSync(abs) && abs.endsWith('.md')
        ? notes.find((n) => n.absPath === abs)
        : notes.find((n) => n.basename === target.replace(/\.md$/, ''))
      if (!note) throw new Error(`lint target not found: ${target} (expected --all, a .base file, or a note path/name)`)
      lintNoteEmbeds(note.relPath, note.basename, note.body)
    }
  }
  return results
}
