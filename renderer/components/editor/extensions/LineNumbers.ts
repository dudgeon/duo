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
// top-level block begins by serializing the document (the SAME node /
// mark handlers `serializeWithCriticMarkup` uses on save, so the numbers
// track what lands on disk), then hangs that number off each block's
// DOM via a `data-duo-line` node decoration. globals.css renders it
// through `content: attr(data-duo-line)`.
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
// Counting is a SINGLE serialization pass: we drive one
// MarkdownSerializerState across the doc's top-level children and record
// the output length after each, then derive each block's start line from
// the actual byte offsets. No "blank line between blocks" assumption —
// the real separator (whatever the serializer emits) is measured — and
// internal blank lines (e.g. inside a code fence) are handled correctly
// because each block's span is read from the serializer, not by string
// splitting. The reconstructed output is asserted byte-identical to the
// public serializer in LineNumbers.test.ts.
//
// Perf: the serialize pass is O(doc) — ~50 ms for a 600-block doc, ~100
// ms for 1200 — too slow to run synchronously on every keystroke. So
// while enabled, a doc-changing tx only MAPS the existing decorations
// through the change (cheap, keeps them positioned with briefly-stale
// numbers) and marks the state dirty; a debounced view recomputes the
// real numbers ~200 ms after typing pauses. Toggling on rebuilds
// synchronously for immediate feedback (a one-time cost). The feature is
// opt-in (off by default), so disabled editors pay nothing.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { MarkdownSerializerState } from '@tiptap/pm/markdown'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/react'
import { materializeCriticMarkupToJSON } from '../markdownCriticMarkup'

// Shared with MarkdownEditor's toggle so the persisted preference and
// the plugin's initial state can't drift.
export const LINE_NUMBERS_STORAGE_KEY = 'duo:editor-line-numbers'

// How long after the last doc change to recompute the (stale-mapped)
// gutter numbers. Long enough to coalesce a burst of typing, short
// enough that the numbers feel live once you pause.
const RECOMPUTE_DEBOUNCE_MS = 200

export interface LineNumbersState {
  enabled: boolean
  decorations: DecorationSet
  // Set when decorations have been position-mapped but their line values
  // are stale and need a fresh serialize pass.
  dirty: boolean
}

export const lineNumbersPluginKey = new PluginKey<LineNumbersState>('duo-line-numbers')

// The bits of a (prosemirror) MarkdownSerializer we need to drive a state
// directly. tiptap-markdown's `editor.storage.markdown.serializer` is a
// MarkdownSerializer instance, which exposes these.
export interface MarkdownSerializerLike {
  nodes: Record<string, unknown>
  marks: Record<string, unknown>
  options?: Record<string, unknown>
}

function countNewlinesUpTo(s: string, end: number): number {
  let n = 0
  for (let i = 0; i < end; i++) if (s.charCodeAt(i) === 10) n++
  return n
}

/**
 * For each TOP-LEVEL child of `doc`, the 1-based markdown source line
 * where that block begins. Pure + serializer-injected so it's unit
 * testable without a live editor.
 *
 * Single pass: render every top-level child through one
 * MarkdownSerializerState, recording the output length after each. Each
 * block's content starts just past the leading separator newlines in its
 * slice of the output, so the start line is the newline count up to that
 * offset + 1. Verified byte-identical to `serializer.serialize(doc)` and
 * against the saved markdown in LineNumbers.test.ts.
 */
export function computeBlockSourceLines(doc: PMNode, serializer: MarkdownSerializerLike): number[] {
  // @tiptap/pm/markdown ships stale type decls for MarkdownSerializerState
  // (no 3-arg ctor, no public `out`), so reach the real prosemirror API
  // through a minimal cast. Runtime shape verified in LineNumbers.test.ts.
  const StateCtor = MarkdownSerializerState as unknown as new (
    nodes: unknown,
    marks: unknown,
    options: unknown
  ) => { out: string; render: (node: PMNode, parent: PMNode, index: number) => void }
  const state = new StateCtor(serializer.nodes, serializer.marks, serializer.options ?? {})
  const endLens: number[] = []
  doc.forEach((child, _offset, index) => {
    state.render(child, doc, index)
    endLens[index] = state.out.length
  })

  const out = state.out
  const lines: number[] = []
  let prevEnd = 0
  for (let i = 0; i < endLens.length; i++) {
    const slice = out.slice(prevEnd, endLens[i])
    const leadingNewlines = slice.length - slice.replace(/^\n+/, '').length
    lines[i] = countNewlinesUpTo(out, prevEnd + leadingNewlines) + 1
    prevEnd = endLens[i]
  }
  return lines
}

function buildDecorations(editor: Editor, liveDoc: PMNode): DecorationSet {
  const storage = (editor.storage as { markdown?: { serializer?: MarkdownSerializerLike } }).markdown
  const serializer = storage?.serializer
  if (!serializer?.nodes || !serializer?.marks) return DecorationSet.empty

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

  let lines: number[]
  try {
    lines = computeBlockSourceLines(countDoc, serializer)
  } catch {
    return DecorationSet.empty
  }

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

// Meta payloads on the plugin key:
//   { enabled }     — toggle from the React layer (sync rebuild / clear)
//   { recomputed }  — debounced fresh decorations from the view
interface LineNumbersMeta {
  enabled?: boolean
  recomputed?: DecorationSet
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
          init: () => ({ enabled: readInitialEnabled(), decorations: DecorationSet.empty, dirty: false }),
          apply(tr, value, _oldState, newState) {
            const meta = tr.getMeta(lineNumbersPluginKey) as LineNumbersMeta | undefined

            // Debounced recompute landing — swap in fresh numbers.
            if (meta?.recomputed) {
              return { ...value, decorations: meta.recomputed, dirty: false }
            }

            const metaToggled = typeof meta?.enabled === 'boolean'
            const nextEnabled = metaToggled ? (meta as { enabled: boolean }).enabled : value.enabled

            if (!nextEnabled) {
              return { enabled: false, decorations: DecorationSet.empty, dirty: false }
            }
            // Toggle ON → rebuild synchronously for immediate feedback.
            if (metaToggled && !value.enabled) {
              return { enabled: true, decorations: buildDecorations(editor, newState.doc), dirty: false }
            }
            // Doc changed → keep positions live by mapping the existing
            // decorations through the change, but flag the (now-stale)
            // numbers for a debounced recompute by the view below.
            if (tr.docChanged) {
              return {
                enabled: true,
                decorations: value.decorations.map(tr.mapping, tr.doc),
                dirty: true
              }
            }
            return { ...value, enabled: true }
          }
        },
        props: {
          decorations(state) {
            return lineNumbersPluginKey.getState(state)?.decorations ?? DecorationSet.empty
          }
        },
        view(view) {
          let timer: ReturnType<typeof setTimeout> | null = null
          const clear = () => { if (timer) { clearTimeout(timer); timer = null } }
          return {
            update(v) {
              const st = lineNumbersPluginKey.getState(v.state)
              if (!st?.enabled || !st.dirty) { return }
              clear()
              timer = setTimeout(() => {
                timer = null
                const cur = lineNumbersPluginKey.getState(v.state)
                if (!cur?.enabled || !cur.dirty) return
                const decorations = buildDecorations(editor, v.state.doc)
                v.dispatch(v.state.tr.setMeta(lineNumbersPluginKey, { recomputed: decorations }))
              }, RECOMPUTE_DEBOUNCE_MS)
            },
            destroy: clear
          }
        }
      })
    ]
  }
})
