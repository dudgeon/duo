import type { Meta, StoryObj } from '@storybook/react'
import { ViewSourcePanel } from './ViewSourcePanel'

// ENH-239 Phase 1 — read-only "view source" panel-fill ({ source, title,
// onClose }). It fills its parent (flex-1, h-full), so it's wrapped in a sized
// paper-toned slot mirroring the WorkingPane space it normally occupies.
const meta = {
  title: 'Status/ViewSourcePanel',
  component: ViewSourcePanel,
  args: {
    source: '# Hello\n\nA little markdown body to display as raw source.\n\n- one\n- two\n',
    title: 'notes.md',
    onClose: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ height: 360, width: 520, display: 'flex', background: 'var(--duo-paper)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ViewSourcePanel>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Empty: Story = {
  args: { source: '', title: 'untitled.md' },
}

export const LongSource: Story = {
  args: {
    title: 'app.tsx',
    source: Array.from({ length: 40 }, (_, i) => `const line${i} = ${i} // wraps + scrolls`).join('\n'),
  },
}
