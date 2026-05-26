// BUG-186 — true source-line numbers in the markdown editor gutter.
//
// v1 (ENH-069) numbered top-level BLOCKS with a pure CSS counter
// (1, 2, 3…), so the gutter never matched the markdown source's line
// numbers — blank separator lines, multi-line code fences, and
// multi-paragraph blockquotes all desynced "editor line N" from
// "file line N". The owner's ask: when Claude Code says "I updated
// line 65", the gutter's "65" should point at the same content.
//
// This plugin computes the real markdown source-line number where each
// top-level block begins by serializing the document (the SAME path
// `serializeWithCriticMarkup` uses on save, so the numbers track what
// lands on disk), then hangs that number off each block's DOM via a
// `data-duo-line` node decoration. globals.css renders it through
// `content: attr(data-duo-line)`.
//
// Numbers are intentionally SPARSE: blank separator lines and
// soft-wrapped continuation lines have no visual row, so the gutter
// shows the true source line where each block *begins* (e.g. 1, 3, 5,
// 9). That is the "match what Claude Code calls line N" semantic.
//
// Granularity is the TOP-LEVEL block (paragraph / heading / list /
// quote / code fence / table). Per-line numbering INSIDE a fenced code
// block, and per-item numbering inside lists / blockquotes, are
// deliberate v2 follow-ups (BUG-186 §v2) — a code block shows the
// source line of its opening fence only.
//
// Perf: recomputes on every doc-changing transaction WHILE ENABLED
// only (opt-in, off by default). One serialize pass over the doc per
// change — fine for typical notes; incremental / debounced recompute is
// a deferred optimization (mirrors WikilinkDecorations' documented
// stance).

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/react'
import { materializeCriticMarkupToJSON } from '../markdownCriticMarkup'

// Shared with MarkdownEditor's toggle so the persisted preference and
// the plugin's initial state can't drift.
export const LINE_NUMBERS_STORAGE_KEY = 'duo:editor-line-numbers'

export interface LineNumbersState {
  enabled: boolean
  decorations: DecorationSet
}

export const lineNumbersPluginKey = new PluginKey<LineNumbersState>('duo-line-numbers')

/**
 * For each TOP-LEVEL child of `doc`, the 1-based markdown source line
 * where that block begins. Pure + serializer-injected so it's unit
 * testable without a live editor.
 *
 * Method: serialize each block in isolation to learn its line span,
 * then accumulate, adding ONE blank separator line between consecutive
 * blocks (tiptap-markdown joins top-level blocks with `\n\n`). Verified
 * end-to-end against full-document serialization in LineNumbers.test.ts.
 */
export function computeBlockSourceLines(
  doc: PMNode,
  schema: Schema,
  serialize: (docNode: PMNode) => string
): number[] {
  const lines: number[] = []
  let cur = 1
  doc.forEach((child, _offset, index) => {
    lines[index] = cur
    let md = ''
    try {
      md = serialize(schema.topNodeType.create(null, child))
    } catch {
      // A node type the serializer can't render alone — treat as a
      // single line so subsequent blocks stay close to correct.
      md = ''
    }
    const blockLines = md.length === 0 ? 1 : md.split('\n').length
    cur += blockLines + 1 // + one blank separator line before the next block
  })
  return lines
}

function buildDecorations(editor: Editor, liveDoc: PMNode): DecorationSet {
  const storage = (editor.storage as { markdown?: { serializer?: { serialize: (doc: PMNode) => string } } }).markdown
  const serializer = storage?.serializer
  if (!serializer) return DecorationSet.empty

  // Compute line numbers off the SAME doc that gets saved: CriticMarkup
  // marks materialized to inline text (no new lines), so the line span
  // matches disk. tempDoc keeps the live doc's top-level block count +
  // order, so per-index mapping back onto liveDoc is safe.
  let countDoc = liveDoc
  try {
    const materialized = materializeCriticMarkupToJSON(editor)
    countDoc = editor.schema.nodeFromJSON(materialized)
  } catch {
    countDoc = liveDoc
  }

  const lines = computeBlockSourceLines(countDoc, editor.schema, (d) => serializer.serialize(d))

  const decorations: Decoration[] = []
  liveDoc.forEach((node, offset, index) => {
    const line = lines[index]
    if (line == null) return
    decorations.push(
      Decoration.node(offset, offset + node.nodeSize, { 'data-duo-line': String(line) })
    )
  })
  return DecorationSet.create(liveDoc, decorations)
}

function readInitialEnabled(): boolean {
  try {
    return localStorage.getItem(LINE_NUMBERS_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export const LineNumbers = Extension.create({
  name: 'duo-line-numbers',

  addProseMirrorPlugins() {
    const editor = this.editor as unknown as Editor
    return [
      new Plugin<LineNumbersState>({
        key: lineNumbersPluginKey,
        state: {
          // Build lazily: at plugin-init the editor view / markdown
          // storage may not be wired yet, and the initial content lands
          // via a later setContent (a doc-changing tx) which triggers a
          // rebuild. The mount effect in MarkdownEditor also dispatches
          // the current enabled state as meta. Either path populates.
          init: () => ({ enabled: readInitialEnabled(), decorations: DecorationSet.empty }),
          apply(tr, value, _oldState, newState) {
            const meta = tr.getMeta(lineNumbersPluginKey) as { enabled?: boolean } | undefined
            const metaToggled = typeof meta?.enabled === 'boolean'
            const nextEnabled = metaToggled ? (meta as { enabled: boolean }).enabled : value.enabled

            if (!nextEnabled) {
              return { enabled: false, decorations: DecorationSet.empty }
            }
            const turnedOn = !value.enabled && nextEnabled
            if (turnedOn || metaToggled || tr.docChanged) {
              return { enabled: true, decorations: buildDecorations(editor, newState.doc) }
            }
            // Enabled, no doc change → positions unchanged, keep as-is.
            return { enabled: true, decorations: value.decorations }
          }
        },
        props: {
          decorations(state) {
            return lineNumbersPluginKey.getState(state)?.decorations ?? DecorationSet.empty
          }
        }
      })
    ]
  }
})
