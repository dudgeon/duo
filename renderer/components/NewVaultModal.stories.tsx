import type { Meta, StoryObj } from '@storybook/react'
import { NewVaultModal } from './NewVaultModal'

// ENH-239 Phase 1 — New Vault modal (OKF vs Obsidian format picker). A
// DOM-overlay modal; the global decorator's mock window.electron stubs the
// vault.{create,pickDir} IPC, so it mounts standalone. Listed heavy, but it's
// a plain React overlay — this is a full render, not a smoke story.
const meta = {
  title: 'Modals/NewVaultModal',
  component: NewVaultModal,
  args: {
    open: true,
    onClose: () => {},
    onCreated: () => {},
  },
} satisfies Meta<typeof NewVaultModal>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Closed: Story = {
  args: { open: false },
}
