import type { Meta, StoryObj } from '@storybook/react'
import { EditorToolbar } from './EditorToolbar'
import type { EditorActions } from './EditorActions'

// ENH-239 Phase 1 — the shared presentational editor toolbar. It takes an
// `EditorActions` interface (the host wires it from TipTap / the iframe), so
// stories supply a minimal all-no-op stub whose state queries return inert
// defaults. selectionVersion just forces re-render; any constant is fine.
const noopActions: EditorActions = {
  toggleBold: () => {},
  toggleItalic: () => {},
  toggleUnderline: () => {},
  toggleStrike: () => {},
  toggleCode: () => {},
  setBlock: () => {},
  toggleBulletList: () => {},
  toggleOrderedList: () => {},
  toggleTaskList: () => {},
  toggleBlockquote: () => {},
  toggleCodeBlock: () => {},
  insertHr: () => {},
  insertTable: () => {},
  setLink: () => {},
  currentLinkHref: () => undefined,
  undo: () => {},
  redo: () => {},
  canUndo: () => true,
  canRedo: () => false,
  isActive: () => false,
  currentBlock: () => 'p',
  inTable: () => false,
}

const meta = {
  title: 'Editor/EditorToolbar',
  component: EditorToolbar,
  args: {
    actions: noopActions,
    selectionVersion: 0,
    onSave: () => {},
    dirty: false,
    saving: false,
    saveError: null,
    autosaveOn: true,
    onToggleAutosave: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ width: 720, border: '1px solid var(--duo-paper-rule)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EditorToolbar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Dirty: Story = { args: { dirty: true } }

export const Saving: Story = { args: { dirty: true, saving: true } }

export const SaveFailed: Story = {
  args: { dirty: true, saveError: 'EACCES: permission denied' },
}

export const WithHistory: Story = { args: { onShowHistory: () => {} } }

// In-table state surfaces the contextual second toolbar row.
const tableActions: EditorActions = {
  ...noopActions,
  inTable: () => true,
  tableOps: {
    addRowBefore: () => {},
    addRowAfter: () => {},
    deleteRow: () => {},
    addColumnBefore: () => {},
    addColumnAfter: () => {},
    deleteColumn: () => {},
    toggleHeaderRow: () => {},
    deleteTable: () => {},
    canAddRowBefore: () => true,
    canAddRowAfter: () => true,
    canDeleteRow: () => true,
    canAddColumnBefore: () => true,
    canAddColumnAfter: () => true,
    canDeleteColumn: () => true,
    canToggleHeaderRow: () => true,
    canDeleteTable: () => true,
  },
}

export const InTable: Story = { args: { actions: tableActions } }

// Suggesting-mode toggle active (mirrors the markdown editor with track-changes on).
export const Suggesting: Story = {
  args: {
    actions: { ...noopActions, suggestingOn: true, toggleSuggesting: () => {} },
  },
}
