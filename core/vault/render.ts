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
import { targetKey } from '../markdown/vaultLinks'
import { renderBaseMarkdown, assembleMarkdownPage } from './render-markdown'
import { snapshotComment, summaryLogComment, rollupDocComment, type RollupSnapshot, type SummaryEntry } from './rollup'
import { gitHubBlobUrl, type GitHubLinkBase } from './rollup-markdown'
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
import { isGeneratedListingBasename } from './okf-filenames'
import { OUTPUT_DIR_NAMES } from './output-dir'

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

export const esc = (s: unknown): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** ENH-229 (D5 / req #6) — resolves entity links so a rollup row links the
 *  notes it rolls up. Built per-render from the file set + the artifact's
 *  output dir; an href is the POSIX path from the artifact to the target note
 *  (standard markdown rel link, GitHub-portable). Returns null when a value
 *  doesn't resolve to a real corpus note — unresolved values stay plain text,
 *  never a fabricated target. Shared by the HTML and Markdown serializers. */
export interface LinkCtx {
  /** Rel href from the artifact to a vault-relative note path (always defined
   *  for a non-empty path; null for empty). */
  hrefFor(noteRelPath: string): string | null
  /** Resolve a Link value to its target note's rel href, or null if the target
   *  isn't a note in the corpus. */
  resolveLink(link: Link): string | null
}

/** Build a {@link LinkCtx} for one render. `outDir` is where the artifact will
 *  be written (hrefs are relative to it); defaults to the vault root.
 *  ENH-248 R8 — with `github` set (a pre-probed {@link GitHubLinkBase}),
 *  hrefs become GitHub blob URLs instead, so the artifact's entity links
 *  land on GitHub's RENDERED markdown view when the page is viewed off-disk
 *  (GitHub Pages serves raw .md; relative links there dead-end on plain
 *  text). Falls back to the relative form per-path only if composition
 *  fails (the probe already rejected non-GitHub hosts wholesale). */
export function buildLinkCtx(
  files: EngineFile[],
  root: string,
  outDir: string,
  github?: GitHubLinkBase | null,
): LinkCtx {
  const byKey = new Map(files.map((f) => [targetKey(f.name, 'wikilink'), f]))
  const rel = (noteRelPath: string): string => {
    const abs = path.resolve(root, noteRelPath)
    if (github) {
      const blob = gitHubBlobUrl(github, abs)
      if (blob) return blob
    }
    let r = path.relative(outDir, abs).split(path.sep).join('/')
    if (!r.startsWith('.') && !r.startsWith('/')) r = './' + r
    return r
  }
  return {
    hrefFor: (noteRelPath) => (noteRelPath ? rel(noteRelPath) : null),
    resolveLink: (link) => {
      const f = byKey.get(targetKey(link.target, 'wikilink'))
      return f ? rel(f.path) : null
    },
  }
}

function cell(v: unknown, linkCtx?: LinkCtx): string {
  if (v == null || v === '') return '<span class="empty">—</span>'
  if (isEvalError(v)) return '<span class="err" title="' + esc(v.__expr) + '">⚠ ' + esc(v.__error) + '</span>'
  if (typeof v === 'object' && v !== null && '__html' in v) return (v as { __html: string }).__html
  if (v instanceof Link) {
    const href = linkCtx?.resolveLink(v)
    return href
      ? '<a class="wikilink" href="' + esc(href) + '">' + esc(v.display) + '</a>'
      : '<span class="wikilink">' + esc(v.display) + '</span>'
  }
  if (v instanceof DuoDate) return esc(v.toString())
  if (Array.isArray(v)) return v.map((x) => cell(x, linkCtx)).join(', ')
  if (typeof v === 'number') return String(v)
  return esc(String(v))
}

/** A table/list/card cell. The `file.name` / `file.link` column links the
 *  row's own note (req #6); other columns delegate to {@link cell} (which links
 *  resolved Link values). */
function htmlCell(prop: string, f: EngineFile, value: unknown, linkCtx?: LinkCtx): string {
  if (linkCtx && (prop === 'file.name' || prop === 'file.link')) {
    const href = linkCtx.hrefFor(f.path)
    if (href) return '<a class="wikilink" href="' + esc(href) + '">' + esc(String(value)) + '</a>'
  }
  return cell(value, linkCtx)
}

/** A column value → a plain string for the diff snapshot (ENH-229 phase 2).
 *  Format-neutral (no HTML/MD), so the diff is the same regardless of variant. */
export function plainCell(v: unknown): string {
  if (v == null || v === '') return ''
  if (isEvalError(v)) return '⚠ ' + v.__error
  if (typeof v === 'object' && v !== null && '__html' in v)
    return String((v as { __html: string }).__html)
      .replace(/<[^>]*>/g, '')
      .trim()
  if (v instanceof Link) return v.display
  if (v instanceof DuoDate) return v.toString()
  if (Array.isArray(v)) return v.map(plainCell).join(', ')
  return String(v)
}

/** The "What changed" section (ENH-229 phase 2) — latest summary pinned, prior
 *  entries in a collapsible history. Authored prose is HTML-escaped. */
function summarySectionHtml(log: SummaryEntry[]): string {
  if (!log.length) return ''
  const [latest, ...rest] = log
  let h =
    '<section class="changes"><div class="changes-latest"><span class="changes-lab">What changed · ' +
    esc(latest.date) +
    '</span><p>' +
    esc(latest.text) +
    '</p></div>'
  if (rest.length) {
    h +=
      '<details class="changes-hist"><summary>Change history (' +
      rest.length +
      ')</summary><ul>' +
      rest.map((e) => '<li><strong>' + esc(e.date) + '</strong> — ' + esc(e.text) + '</li>').join('') +
      '</ul></details>'
  }
  return h + '</section>'
}

export function colLabel(prop: string, propCfg?: Record<string, { displayName?: string }>): string {
  if (propCfg && propCfg[prop] && propCfg[prop].displayName) return propCfg[prop].displayName!
  return prop.replace(/^(note|file|formula)\./, '')
}

export const SUMMARY_FNS: Record<string, (vals: unknown[]) => unknown> = {
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
  linkCtx?: LinkCtx,
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
    parts.push(esc(colLabel(prop)) + ' ' + esc(fnName).toLowerCase() + ': ' + cell(fn(vals), linkCtx))
  }
  return ' <span class="summary">' + parts.join(' · ') + '</span>'
}

function renderTable(
  view: EvaluatedView,
  formulas: Record<string, unknown>,
  thisFile: EngineFile | null,
  propCfg: Record<string, { displayName?: string }>,
  asOf: Date,
  linkCtx?: LinkCtx,
): string {
  const order = view.order
  const head = '<tr>' + order.map((p) => '<th>' + esc(colLabel(p, propCfg)) + '</th>').join('') + '</tr>'
  const groups = new Map<string | null, EngineFile[]>()
  const groupRaw = new Map<string | null, unknown>()
  if (view.groupBy) {
    for (const f of view.rows) {
      const v = readCol(view.groupBy.property, f, thisFile, formulas, asOf)
      const key = v == null ? '—' : String(v instanceof Link ? v.display : v)
      if (!groups.has(key)) {
        groups.set(key, [])
        groupRaw.set(key, v)
      }
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
      // ENH-229 req #6 — link the group header to its entity note when the
      // grouped value is a Link that resolves to a corpus note.
      const raw = groupRaw.get(key)
      let label = esc(key)
      if (linkCtx && raw instanceof Link) {
        const href = linkCtx.resolveLink(raw)
        if (href) label = '<a class="wikilink" href="' + esc(href) + '">' + esc(key) + '</a>'
      }
      html +=
        '<tr class="group"><td colspan="' +
        order.length +
        '">' +
        label +
        ' <span class="count">(' +
        gRows.length +
        ')</span>' +
        summaryInline(gRows, view, formulas, thisFile, asOf, linkCtx) +
        '</td></tr>'
    }
    for (const f of gRows) {
      html +=
        '<tr>' +
        order.map((p) => '<td>' + htmlCell(p, f, readCol(p, f, thisFile, formulas, asOf), linkCtx) + '</td>').join('') +
        '</tr>'
    }
  }
  if (!view.groupBy && view.summaries) {
    html +=
      '<tr class="group"><td colspan="' +
      order.length +
      '">' +
      summaryInline(view.rows, view, formulas, thisFile, asOf, linkCtx) +
      '</td></tr>'
  }
  return html + '</table>'
}

function renderList(
  view: EvaluatedView,
  formulas: Record<string, unknown>,
  thisFile: EngineFile | null,
  asOf: Date,
  linkCtx?: LinkCtx,
): string {
  return (
    '<ul class="baselist">' +
    view.rows
      .map(
        (f) =>
          '<li>' + view.order.map((p) => htmlCell(p, f, readCol(p, f, thisFile, formulas, asOf), linkCtx)).join(' ') + '</li>',
      )
      .join('') +
    '</ul>'
  )
}

function renderCards(
  view: EvaluatedView,
  formulas: Record<string, unknown>,
  thisFile: EngineFile | null,
  asOf: Date,
  linkCtx?: LinkCtx,
): string {
  return (
    '<div class="cards">' +
    view.rows
      .map((f) => {
        const [title, ...rest] = view.order
        return (
          '<div class="card"><div class="card-title">' +
          htmlCell(title, f, readCol(title, f, thisFile, formulas, asOf), linkCtx) +
          '</div>' +
          rest
            .map(
              (p) =>
                '<div class="card-row"><span class="card-k">' +
                esc(colLabel(p)) +
                '</span> ' +
                htmlCell(p, f, readCol(p, f, thisFile, formulas, asOf), linkCtx) +
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

/** Render one evaluated base to an HTML section. `linkCtx` (ENH-229) makes rows
 *  link the notes they roll up; omit it for link-free output. */
export function renderBaseSection(
  evaluated: EvaluatedBase,
  thisFile: EngineFile | null,
  label: string,
  asOf: Date,
  linkCtx?: LinkCtx,
): string {
  let html = '<section class="base"><h2>' + esc(label) + '</h2>'
  for (const view of evaluated.views) {
    html += '<h3>' + esc(view.name) + ' <span class="count">' + view.rows.length + ' rows</span></h3>'
    if (view.type === 'list') html += renderList(view, evaluated.formulas, thisFile, asOf, linkCtx)
    else if (view.type === 'cards') html += renderCards(view, evaluated.formulas, thisFile, asOf, linkCtx)
    else html += renderTable(view, evaluated.formulas, thisFile, evaluated.propCfg, asOf, linkCtx)
  }
  return html + '</section>'
}

// ── target resolution + page assembly ──────────────────────────────────────

export interface RenderTargetResult {
  /** The full stamped HTML page. */
  html: string
  /** The full stamped Markdown artifact (ENH-229 — the MD variant; same
   *  evaluation, GitHub-portable). The CLI writes html OR md per the flag.
   *  INVARIANT: both `html` and `md` are always generated regardless of the
   *  intended output format — the CLI chooses which to write. */
  md: string
  /** The freshly-built rows snapshot (ENH-229 phase 2) — `duo rollup diff`
   *  compares this against a prior artifact's embedded snapshot. */
  snapshot: RollupSnapshot
  /** Structured evaluation per rendered base (for tests / refresh checks). */
  bases: { label: string; evaluated: EvaluatedBase; thisFile: string | null }[]
  /** Source hash over the vault's md + base content (staleness key). */
  sourceHash: string
  /** ISO generated-at. */
  generatedAt: string
  /** As-of date (YYYY-MMM-DD) the relative formulas were computed against. */
  asOfLabel: string
}

/** Stable source hash over the vault's note + base content — the staleness
 *  key stamped into rendered artifacts AND into the OKF generated listings
 *  (U3 `writeListings`). Exported (ENH-216) so `listings.ts` is the only
 *  consumer; the generated listing files themselves (ENH-245: either
 *  `_index.md`/`index.md` or `_log.md`/`log.md`) are EXCLUDED from the walk
 *  so a regenerated listing never perturbs its own hash. Shares the same
 *  `isGeneratedListingBasename` check as `listings.ts` so the two never
 *  drift apart on what counts as "generated" (they had, pre-ENH-245). */
export function sourceHash(root: string): string {
  const all: string[] = []
  const stack = [root]
  const SKIP = new Set(['.obsidian', '.trash', ...OUTPUT_DIR_NAMES, 'rollups', '.git', 'node_modules'])
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
      } else if ((e.name.endsWith('.md') || e.name.endsWith('.base')) && !isGeneratedListingBasename(e.name)) {
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
  opts: {
    asOf?: Date
    outDir?: string
    /** Custom CSS to inline instead of the built-in Atelier style (ENH-229 req #3). */
    styleCss?: string
    /** The change-summary log (newest-first) to render + embed (ENH-229 phase 2). */
    summaryLog?: SummaryEntry[]
    /** Embed the rows snapshot + summary log as HTML comments for later diffing. */
    embedSnapshot?: boolean
    /** ENH-248 R8 — pre-probed GitHub base: entity links become blob URLs.
     *  The probe is async (git subprocesses) so the CALLER runs it
     *  (`probeGitHubLinkBase`) and passes the result; renderTarget stays sync. */
    github?: GitHubLinkBase | null
  } = {},
): RenderTargetResult {
  const asOf = opts.asOf ?? defaultAsOf()
  const notes = readNotes(root)
  const files = buildEngineFiles(notes, asOf)
  const byName = new Map(files.map((f) => [f.name, f]))
  // ENH-229 — hrefs are relative to where the artifact will be written
  // (defaults to the vault root). Both serializers share this resolver.
  const linkCtx = buildLinkCtx(files, root, opts.outDir ?? root, opts.github)

  const bases: RenderTargetResult['bases'] = []
  const sections: string[] = []
  const mdSections: string[] = []
  const snapshot: RollupSnapshot = { v: 1, views: [] }
  // Snapshot view names must be unique for the diff to match views 1:1, so a
  // second view with the same name (e.g. two embedded base blocks both named
  // "Tasks") is suffixed rather than colliding.
  const viewNameCounts = new Map<string, number>()

  // Capture each view's rows as plain strings for the diff snapshot.
  const collect = (evaluated: EvaluatedBase, thisFile: EngineFile | null) => {
    for (const v of evaluated.views) {
      const n = (viewNameCounts.get(v.name) ?? 0) + 1
      viewNameCounts.set(v.name, n)
      snapshot.views.push({
        name: n === 1 ? v.name : `${v.name} (${n})`,
        rows: v.rows.map((f) => ({
          key: f.path,
          cells: Object.fromEntries(
            v.order.map((p) => [p, plainCell(readCol(p, f, thisFile, evaluated.formulas, asOf))]),
          ),
        })),
      })
    }
  }

  const abs = path.isAbsolute(target) ? target : path.resolve(root, target)
  if (target.endsWith('.base')) {
    const def = yamlLoad(fs.readFileSync(abs, 'utf8')) as BaseDef
    const label = path.relative(root, abs).split(path.sep).join('/')
    const evaluated = evaluateBaseDef(def, files, null, asOf)
    bases.push({ label, evaluated, thisFile: null })
    sections.push(renderBaseSection(evaluated, null, label, asOf, linkCtx))
    mdSections.push(renderBaseMarkdown(evaluated, null, label, asOf, linkCtx))
    collect(evaluated, null)
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
      sections.push(renderBaseSection(evaluated, thisFile, label, asOf, linkCtx))
      mdSections.push(renderBaseMarkdown(evaluated, thisFile, label, asOf, linkCtx))
      collect(evaluated, thisFile)
    })
  }

  const hash = sourceHash(root)
  const generatedAt = new Date().toISOString()
  const asOfLabel = new DuoDate(asOf, asOf).format('YYYY-MMM-DD')
  const summaryLog = opts.summaryLog ?? []
  const embedded = opts.embedSnapshot
    ? snapshotComment(snapshot) + (summaryLog.length ? '\n' + summaryLogComment(summaryLog) : '')
    : ''
  // Build the Markdown first so the HTML artifact can embed it for its
  // "Copy as Markdown" button (req #4).
  const md = assembleMarkdownPage(mdSections, {
    title: target,
    sourceHash: hash,
    generatedAt,
    asOfLabel,
    noteCount: notes.length,
    baseCount: bases.length,
    target,
    rollup: !!opts.embedSnapshot,
    summaryLog,
    embedded,
  })
  const html = assemblePage(sections, {
    sourceHash: hash,
    generatedAt,
    asOfLabel,
    noteCount: notes.length,
    baseCount: bases.length,
    target,
    rollup: !!opts.embedSnapshot,
    styleCss: opts.styleCss,
    summaryHtml: summarySectionHtml(summaryLog),
    markdownSource: md,
    embedded,
    // ENH-250 — the artifact's own Refresh button needs the vault root to
    // self-render (no watching Claude required); embedded in a data
    // attribute (never shown as visible text), same trust posture as the
    // embedded markdown source already used for "Copy as Markdown".
    root,
  })
  return { html, md, snapshot, bases, sourceHash: hash, generatedAt, asOfLabel }
}

function assemblePage(
  sections: string[],
  meta: {
    sourceHash: string
    generatedAt: string
    asOfLabel: string
    noteCount: number
    baseCount: number
    target: string
    rollup?: boolean
    styleCss?: string
    summaryHtml?: string
    markdownSource?: string
    embedded?: string
    /** ENH-250 — the vault root, embedded ONLY for the Refresh button's
     *  data-payload (never rendered as visible text). */
    root?: string
  },
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
.wikilink { color:var(--harbor); border-bottom:1px dotted var(--harbor); text-decoration:none; }
a.wikilink:hover { border-bottom-style:solid; }
.changes { background:#fcf6ec; border:1px solid var(--paper-rule); border-left:3px solid var(--accent); border-radius:0 6px 6px 0; padding:10px 14px; margin:0 0 24px; }
.changes-lab { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--accent); font-weight:600; }
.changes-latest p { margin:4px 0 0; color:var(--ink-soft); }
.changes-hist { margin-top:8px; font-size:12px; }
.changes-hist summary { cursor:pointer; color:var(--ink-mute); }
.changes-hist ul { margin:6px 0 0; padding-left:18px; color:var(--ink-mute); }
.rl-toolbar { display:flex; gap:8px; margin:0 0 20px; }
.rl-btn { font-size:12px; font-family:inherit; border:1px solid var(--paper-rule); background:var(--paper-deep); color:var(--ink-soft); border-radius:6px; padding:6px 11px; cursor:pointer; }
.rl-btn:hover { border-color:var(--ink-ghost); }
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
${meta.styleCss ? '<style>\n' + meta.styleCss.replace(/<\//g, '<\\/') + '\n</style>' : ''}
</head>
<body>
${meta.rollup ? rollupDocComment(meta.target) : ''}
<h1>Vault rollup — ${esc(meta.target)}</h1>
<div class="stamp"><strong>BUILD ARTIFACT</strong> — regenerate: duo rollup render ${esc(meta.target)} ·
generated ${esc(meta.generatedAt)} · source hash <strong>${esc(meta.sourceHash)}</strong> ·
date-relative formulas as of ${esc(meta.asOfLabel)} ·
${meta.noteCount} notes, ${meta.baseCount} rendered base(s)</div>
${
  meta.rollup
    ? // ENH-248 R2 — Copy as Markdown is the ONLY embedded button now: it's
      // genuinely useful anywhere the file opens (owner lock), while Refresh /
      // Edit are Duo-only verbs that live in Duo's OWN artifact toolbar (the
      // browser pane detects the rollup marker comment and overlays native
      // chrome) — behavior ships with Duo updates, never frozen into the file.
      '<div class="rl-toolbar">\n' +
      '<button class="rl-btn" type="button" data-rollup-copy>Copy as Markdown</button>\n' +
      '</div>'
    : ''
}
${meta.summaryHtml ?? ''}
${sections.join('\n')}
<footer>Duo-owned rollup render (ENH-208). Implements the locked Bases
expression subset (filters and/or/not, link equality vs <code>this</code>,
date math, if(), html(), icon(), backlink chains, groupBy, summaries).
file.name is extension-less; child→parent backlink rollups always resolve
here. Re-render to refresh; the source hash above detects staleness.</footer>
${meta.embedded ?? ''}
${
  meta.rollup
    ? '<script>window.__rollupMd = ' +
      JSON.stringify(meta.markdownSource ?? '').replace(/</g, '\\u003c') +
      ';</script>\n' +
      "<script>(function(){var b=document.querySelector('[data-rollup-copy]');if(!b)return;b.addEventListener('click',function(){navigator.clipboard.writeText(window.__rollupMd||'').then(function(){var o=b.textContent;b.textContent='Copied';setTimeout(function(){b.textContent=o},1300)}).catch(function(){b.textContent='Copy failed (focus the page)'})})})();</script>"
    : ''
}
</body>
</html>
`
}
