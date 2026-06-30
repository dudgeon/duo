import type { Meta, StoryObj } from '@storybook/react'
import { VaultSearchPalette } from './VaultSearchPalette'

// ENH-239 Phase 1 — ⌘⇧F full-text vault search overlay (ENH-208 D22). A
// modal palette over the resolved vault. The Open story shows the initial
// hint state (no query → "Type to search…", no IPC round-trip). Typing
// would call window.electron.vault.search, which the mock stubs.
const meta = {
  title: 'Page/VaultSearchPalette',
  component: VaultSearchPalette,
  args: {
    open: true,
    activePath: '/Users/preview/vault/note.md',
    onPick: () => {},
    onDismiss: () => {},
  },
} satisfies Meta<typeof VaultSearchPalette>

export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {}

// Closed → renders nothing (early return on !open).
export const Closed: Story = { args: { open: false } }
