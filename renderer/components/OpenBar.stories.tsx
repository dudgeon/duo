import type { Meta, StoryObj } from '@storybook/react'
import { OpenBar } from './OpenBar'
import type { VaultFile } from './editor/wikilinkResolver'

// ENH-239 Phase 1 — the ⌘O Open overlay ({ open, files, loading, vaultRoot,
// onOpenTarget, … }). A full-screen progressive overlay; the empty state shows
// the recents/hint body. Recents come from window.electron.recents (the global
// mock decorator), so the empty story renders the hint fallback.
const VAULT_FILES: VaultFile[] = [
  { absPath: '/Users/geoff/vault/notes/inbox.md', relPath: 'notes/inbox.md', basename: 'inbox', ext: 'md' },
  { absPath: '/Users/geoff/vault/notes/roadmap.md', relPath: 'notes/roadmap.md', basename: 'roadmap', ext: 'md' },
]

const meta = {
  title: 'Chrome/OpenBar',
  component: OpenBar,
  args: {
    open: true,
    files: VAULT_FILES,
    loading: false,
    vaultRoot: '/Users/geoff/vault',
    onOpenTarget: () => {},
    onDismiss: () => {},
  },
} satisfies Meta<typeof OpenBar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Loading: Story = { args: { loading: true, files: [] } }

export const NoVault: Story = { args: { vaultRoot: null } }

export const Closed: Story = { args: { open: false } }
