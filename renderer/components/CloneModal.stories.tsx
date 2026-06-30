import type { Meta, StoryObj } from '@storybook/react'
import { CloneModal } from './CloneModal'

// ENH-239 Phase 1 — Clone-from-GitHub modal. A DOM-overlay modal (full-viewport
// fixed backdrop); the global decorator's mock window.electron stubs the
// git.{clone,ghAuth} + files.* IPC the modal probes on open, so it mounts
// without a live main process. Callbacks are no-ops. Listed heavy, but it's a
// plain React overlay — this is a full render, not a smoke story.
const meta = {
  title: 'Modals/CloneModal',
  component: CloneModal,
  args: {
    open: true,
    onClose: () => {},
    onCloned: () => {},
  },
} satisfies Meta<typeof CloneModal>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const PrefilledUrl: Story = {
  args: { defaultUrl: 'https://github.com/dudgeon/duo' },
}

export const FromGitHubFileUrl: Story = {
  args: {
    defaultUrl: 'https://github.com/dudgeon/duo',
    defaultParent: '~/Documents',
    openAfterRelPath: 'docs/VISION.md',
    onOpenAfter: () => {},
  },
}

export const Closed: Story = {
  args: { open: false },
}
