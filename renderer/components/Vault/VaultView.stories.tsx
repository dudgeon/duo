import type { Meta, StoryObj } from '@storybook/react'
import { VaultView } from './VaultView'

// ENH-239 Phase 1 — heavy container smoke story. VaultView (ENH-228) is a
// top-level surface that talks to main directly (vault.getDefault / capture /
// useVaultSnapshot). The mock electron returns no default vault, so this
// mounts into the friendly "No default vault is set" empty state — a clean,
// crash-free smoke render of the surface outside its live IPC context.
const meta = {
  title: 'Page/VaultView',
  component: VaultView,
  args: { isActive: true },
} satisfies Meta<typeof VaultView>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
