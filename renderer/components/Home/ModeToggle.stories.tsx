import type { Meta, StoryObj } from '@storybook/react'
import { ModeToggle } from './ModeToggle'

// ENH-239 Phase 1 — the Home mode segmented control ({ mode, onChange }). One
// story per HomeMode value (the discriminant).
const meta = {
  title: 'Home/ModeToggle',
  component: ModeToggle,
  args: { onChange: () => {} },
} satisfies Meta<typeof ModeToggle>

export default meta
type Story = StoryObj<typeof meta>

export const Projects: Story = { args: { mode: 'projects' } }
export const Catchup: Story = { args: { mode: 'catchup' } }
