import type { Meta, StoryObj } from '@storybook/react'
import { SendToDuoPill } from './SendToDuoPill'

// ENH-239 Phase 1 — floating "Send → agent" pill. Portals to document.body and
// positions itself relative to a selection rect; the fixture rect places it in
// view. `rect: null` hides it (renders nothing).

const meta = {
  title: 'Editor/Primitives/SendToDuoPill',
  component: SendToDuoPill,
  args: {
    rect: { top: 120, bottom: 140, right: 320 },
    onClick: () => {},
  },
} satisfies Meta<typeof SendToDuoPill>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const CustomLabel: Story = { args: { label: 'Send → Claude' } }

export const Hidden: Story = { args: { rect: null } }
