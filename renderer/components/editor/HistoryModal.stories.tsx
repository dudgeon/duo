import type { Meta, StoryObj } from '@storybook/react'
import { HistoryModal } from './HistoryModal'

// ENH-239 Phase 1 — file version-history modal (ENH-221). HEAVY: it constructs
// a read-only TipTap editor internally and reaches window.electron.history.*
// for the timeline + preview. The mock bridge auto-stubs history.list (resolves
// undefined), which the modal handles gracefully into its empty/loading state —
// so this is a smoke story that mounts the open modal without a live backend.
const meta = {
  title: 'Editor/HistoryModal',
  component: HistoryModal,
  args: {
    open: true,
    path: '/Users/preview/notes/overview.md',
    onClose: () => {},
    onRestored: () => {},
  },
} satisfies Meta<typeof HistoryModal>

export default meta
type Story = StoryObj<typeof meta>

// Smoke: the open modal chrome (header, timeline pane, preview pane, footer).
export const Open: Story = {}

// open=false → the modal renders nothing.
export const Closed: Story = { args: { open: false } }
