import type { Meta, StoryObj } from '@storybook/react'
import type { GreetingData } from '@shared/types'
import { GreetingLine } from './GreetingLine'

// ENH-239 Phase 1 — the serif greeting line ({ greeting, onClickFreshest? }).
// Covers the named-user/clickable-thread path plus the two degrade paths
// (no firstName, all-quiet with no freshest thread).
const greeting: GreetingData = {
  firstName: 'Geoff',
  openCount: 2,
  freshest: { title: 'Storybook harness for the renderer', ageMs: 5 * 60_000 },
}

const meta = {
  title: 'Home/GreetingLine',
  component: GreetingLine,
  args: { greeting, onClickFreshest: () => {} },
} satisfies Meta<typeof GreetingLine>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const StaticThread: Story = {
  args: { greeting, onClickFreshest: undefined },
}

export const NoFirstName: Story = {
  args: {
    greeting: {
      openCount: 1,
      freshest: { title: 'Catch-up board polish', ageMs: 30 * 60_000 },
    },
  },
}

export const AllQuiet: Story = {
  args: {
    greeting: { firstName: 'Geoff', openCount: 0 },
    onClickFreshest: undefined,
  },
}
