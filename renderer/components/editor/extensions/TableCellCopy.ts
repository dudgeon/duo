// BUG-108 (Sprint 12) — copying selected text from inside a markdown
// table cell yielded the literal string "[table]" instead of the cell
// text.
//
// Root cause: tiptap-markdown's `transformCopiedText` plugin runs
// `MarkdownSerializer.serialize(slice.content)` on whatever ProseMirror's
// `selection.content()` returns. ProseMirror builds that slice with
// `includeParents=true` — so a text selection inside one cell still
// arrives wrapped in `<table><tr><td>…</td></tr></table>` (with
// openStart/openEnd marking the open cuts). tiptap-markdown's table
// serializer then runs `isMarkdownSerializable` which rejects any
// first-row whose cells aren't all `tableHeader` (a body-cell-only
// slice always fails this), and the fallback path writes
// `console.warn(... "node is only available in html mode") + state.write("[" + node.type.name + "]")`
// — i.e. the literal `[table]` because Duo runs tiptap-markdown with
// `html: false` for round-trip fidelity reasons.
//
// Fix: install a higher-priority `clipboardTextSerializer` that detects
// "the slice begins with a table node" (the cue that the user selected
// inside a table) and returns the slice's plain-text content.
// Whole-table copies — where the user selects across the table boundary
// — fall through to tiptap-markdown's serializer (`return null`), which
// renders them as a proper markdown table because the slice in that
// case includes the header row and `isMarkdownSerializable` passes.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Slice } from '@tiptap/pm/model'

const TABLE_NODE_NAME = 'table'

function sliceStartsWithTable(slice: Slice): boolean {
  const first = slice.content.firstChild
  return first?.type.name === TABLE_NODE_NAME
}

function sliceTextContent(slice: Slice): string {
  // textBetween with both block + inline separators preserves cell-row
  // structure as tab-and-newline (matches what every spreadsheet/word
  // processor writes to the clipboard for a table-cell copy). For
  // single-cell selections, inline content has no newlines so the
  // result is just the selected text.
  return slice.content.textBetween(0, slice.content.size, '\n', '\t')
}

export const TableCellCopy = Extension.create({
  name: 'tableCellCopy',

  // Higher priority than tiptap-markdown's `markdownClipboard` plugin
  // (the Markdown extension declares `priority: 50`). ProseMirror's
  // `someProp` walks plugins in order and returns the first non-null
  // result for each clipboard hook — by priority-ordering above
  // tiptap-markdown, our return value wins for table-cell slices and
  // we explicitly return null otherwise to defer.
  priority: 1000,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('tableCellCopy'),
        props: {
          // The TS surface for `clipboardTextSerializer` requires
          // returning string, but ProseMirror at runtime accepts null
          // to mean "fall through to the next plugin / default
          // serialization" (which tiptap-markdown's lower-priority
          // plugin then handles). Mirrors the runtime-contract cast
          // pattern used by MarkdownPaste for clipboardTextParser.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          clipboardTextSerializer: ((slice: Slice) => {
            return sliceStartsWithTable(slice) ? sliceTextContent(slice) : null
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }) as any
        }
      })
    ]
  }
})
