// @vitest-environment jsdom
//
// BUG-210 — multi-line table-cell markdown round-trip.
//
// The user-facing guarantee: a GFM table whose cells hold multiple lines (a
// bullet list of people, stacked paragraphs, hard breaks) survives a save
// without shattering — the row stays on one physical line using `<br>`, and
// the round-trip is byte-faithful + idempotent. We build the editor through
// the same extension stack MarkdownEditor mounts and assert the serialized
// markdown for the canonical cases.

import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { Markdown } from 'tiptap-markdown'
import { BulletListWithMarker } from './BulletListWithMarker'
import {
  TableWithMarkdownCells,
  HardBreakWithMarkdown,
  TableCellBrParse,
  tableRowsSurviveSerialize
} from './TableMarkdownRoundtrip'

function makeEditor(content: unknown): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({ codeBlock: false, bulletList: false, hardBreak: false }),
      HardBreakWithMarkdown,
      BulletListWithMarker,
      TableWithMarkdownCells.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TableCellBrParse,
      Markdown.configure({
        html: false,
        tightLists: true,
        bulletListMarker: '-',
        linkify: true,
        breaks: false
      })
    ],
    content: content as never
  })
}

function serialize(content: unknown): string {
  const editor = makeEditor(content)
  const md = (editor.storage as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()
  editor.destroy()
  return md.trimEnd()
}

// Build a table whose POC cell holds a real bullet list (the shape the broken
// `lobs.md` carried in the editor doc).
function cellList(names: string[]) {
  return {
    type: 'tableCell',
    content: [
      {
        type: 'bulletList',
        content: names.map((n) => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: n }] }]
        }))
      }
    ]
  }
}
function cellText(text: string) {
  return { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}
function header(text: string) {
  return { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

const MULTI_LINE_DOC = {
  type: 'doc',
  content: [
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [header('Line of Business'), header('POC')] },
        { type: 'tableRow', content: [cellText('Card'), cellList(['Shaun Dunning'])] },
        {
          type: 'tableRow',
          content: [cellText('Global Payments Network'), cellList(['Ashwin Katikapalli', 'Navmeet Venkatesh'])]
        },
        {
          type: 'tableRow',
          content: [cellText('Business Cards and Payments'), cellList(['Aram Ter-Minassian', 'Hassan Chagani'])]
        }
      ]
    }
  ]
}

describe('BUG-210 multi-line table-cell round-trip', () => {
  it('serializes a bullet-list cell to a single GFM line with <br>', () => {
    const md = serialize(MULTI_LINE_DOC)
    expect(md).toBe(
      [
        '| Line of Business | POC |',
        '| --- | --- |',
        '| Card | - Shaun Dunning |',
        '| Global Payments Network | - Ashwin Katikapalli<br>- Navmeet Venkatesh |',
        '| Business Cards and Payments | - Aram Ter-Minassian<br>- Hassan Chagani |'
      ].join('\n')
    )
  })

  it('does NOT shatter the table — the doc stays a single table node', () => {
    const md = serialize(MULTI_LINE_DOC)
    const blocks = makeEditor(md).getJSON().content?.map((n) => n.type)
    expect(blocks).toEqual(['table'])
  })

  it('round-trips multi-line cells byte-faithfully and idempotently', () => {
    const onDisk = [
      '| Line of Business | POC | Resources |',
      '| --- | --- | --- |',
      '| Card | Shaun Dunning | — |',
      '| Global Payments Network | - Ashwin Katikapalli<br>- Navmeet Venkatesh | — |',
      '| Business Cards and Payments | - Aram Ter-Minassian<br>- Hassan Chagani | — |'
    ].join('\n')
    const once = serialize(onDisk)
    const twice = serialize(once)
    expect(once).toBe(onDisk) // byte-faithful — author's source preserved
    expect(twice).toBe(once) // idempotent — no churn on re-save
  })

  it('re-parses a <br> cell into a multi-line paragraph (real hard breaks)', () => {
    const onDisk = '| A | B |\n| --- | --- |\n| x | one<br>two |'
    const cell = (makeEditor(onDisk).getJSON().content?.[0].content?.[1].content?.[1].content ?? []) as Array<{
      type: string
    }>
    // paragraph → [ text, hardBreak, text ]
    const para = cell[0] as { type: string; content?: Array<{ type: string }> }
    expect(para.type).toBe('paragraph')
    expect(para.content?.map((c) => c.type)).toEqual(['text', 'hardBreak', 'text'])
  })

  it('leaves <br> in ordinary prose untouched (scoped to cells)', () => {
    const prose = makeEditor('a line<br>another line').getJSON()
    const para = prose.content?.[0] as { type: string; content?: Array<{ type: string; text?: string }> }
    expect(para.type).toBe('paragraph')
    // The literal <br> stays as text — no hard break injected outside a table.
    expect(para.content?.some((c) => c.type === 'hardBreak')).toBe(false)
    expect(para.content?.[0].text).toContain('<br>')
  })

  it('preserves inline marks and escapes pipes inside multi-line cells', () => {
    const src = '| A | B |\n| --- | --- |\n| x | **Bold** name<br>a \\| b |'
    expect(serialize(src)).toBe(src)
  })

  it('collapses a multi-paragraph cell to <br> without shattering', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [header('H')] },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
                    { type: 'paragraph', content: [{ type: 'text', text: 'two' }] }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
    const md = serialize(doc)
    expect(md).toBe(['| H |', '| --- |', '| one<br>two |'].join('\n'))
    expect(makeEditor(md).getJSON().content?.map((n) => n.type)).toEqual(['table'])
  })
})

describe('BUG-210 tableRowsSurviveSerialize guard', () => {
  it('passes a faithful serialize (row counts equal)', () => {
    const onDisk = '| LOB | POC |\n| --- | --- |\n| GPN | - A<br>- B |\n| BCP | - C<br>- D |'
    const editor = makeEditor(onDisk)
    const body = (editor.storage as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()
    expect(tableRowsSurviveSerialize(editor, body)).toBe(true)
  })

  it('refuses a shattered body (a row was split across lines)', () => {
    const onDisk = '| LOB | POC |\n| --- | --- |\n| GPN | - A<br>- B |\n| BCP | - C<br>- D |'
    const editor = makeEditor(onDisk)
    // Simulate what the stock serializer would have written: the GPN row
    // broken across blank lines so the table loses a row on re-parse.
    const shattered = ['| LOB | POC |', '| --- | --- |', '| GPN | A', '', 'B', '', '  |', '| BCP | C |'].join('\n')
    expect(tableRowsSurviveSerialize(editor, shattered)).toBe(false)
  })

  it('is a no-op (returns true) for docs without a table', () => {
    const editor = makeEditor('# Heading\n\nJust prose, no table.')
    expect(tableRowsSurviveSerialize(editor, 'anything')).toBe(true)
  })
})
