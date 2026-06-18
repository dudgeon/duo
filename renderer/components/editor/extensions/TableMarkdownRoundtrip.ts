// BUG-210 (2026-06-16) — multi-line table-cell round-trip.
//
// Symptom: a GFM table whose cells hold multiple lines (a bullet list of
// people, several paragraphs, or Shift-Enter hard breaks) was SHATTERED on
// the next save. The header row survived, then everything from the first
// multi-line cell spilled out below the table as broken plain-text rows
// (`| — | — | Business Cards and Payments | – Aram Ter-Minassian`, …). Each
// subsequent operation re-serialized the already-degraded doc and corrupted
// it further (the owner saw it happen three times).
//
// Root cause: tiptap-markdown's stock table serializer (`nodes/table.js`)
// renders a cell's block content with `state.renderInline(cell.firstChild)`,
// which emits blank lines between list items / paragraphs. A GFM table row
// MUST occupy a single physical line, so those embedded newlines terminate
// the table — the row breaks apart. The autosave / disk-reconciliation write
// path (`MarkdownEditor.save`) then persists that shattered markdown.
//
// Fix — three coordinated pieces that keep multi-line cells on ONE line using
// `<br>` (the GFM-canonical in-cell line break), losslessly and idempotently:
//
//   1. `TableWithMarkdownCells` — replaces tiptap-markdown's table serializer.
//      Each cell is flattened to a single line: block children and list items
//      are joined with `<br>`; list items keep their `- ` / `N. ` marker as
//      literal text; `|` is escaped; any stray newline collapses to `<br>` so
//      a row can NEVER span multiple lines (the structural guard).
//   2. `HardBreakWithMarkdown` — a hard break inside a table serializes as a
//      raw `<br>` (the stock extension routed through the HTML-node fallback,
//      which with `html:false` emitted a useless `[hardBreak]` placeholder).
//      Outside a table it keeps the default `\` + newline.
//   3. `TableCellBrParse` — on the PARSE side, scoped to `<td>`/`<th>` only,
//      splits literal `<br>` text back into real `<br>` elements so the cell
//      re-hydrates as a multi-line paragraph. Scoped to cells so prose `<br>`
//      is untouched (zero blast radius outside tables).
//
// Plus `tableRowsSurviveSerialize` — a backstop the save path consults: it
// re-parses the serialized body and refuses the write if a table lost rows
// (catches any future serializer regression before it can corrupt the file).
//
// Editor / canvas parity: (b) skipped — surface-specific. The HTML canvas
// stores tables as live DOM, not markdown source, so there is no markdown
// round-trip to shatter.

import Table from '@tiptap/extension-table'
import HardBreak from '@tiptap/extension-hard-break'
import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { MarkdownNodeSpec } from 'tiptap-markdown'

// The tiptap-markdown serializer state (prosemirror-markdown's
// MarkdownSerializerState, extended by tiptap-markdown with `inTable`). Only
// the members we touch are typed; the public package types don't surface
// `out` / `inTable`, so we describe them structurally.
interface MarkdownSerializeState {
  out: string
  inTable?: boolean
  renderInline(node: PMNode): void
  write(content?: string): void
  ensureNewLine(): void
  closeBlock(node: PMNode): void
}

const BR_TEXT = /<br\s*\/?>/i

// Render a single block node's INLINE content (marks included) to a string,
// without disturbing the live serializer output. We swap `state.out` for a
// scratch buffer, render, then restore — the same trick the stock table
// serializer relies on, but captured instead of written straight to the row.
function captureInline(state: MarkdownSerializeState, block: PMNode): string {
  const saved = state.out
  state.out = ''
  state.renderInline(block)
  const captured = state.out
  state.out = saved
  return captured
}

// prosemirror-markdown escapes a LINE-leading block marker (`-`, `+`, `*`,
// `>`, `#`, `N.`) so it won't re-parse as a list/heading/quote. Inside a GFM
// cell that marker is always inline text and can never start a block, so the
// escape is needless churn (`- Ashwin` → `\- Ashwin`). Strip it per logical
// line to keep the round-trip byte-faithful to the author's source.
function unescapeLeadingMarker(s: string): string {
  return s.replace(/^\\([-+*>#])/, '$1').replace(/^(\s*\d+)\\\. /, '$1. ')
}

// Flatten a cell's block content to one line. Lists become `- a<br>- b`,
// stacked paragraphs become `a<br>b`. Any residual newline collapses to
// `<br>` so the row is structurally guaranteed to stay single-line, and `|`
// is escaped so it can't be read as a column boundary.
function serializeCell(state: MarkdownSerializeState, cell: PMNode): string {
  const pieces: string[] = []
  cell.forEach((block) => {
    const name = block.type.name
    if (name === 'bulletList' || name === 'orderedList') {
      let index = 1
      block.forEach((item) => {
        const marker = name === 'orderedList' ? `${index}. ` : '- '
        const inner: string[] = []
        item.forEach((itemBlock) => inner.push(captureInline(state, itemBlock)))
        pieces.push(marker + unescapeLeadingMarker(inner.join('<br>')))
        index += 1
      })
    } else {
      pieces.push(unescapeLeadingMarker(captureInline(state, block)))
    }
  })
  return pieces
    .join('<br>')
    .replace(/\r?\n/g, '<br>')
    .replace(/\|/g, '\\|')
}

/**
 * Drop-in replacement for `@tiptap/extension-table` that serializes every
 * cell to a single GFM-legal line (see file header). Identity-preserving for
 * single-paragraph cells; the win is multi-line cells no longer shatter.
 */
export const TableWithMarkdownCells = Table.extend({
  addStorage() {
    const spec: MarkdownNodeSpec = {
      serialize(rawState, node) {
        const state = rawState as unknown as MarkdownSerializeState
        state.inTable = true
        node.forEach((row, _offset, rowIndex) => {
          state.write('| ')
          row.forEach((cell, _cellOffset, colIndex) => {
            if (colIndex) state.write(' | ')
            state.write(serializeCell(state, cell))
          })
          state.write(' |')
          state.ensureNewLine()
          if (rowIndex === 0) {
            const delimiter = Array.from({ length: row.childCount }).map(() => '---').join(' | ')
            state.write(`| ${delimiter} |`)
            state.ensureNewLine()
          }
        })
        state.closeBlock(node)
        state.inTable = false
      },
      parse: {
        // Parsing stays with markdown-it / ProseMirror's table parse rules.
      }
    }
    return { markdown: spec }
  }
})

/**
 * Hard break that serializes as a raw `<br>` inside a table (where a literal
 * newline is illegal) and keeps the default `\` + newline elsewhere. Replaces
 * StarterKit's hardBreak, whose in-table path emitted a `[hardBreak]`
 * placeholder under `html:false`.
 */
export const HardBreakWithMarkdown = HardBreak.extend({
  addStorage() {
    const spec: MarkdownNodeSpec = {
      serialize(rawState, node, parent, index) {
        const state = rawState as unknown as MarkdownSerializeState
        // Trailing hard breaks at the very end of a textblock are dropped
        // (mirrors the stock behavior): only emit when a non-break sibling
        // follows.
        for (let i = (index ?? 0) + 1; i < parent.childCount; i += 1) {
          if (parent.child(i).type !== node.type) {
            state.write(state.inTable ? '<br>' : '\\\n')
            return
          }
        }
      },
      parse: {
        // Hard breaks are produced on parse by TableCellBrParse (in cells)
        // and markdown-it's own `\`-newline handling (in prose).
      }
    }
    return { markdown: spec }
  }
})

/**
 * Parse-side companion: rehydrate literal `<br>` text inside table cells into
 * real `<br>` elements so a multi-line cell loads as a multi-line paragraph.
 * Scoped to `<td>`/`<th>` so `<br>` in ordinary prose is left verbatim.
 */
export const TableCellBrParse = Extension.create({
  name: 'tableCellBrParse',
  addStorage() {
    // Parse-only: `MarkdownNodeSpec` requires `serialize` (for nodes); this is
    // an Extension whose markdown storage only contributes a parse hook, so we
    // type just the parse slice tiptap-markdown reads.
    const spec: Pick<MarkdownNodeSpec, 'parse'> = {
      parse: {
        updateDOM(element: HTMLElement) {
          const doc = element.ownerDocument
          element.querySelectorAll('td, th').forEach((cell) => {
            // Collect text nodes first; we mutate the tree as we go.
            const walker = doc.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
            const textNodes: Text[] = []
            let current = walker.nextNode()
            while (current) {
              textNodes.push(current as Text)
              current = walker.nextNode()
            }
            for (const textNode of textNodes) {
              const value = textNode.textContent ?? ''
              if (!BR_TEXT.test(value)) continue
              const parts = value.split(/<br\s*\/?>/i)
              const frag = doc.createDocumentFragment()
              parts.forEach((part, i) => {
                if (i) frag.appendChild(doc.createElement('br'))
                if (part) frag.appendChild(doc.createTextNode(part))
              })
              textNode.parentNode?.replaceChild(frag, textNode)
            }
          })
        }
      }
    }
    return { markdown: spec }
  }
})

/**
 * Save-path backstop. Re-parses the serialized markdown body and confirms no
 * table lost rows versus the live doc. Returns true when safe to write. A
 * faithful serialize keeps row counts equal; a shatter (a row split across
 * lines) yields fewer `<tr>` on re-parse, so the caller can refuse the write
 * rather than persist corruption. Cheap: only runs when the doc has a table,
 * and counts `<tr>` in the parser's HTML output (no second ProseMirror parse).
 */
export function tableRowsSurviveSerialize(editor: Editor, body: string): boolean {
  let docRows = 0
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'tableRow') docRows += 1
  })
  if (docRows === 0) return true

  const storage = (editor.storage as {
    markdown?: { parser?: { parse: (content: string) => string } }
  }).markdown
  const parser = storage?.parser
  if (!parser) return true // can't check → don't block

  let html: string
  try {
    html = parser.parse(body)
  } catch {
    return true // parser threw → don't block the save on our own check
  }
  const parsedRows = (html.match(/<tr[\s>]/g) ?? []).length
  return parsedRows >= docRows
}
