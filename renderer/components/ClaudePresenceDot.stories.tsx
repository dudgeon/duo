import type { Meta, StoryObj } from '@storybook/react'
import { ClaudePresenceDot } from './ClaudePresenceDot'

// ENH-239 Phase 1 — whisper-level agent-presence dot ({ active }). Rendered on
// a dark titlebar swatch like ThemeToggle, since the dot lives in the top
// chrome; the accent color reads against the dark band.
const meta = {
  title: 'Status/ClaudePresenceDot',
  component: ClaudePresenceDot,
  decorators: [
    (Story) => (
      <div style={{ padding: 24, background: '#1a1611', display: 'inline-block' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ClaudePresenceDot>

export default meta
type Story = StoryObj<typeof meta>

export const Active: Story = { args: { active: true } }
export const Idle: Story = { args: { active: false } }
