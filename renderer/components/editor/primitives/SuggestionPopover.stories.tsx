import type { Meta, StoryObj } from '@storybook/react'
import { SuggestionPopover, type SuggestionItem } from './SuggestionPopover'

// ENH-239 Phase 1 — the shared wikilink / @-mention suggestion popover. It
// portals to document.body and anchors at a caret rect supplied via the
// `clientRect` thunk. The list carries three row shapes: VaultFile rows,
// SmartToken rows (📅), and the CreateNoteItem "New: …" action row.

const caretRect = () =>
  ({ top: 80, bottom: 100, left: 60, right: 60, width: 0, height: 20, x: 60, y: 80, toJSON: () => ({}) }) as DOMRect

const fileItems: SuggestionItem[] = [
  { absPath: '/vault/notes/Roadmap.md', relPath: 'notes/Roadmap.md', basename: 'Roadmap', ext: 'md' },
  { absPath: '/vault/notes/Backlog.md', relPath: 'notes/Backlog.md', basename: 'Backlog', ext: 'md' },
  { absPath: '/vault/Inbox.md', relPath: 'Inbox.md', basename: 'Inbox', ext: 'md' },
]

const smartTokenItem: SuggestionItem = {
  id: 'date:today:iso',
  keyword: 'today',
  label: 'today',
  detail: '2026-06-29',
  insertText: '2026-06-29',
}

const createNoteItem: SuggestionItem = { kind: 'create-note', query: 'New Spec' }

const meta = {
  title: 'Editor/Primitives/SuggestionPopover',
  component: SuggestionPopover,
  args: {
    items: fileItems,
    command: () => {},
    clientRect: caretRect,
    loading: false,
    visible: true,
  },
} satisfies Meta<typeof SuggestionPopover>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Mixed: Story = {
  args: { items: [...fileItems, smartTokenItem, createNoteItem] },
}

export const Loading: Story = { args: { items: [], loading: true } }

export const Empty: Story = { args: { items: [], loading: false } }

export const Hidden: Story = { args: { visible: false } }
