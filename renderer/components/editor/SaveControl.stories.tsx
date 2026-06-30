import type { Meta, StoryObj } from '@storybook/react'
import { SaveControl } from './SaveControl'

// ENH-239 Phase 1 — the paired save-status / save-action / autosave pill. Four
// mutually-exclusive states derive from { dirty, saving, saveError }; one story
// per state. Rendered on a dark titlebar-ish swatch since it lives in the
// toolbar's zinc-300 chrome.
const meta = {
  title: 'Editor/SaveControl',
  component: SaveControl,
  args: {
    dirty: false,
    saving: false,
    saveError: null,
    autosaveOn: true,
    onToggleAutosave: () => {},
    onSave: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ padding: 24, background: 'var(--duo-surface-1)', display: 'inline-block' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SaveControl>

export default meta
type Story = StoryObj<typeof meta>

export const Saved: Story = {}

export const Unsaved: Story = { args: { dirty: true } }

export const Saving: Story = { args: { dirty: true, saving: true } }

export const Failed: Story = {
  args: { dirty: true, saveError: 'EACCES: permission denied' },
}

export const AutosaveOff: Story = { args: { autosaveOn: false } }
