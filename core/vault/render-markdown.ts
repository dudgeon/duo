// ENH-229 — Markdown serializer for vault rollups. The Markdown twin of the
// HTML emitter in render.ts: ONE evaluation (evaluateBaseDef), TWO serializers
// (D1 — mirrors the locked OKF/Obsidian "one graph, two serializers" pattern).
//
// Emits GFM — grouped tables become a sub-heading + table per group — with
// entity links (req #6 / D5): the row's own note and any resolved Link-valued
// frontmatter render as standard markdown rel links, GitHub-portable. Reuses
// readCol / SUMMARY_FNS / colLabel / LinkCtx from render.ts so the two formats
// never drift.

import { DuoDate, Link, isEvalError, type EngineFile } from './engine'
import {
  readCol,
  colLabel,
  SUMMARY_FNS,
  type EvaluatedBase,
  type EvaluatedView,
  type LinkCtx,
} from './render'

type Formulas = Record<string, unknown>
type PropCfg = Record<string, { displayName?: string }>

/** GFM-safe inline text: collapse newlines, escape table pipes. */
function mdText(s: string): string {
  return s.replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|').trim()
}

/** Inline text for link display / headings / free-text cells. Collapses
 *  newlines, then backslash-escapes the GFM-active set — backslash, pipe,
 *  backtick, []() — in ONE pass so each char gets exactly one backslash (a
 *  compose-with-mdText would double-escape the pipe's own backslash). */
function mdInline(s: string): string {
  return s.replace(/\r?\n+/g, ' ').trim().replace(/([\\`|[\]()])/g, '\\$1')
}

/** A GFM link: escaped display + an angle-bracketed href, which stays valid
 *  even when the href contains spaces, parens, or brackets (CommonMark §6.6). */
function mdLink(display: string, href: string): string {
  return '[' + mdInline(display) + '](<' + href + '>)'
}

/** A value → inline Markdown. Parallel to render.ts `cell()`: a resolved Link
 *  becomes `[display](rel)`; dates / arrays / errors / html() formulas
 *  normalize to text. Unresolved links stay plain text (never a fake target). */
export function valueToMarkdown(v: unknown, linkCtx?: LinkCtx): string {
  if (v == null || v === '') return '—'
  if (isEvalError(v)) return '⚠ ' + mdInline(v.__error)
  if (typeof v === 'object' && v !== null && '__html' in v) {
    // html()/icon() cell formulas are an HTML-presentation affordance; in
    // Markdown, fall back to their text content (tags stripped).
    return mdInline(String((v as { __html: string }).__html).replace(/<[^>]*>/g, ''))
  }
  if (v instanceof Link) {
    const href = linkCtx?.resolveLink(v)
    return href ? mdLink(v.display, href) : mdInline(v.display)
  }
  if (v instanceof DuoDate) return mdInline(v.toString())
  if (Array.isArray(v)) return v.map((x) => valueToMarkdown(x, linkCtx)).join(', ')
  if (typeof v === 'number') return String(v)
  return mdInline(String(v))
}

/** One cell. The `file.name` / `file.link` column links the row's own note. */
function mdCell(prop: string, f: EngineFile, value: unknown, linkCtx?: LinkCtx): string {
  if (linkCtx && (prop === 'file.name' || prop === 'file.link')) {
    const href = linkCtx.hrefFor(f.path)
    if (href) return mdLink(String(value), href)
  }
  return valueToMarkdown(value, linkCtx)
}

function mdSummary(
  rows: EngineFile[],
  view: EvaluatedView,
  formulas: Formulas,
  thisFile: EngineFile | null,
  asOf: Date,
  linkCtx?: LinkCtx,
): string {
  if (!view.summaries) return ''
  const parts: string[] = []
  for (const [prop, fnName] of Object.entries(view.summaries)) {
    const fn = SUMMARY_FNS[fnName]
    if (!fn) {
      parts.push(mdText(fnName) + ': ?')
      continue
    }
    const vals = rows.map((f) => readCol(prop, f, thisFile, formulas, asOf))
    parts.push(colLabel(prop) + ' ' + fnName.toLowerCase() + ': ' + valueToMarkdown(fn(vals), linkCtx))
  }
  return parts.length ? '_' + parts.join(' · ') + '_' : ''
}

function tableFor(
  rows: EngineFile[],
  order: string[],
  formulas: Formulas,
  thisFile: EngineFile | null,
  propCfg: PropCfg,
  asOf: Date,
  linkCtx?: LinkCtx,
): string {
  const header = '| ' + order.map((p) => mdInline(colLabel(p, propCfg))).join(' | ') + ' |'
  const divider = '| ' + order.map(() => '---').join(' | ') + ' |'
  const body = rows
    .map((f) => '| ' + order.map((p) => mdCell(p, f, readCol(p, f, thisFile, formulas, asOf), linkCtx)).join(' | ') + ' |')
    .join('\n')
  return header + '\n' + divider + (body ? '\n' + body : '')
}

function renderTableMarkdown(
  view: EvaluatedView,
  formulas: Formulas,
  thisFile: EngineFile | null,
  propCfg: PropCfg,
  asOf: Date,
  linkCtx?: LinkCtx,
): string {
  const order = view.order
  if (!view.groupBy) {
    const sum = mdSummary(view.rows, view, formulas, thisFile, asOf, linkCtx)
    const table = tableFor(view.rows, order, formulas, thisFile, propCfg, asOf, linkCtx)
    return sum ? table + '\n\n' + sum : table
  }
  const groups = new Map<string, EngineFile[]>()
  const groupRaw = new Map<string, unknown>()
  for (const f of view.rows) {
    const v = readCol(view.groupBy.property, f, thisFile, formulas, asOf)
    const key = v == null ? '—' : String(v instanceof Link ? v.display : v)
    if (!groups.has(key)) {
      groups.set(key, [])
      groupRaw.set(key, v)
    }
    groups.get(key)!.push(f)
  }
  const keys = [...groups.keys()].sort((a, b) => a.localeCompare(b))
  if (String(view.groupBy.direction).toUpperCase() === 'DESC') keys.reverse()
  return keys
    .map((key) => {
      const gRows = groups.get(key)!
      const raw = groupRaw.get(key)
      let label = mdInline(key)
      if (linkCtx && raw instanceof Link) {
        const href = linkCtx.resolveLink(raw)
        if (href) label = mdLink(key, href)
      }
      const sum = mdSummary(gRows, view, formulas, thisFile, asOf, linkCtx)
      const head = '#### ' + label + ' (' + gRows.length + ')' + (sum ? '\n' + sum : '')
      return head + '\n\n' + tableFor(gRows, order, formulas, thisFile, propCfg, asOf, linkCtx)
    })
    .join('\n\n')
}

function renderListMarkdown(
  view: EvaluatedView,
  formulas: Formulas,
  thisFile: EngineFile | null,
  asOf: Date,
  linkCtx?: LinkCtx,
): string {
  return view.rows
    .map((f) => '- ' + view.order.map((p) => mdCell(p, f, readCol(p, f, thisFile, formulas, asOf), linkCtx)).join(' · '))
    .join('\n')
}

function renderCardsMarkdown(
  view: EvaluatedView,
  formulas: Formulas,
  thisFile: EngineFile | null,
  asOf: Date,
  linkCtx?: LinkCtx,
): string {
  return view.rows
    .map((f) => {
      const [title, ...rest] = view.order
      const head = '#### ' + mdCell(title, f, readCol(title, f, thisFile, formulas, asOf), linkCtx)
      if (!rest.length) return head
      const body = rest
        .map((p) => '- **' + mdInline(colLabel(p)) + ':** ' + mdCell(p, f, readCol(p, f, thisFile, formulas, asOf), linkCtx))
        .join('\n')
      return head + '\n' + body
    })
    .join('\n\n')
}

/** Render one evaluated base to a Markdown section (the twin of
 *  {@link renderBaseSection}). */
export function renderBaseMarkdown(
  evaluated: EvaluatedBase,
  thisFile: EngineFile | null,
  label: string,
  asOf: Date,
  linkCtx?: LinkCtx,
): string {
  const blocks: string[] = ['## ' + mdInline(label)]
  for (const view of evaluated.views) {
    blocks.push('### ' + mdInline(view.name) + ' (' + view.rows.length + ')')
    if (view.type === 'list') blocks.push(renderListMarkdown(view, evaluated.formulas, thisFile, asOf, linkCtx))
    else if (view.type === 'cards') blocks.push(renderCardsMarkdown(view, evaluated.formulas, thisFile, asOf, linkCtx))
    else blocks.push(renderTableMarkdown(view, evaluated.formulas, thisFile, evaluated.propCfg, asOf, linkCtx))
  }
  return blocks.join('\n\n')
}

/** Assemble the full Markdown artifact: YAML frontmatter (stamp + an optional
 *  embedded rows snapshot for change-diffing, set by the caller) + the base
 *  sections + a build-artifact stamp blockquote. GitHub-portable. */
export function assembleMarkdownPage(
  sections: string[],
  meta: {
    title: string
    sourceHash: string
    generatedAt: string
    asOfLabel: string
    noteCount: number
    baseCount: number
    target: string
  },
): string {
  // JSON.stringify yields a valid double-quoted YAML scalar, so a title with
  // `:`, `#`, `---`, or quotes can't corrupt the frontmatter block.
  const frontmatter = [
    '---',
    'title: ' + JSON.stringify(meta.title),
    'generated: ' + meta.generatedAt,
    'source_hash: ' + meta.sourceHash,
    'as_of: ' + meta.asOfLabel,
    '---',
    '',
  ].join('\n')
  const stamp =
    '> **Build artifact** — regenerate: `duo rollup render ' +
    meta.target +
    ' --md` · source-hash `' +
    meta.sourceHash +
    '` · as-of ' +
    meta.asOfLabel +
    ' · ' +
    meta.noteCount +
    ' notes, ' +
    meta.baseCount +
    ' base(s).'
  return frontmatter + sections.join('\n\n') + '\n\n' + stamp + '\n'
}
