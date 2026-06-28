import type { Meta, StoryObj } from '@storybook/react'
import { ThemeToggle } from './ThemeToggle'

// ENH-239 Phase 1 — first exemplar story. ThemeToggle is a pure presentational
// titlebar control ({ mode, onCycle }); rendered on a dark titlebar swatch
// because its zinc-300 text is tuned for the dark top chrome.
const meta = {
  title: 'Chrome/ThemeToggle',
  component: ThemeToggle,
  args: { onCycle: () => {} },
  decorators: [
    (Story) => (
      <div style={{ padding: 24, background: '#1a1611', display: 'inline-block' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ThemeToggle>

export default meta
type Story = StoryObj<typeof meta>

export const Light: Story = { args: { mode: 'light' } }
export const Dark: Story = { args: { mode: 'dark' } }
export const System: Story = { args: { mode: 'system' } }
