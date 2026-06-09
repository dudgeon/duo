// ENH-208 Vault — base rendering (PR2). Two layers:
//   1. evaluateBaseDef() — pure structured evaluation (filtered rows per
//      view + a readCol() to pull any column's value). Tests assert row
//      counts and formula outputs against this without parsing HTML.
//   2. the HTML emitter — Duo-owned presentation (D16: table/cards/list is
//      never user-authored; cell styling only via html()/icon() formulas).
//
// Ported from the prototype's `render.mjs`. The HTML page is a stamped
// build artifact (D13): generated-at + source hash + as-of date, so
// staleness is detectable.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { load as yamlLoad } from 'js-yaml'
import type { VaultFile } from './types'
import { readNotes, parseFile } from './parse'
import {
  buildEngineFiles,
  evalExpr,
  passes,
  DuoDate,
  Link,
  isEvalError,
  defaultAsOf,
  type EngineFile,
} from './engine'

// ── structured evaluation ──────────────────────────────────────────────────

export interface BaseView {
  name: string
  type: string
  order: string[]
  groupBy?: { property: string; direction?: string }
  summaries?: Record<string, string>
  filters?: unknown
}
export interface BaseDef {
  filters?: unknown
  formulas?: Record<string, unknown>
  properties?: Record<string, { displayName?: string }>
  views?: BaseView[]
}

export interface EvaluatedView {
  name: string
  type: string
  order: string[]
  groupBy?: { property: string; direction?: string }
  summaries?: Record<string, string>
  rows: EngineFile[]
}
export interface EvaluatedBase {
  formulas: Record<string, unknown>
  propCfg: Record<string, { displayName?: string }>
  views: EvaluatedView[]
}

/** Read one column's value for a row (`file.*`, `formula.*`, `note.*`, or a
 *  bare frontmatter key). Shared by the HTML emitter and tests. */
export function readCol(
  prop: string,
  file: EngineFile,
  thisFile: EngineFile | null,
  formulas: Record<string, unknown>,
  asOf: Date,
): unknown {
  if (prop.startsWith('formula.')) {
    return evalExpr(formulas[prop.slice(8)] ?? 'null', file, thisFile, formulas, asOf)
  }
  if (prop.startsWith('file.')) return (file as unknown as Record<string, unknown>)[prop.slice(5)]
  const key = prop.startsWith('note.') ? prop.slice(5) : prop
  return file.properties[key] ?? null
}

/** Evaluate a base definition against a file set — filter each view's rows
 *  (base-level filters ∧ view-level filters). `thisFile` is the host note
 *  for embedded `… == this` blocks, else null for vault-wide `.base` files. */
export function evaluateBaseDef(
  def: BaseDef,
  files: EngineFile[],
  thisFile: EngineFile | null,
  asOf: Date,
): EvaluatedBase {
  const formulas = def.formulas || {}
  const propCfg = def.properties || {}
  const views: EvaluatedView[] = []
  for (const view of def.views || []) {
    const rows = files.filter(
      (f) => passes(def.filters, f, thisFile, formulas, asOf) && passes(view.filters, f, thisFile, formulas, asOf),
    )
    views.push({
      name: view.name || view.type,
      type: view.type,
      order: view.order || ['file.name'],
      groupBy: view.groupBy,
      summaries: view.summaries,
      rows,
    })
  }
  return { formulas, propCfg, views }
}

// ── HTML emitter (Duo-owned) ────────────────────────────────────────────────

const esc = (s: unknown): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function cell(v: unknown): string {
  if (v == null || v === '') return '<span class="empty">—</span>'
  if (isEvalError(v)) return '<span class="err" title="' + esc(v.__expr) + '">⚠ ' + esc(v.__error) + '</span>'
  if (typeof v === 'object' && v !== null && '__html' in v) return (v as { __html: string }).__html
  if (v instanceof Link) return '<span class="wikilink">' + esc(v.display) + '</span>'
  if (v instanceof DuoDate) return esc(v.toString())
  if (Array.isArray(v)) return v.map(cell).join(', ')
  if (typeof v === 'number') return String(v)
  return esc(String(v))
}

function colLabel(prop: string, propCfg?: Record<string, { displayName?: string }>): string {
  if (propCfg && propCfg[prop] && propCfg[prop].displayName) return propCfg[prop].displayName!
  return prop.replace(/^(note|file|formula)\./, '')
}

const SUMMARY_FNS: Record<string, (vals: unknown[]) => unknown> = {
  Earliest: (vals) => {
    const ds = vals.filter((v): v is DuoDate => v instanceof DuoDate)
    return ds.length ? ds.reduce((a, b) => (a.valueOf() < b.valueOf() ? a : b)) : null
  },
  Latest: (vals) => {
    const ds = vals.filter((v): v is DuoDate => v instanceof DuoDate)
    return ds.length ? ds.reduce((a, b) => (a.valueOf() > b.valueOf() ? a : b)) : null
  },
  Filled: (vals) => vals.filter((v) => v != null && v !== '').length,
  Empty: (vals) => vals.filter((v) => v == null || v === '').length,
  Sum: (vals) => vals.filter((v): v is number => typeof v === 'number').reduce((a, b) => a + b, 0),
  Average: (vals) => {
    const ns = vals.filter((v): v is number => typeof v === 'number')
    return ns.length ? Math.round((ns.reduce((a, b) => a + b, 0) / ns.length) * 100) / 100 : null
  },
  Unique: (vals) => new Set(vals.map((v) => String(v))).size,
}

function summaryInline(
  rows: EngineFile[],
  view: EvaluatedView,
  formulas: Record<string, unknown>,
  thisFile: EngineFile | null,
  asOf: Date,
): string {
  if (!view.summaries) return ''
  const parts: string[] = []
  for (const [prop, fnName] of Object.entries(view.summaries)) {
    const fn = SUMMARY_FNS[fnName]
    if (!fn) {
      parts.push(esc(fnName) + ': ?')
      continue
    }
    const vals = rows.map((f) => readCol(prop, f, thisFile, formulas, asOf))
    parts.push(esc(colLabel(prop)) + ' ' + esc(fnName).toLowerCase() + ': ' + cell(fn(vals)))
  }
  return ' <span class="summary">' + parts.join(' · ') + '</span>'
}

function renderTable(
  view: EvaluatedView,
  formulas: Record<string, unknown>,
  thisFile: EngineFile | null,
  propCfg: Record<string, { displayName?: string }>,
  asOf: Date,
): string {
  const order = view.order
  const head = '<tr>' + order.map((p) => '<th>' + esc(colLabel(p, propCfg)) + '</th>').join('') + '</tr>'
  const groups = new Map<string | null, EngineFile[]>()
  if (view.groupBy) {
    for (const f of view.rows) {
      const v = readCol(view.groupBy.property, f, thisFile, formulas, asOf)
      const key = v == null ? '—' : String(v instanceof Link ? v.display : v)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(f)
    }
  } else {
    groups.set(null, view.rows)
  }
  const keys = [...groups.keys()].sort((a, b) => String(a).localeCompare(String(b)))
  if (view.groupBy && String(view.groupBy.direction).toUpperCase() === 'DESC') keys.reverse()

  let html = '<table>' + head
  for (const key of keys) {
    const gRows = groups.get(key)!
    if (key !== null) {
      html +=
        '<tr class="group"><td colspan="' +
        order.length +
        '">' +
        esc(key) +
        ' <span class="count">(' +
        gRows.length +
        ')</span>' +
        summaryInline(gRows, view, formulas, thisFile, asOf) +
        '</td></tr>'
    }
    for (const f of gRows) {
      html += '<tr>' + order.map((p) => '<td>' + cell(readCol(p, f, thisFile, formulas, asOf)) + '</td>').join('') + '</tr>'
    }
  }
  if (!view.groupBy && view.summaries) {
    html +=
      '<tr class="group"><td colspan="' +
      order.length +
      '">' +
      summaryInline(view.rows, view, formulas, thisFile, asOf) +
      '</td></tr>'
  }
  return html + '</table>'
}

function renderList(
  view: EvaluatedView,
  formulas: Record<string, unknown>,
  thisFile: EngineFile | null,
  asOf: Date,
): string {
  return (
    '<ul class="baselist">' +
    view.rows.map((f) => '<li>' + view.order.map((p) => cell(readCol(p, f, thisFile, formulas, asOf))).join(' ') + '</li>').join('') +
    '</ul>'
  )
}

function renderCards(
  view: EvaluatedView,
  formulas: Record<string, unknown>,
  thisFile: EngineFile | null,
  asOf: Date,
): string {
  return (
    '<div class="cards">' +
    view.rows
      .map((f) => {
        const [title, ...rest] = view.order
        return (
          '<div class="card"><div class="card-title">' +
          cell(readCol(title, f, thisFile, formulas, asOf)) +
          '</div>' +
          rest
            .map(
              (p) =>
                '<div class="card-row"><span class="card-k">' +
                esc(colLabel(p)) +
                '</span> ' +
                cell(readCol(p, f, thisFile, formulas, asOf)) +
                '</div>',
            )
            .join('') +
          '</div>'
        )
      })
      .join('') +
    '</div>'
  )
}

/** Render one evaluated base to an HTML section. */
export function renderBaseSection(
  evaluated: EvaluatedBase,
  thisFile: EngineFile | null,
  label: string,
  asOf: Date,
): string {
  let html = '<section class="base"><h2>' + esc(label) + '</h2>'
  for (const view of evaluated.views) {
    html += '<h3>' + esc(view.name) + ' <span class="count">' + view.rows.length + ' rows</span></h3>'
    if (view.type === 'list') html += renderList(view, evaluated.formulas, thisFile, asOf)
    else if (view.type === 'cards') html += renderCards(view, evaluated.formulas, thisFile, asOf)
    else html += renderTable(view, evaluated.formulas, thisFile, evaluated.propCfg, asOf)
  }
  return html + '</section>'
}

// ── target resolution + page assembly ──────────────────────────────────────

export interface RenderTargetResult {
  /** The full stamped HTML page. */
  html: string
  /** Structured evaluation per rendered base (for tests / refresh checks). */
  bases: { label: string; evaluated: EvaluatedBase; thisFile: string | null }[]
  /** Source hash over the vault's md + base content (staleness key). */
  sourceHash: string
  /** ISO generated-at. */
  generatedAt: string
  /** As-of date (YYYY-MMM-DD) the relative formulas were computed against. */
  asOfLabel: string
}

function sourceHash(root: string): string {
  const all: string[] = []
  const stack = [root]
  const SKIP = new Set(['.obsidian', '.trash', 'out', '.git', 'node_modules'])
  while (stack.length) {
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) stack.push(full)
      } else if (e.name.endsWith('.md') || e.name.endsWith('.base')) {
        try {
          all.push(fs.readFileSync(full, 'utf8'))
        } catch {
          /* race */
        }
      }
    }
  }
  return crypto.createHash('sha256').update(all.sort().join(' ')).digest('hex').slice(0, 12)
}

/** Extract embedded ```base block YAML defs from a note's body. */
function embeddedBaseDefs(note: VaultFile): BaseDef[] {
  const out: BaseDef[] = []
  for (const m of note.body.matchAll(/```base\n([\s\S]*?)```/g)) {
    try {
      const def = yamlLoad(m[1])
      if (def && typeof def === 'object') out.push(def as BaseDef)
    } catch {
      /* malformed embedded block — skip (warn-and-render) */
    }
  }
  return out
}

/** Render a target — a `.base` file path (vault-wide), or a note (path or
 *  basename, renders its embedded ```base blocks with `this` = the note).
 *  Returns the stamped HTML page + structured results. */
export function renderTarget(
  root: string,
  target: string,
  opts: { asOf?: Date } = {},
): RenderTargetResult {
  const asOf = opts.asOf ?? defaultAsOf()
  const notes = readNotes(root)
  const files = buildEngineFiles(notes, asOf)
  const byName = new Map(files.map((f) => [f.name, f]))

  const bases: RenderTargetResult['bases'] = []
  const sections: string[] = []

  const abs = path.isAbsolute(target) ? target : path.resolve(root, target)
  if (target.endsWith('.base')) {
    const def = yamlLoad(fs.readFileSync(abs, 'utf8')) as BaseDef
    const label = path.relative(root, abs).split(path.sep).join('/')
    const evaluated = evaluateBaseDef(def, files, null, asOf)
    bases.push({ label, evaluated, thisFile: null })
    sections.push(renderBaseSection(evaluated, null, label, asOf))
  } else {
    // Resolve a note: an existing path, else a basename in the vault.
    let note: VaultFile | undefined
    if (fs.existsSync(abs) && abs.endsWith('.md')) note = parseFile(abs, root)
    else note = notes.find((n) => n.basename === target.replace(/\.md$/, ''))
    if (!note) throw new Error(`render target not found: ${target} (expected a .base file or a note path/name)`)
    const thisFile = byName.get(note.basename) ?? null
    const defs = embeddedBaseDefs(note)
    if (!defs.length) {
      throw new Error(`no \`\`\`base blocks found in ${note.relPath} (nothing to render)`)
    }
    defs.forEach((def, i) => {
      const label = `${note!.relPath}${defs.length > 1 ? ` [block ${i + 1}]` : ''}  (this = ${note!.basename})`
      const evaluated = evaluateBaseDef(def, files, thisFile, asOf)
      bases.push({ label, evaluated, thisFile: note!.basename })
      sections.push(renderBaseSection(evaluated, thisFile, label, asOf))
    })
  }

  const hash = sourceHash(root)
  const generatedAt = new Date().toISOString()
  const asOfLabel = new DuoDate(asOf, asOf).format('YYYY-MMM-DD')
  const html = assemblePage(sections, {
    sourceHash: hash,
    generatedAt,
    asOfLabel,
    noteCount: notes.length,
    baseCount: bases.length,
    target,
  })
  return { html, bases, sourceHash: hash, generatedAt, asOfLabel }
}

function assemblePage(
  sections: string[],
  meta: { sourceHash: string; generatedAt: string; asOfLabel: string; noteCount: number; baseCount: number; target: string },
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Vault rollup — ${esc(meta.target)}</title>
<style>
:root { --paper:#fbf8f1; --paper-deep:#f3ede0; --paper-rule:#d9cea8; --ink:#2b2620;
  --ink-soft:#4a4238; --ink-mute:#6f6557; --ink-ghost:#9a9080; --accent:#c46a1c;
  --pass:#4a7d3e; --fail:#b13e3a; --harbor:#3C6E93; }
* { box-sizing:border-box; }
body { margin:0 auto; padding:32px 40px 64px; max-width:960px; background:var(--paper);
  color:var(--ink); font:14px/1.55 -apple-system,"SF Pro Text",system-ui,sans-serif; }
h1 { font-family:"New York","Iowan Old Style",Georgia,serif; font-style:italic; font-weight:500; font-size:22px; margin:0 0 4px; }
.stamp { background:var(--paper-deep); border:1px solid var(--paper-rule); border-radius:6px;
  padding:10px 14px; margin:14px 0 28px; font-size:12px; color:var(--ink-mute);
  font-family:ui-monospace,"SF Mono",Menlo,monospace; }
.stamp strong { color:var(--accent); }
h2 { font-family:"New York",Georgia,serif; font-weight:600; font-size:18px;
  border-bottom:1px solid var(--paper-rule); padding-bottom:6px; margin:34px 0 8px; }
h3 { font-size:14px; margin:18px 0 6px; }
.count { font-weight:400; font-size:11.5px; color:var(--ink-ghost); }
table { border-collapse:collapse; width:100%; font-size:12.5px; margin:6px 0 14px; }
th,td { border-bottom:1px solid var(--paper-rule); padding:6px 8px; text-align:left; vertical-align:top; }
th { font-size:11px; text-transform:uppercase; letter-spacing:.03em; color:var(--ink-mute); }
tr.group td { background:var(--paper-deep); font-weight:600; font-size:12px; }
.summary { font-weight:400; color:var(--ink-mute); font-size:11.5px; }
.wikilink { color:var(--harbor); border-bottom:1px dotted var(--harbor); }
.empty { color:var(--ink-ghost); }
.err { color:var(--fail); font-size:11px; }
.baselist { margin:6px 0 14px; }
.cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:10px; margin:6px 0 14px; }
.card { background:white; border:1px solid var(--paper-rule); border-radius:6px; padding:10px 12px; }
.card-title { font-weight:600; margin-bottom:6px; }
.card-row { font-size:12px; color:var(--ink-soft); }
.card-k { color:var(--ink-ghost); font-size:10.5px; text-transform:uppercase; letter-spacing:.03em; margin-right:4px; }
footer { margin-top:40px; border-top:1px solid var(--paper-rule); padding-top:12px;
  font-size:11.5px; color:var(--ink-mute); }
</style>
</head>
<body>
<h1>Vault rollup — ${esc(meta.target)}</h1>
<div class="stamp"><strong>BUILD ARTIFACT</strong> — regenerate: duo base render ${esc(meta.target)} ·
generated ${esc(meta.generatedAt)} · source hash <strong>${esc(meta.sourceHash)}</strong> ·
date-relative formulas as of ${esc(meta.asOfLabel)} ·
${meta.noteCount} notes, ${meta.baseCount} rendered base(s)</div>
${sections.join('\n')}
<footer>Duo-owned rollup render (ENH-208). Implements the locked Bases
expression subset (filters and/or/not, link equality vs <code>this</code>,
date math, if(), html(), icon(), backlink chains, groupBy, summaries).
file.name is extension-less; child→parent backlink rollups always resolve
here. Re-render to refresh; the source hash above detects staleness.</footer>
</body>
</html>
`
}
