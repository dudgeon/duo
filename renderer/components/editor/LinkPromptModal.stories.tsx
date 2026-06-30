import { useEffect } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { LinkPromptModal, requestLinkPrompt } from './LinkPromptModal'

// ENH-239 Phase 1 — the window.prompt replacement for the link button / ⌘K.
// The modal renders nothing until a `duo-link-prompt-request` event fires
// (via requestLinkPrompt), so stories open it from an effect on mount.
const meta = {
  title: 'Editor/LinkPromptModal',
  component: LinkPromptModal,
} satisfies Meta<typeof LinkPromptModal>

export default meta
type Story = StoryObj<typeof meta>

// Dormant: nothing is rendered until a prompt is requested.
export const Dormant: Story = {}

// Open with a seeded href so the input + "Remove link" affordance both show.
export const Open: Story = {
  render: () => {
    useEffect(() => {
      void requestLinkPrompt('https://example.com')
    }, [])
    return <LinkPromptModal />
  },
}

// Open with an empty href — no "Remove link" button (nothing to remove yet).
export const Empty: Story = {
  render: () => {
    useEffect(() => {
      void requestLinkPrompt('')
    }, [])
    return <LinkPromptModal />
  },
}
