import type { Meta, StoryObj } from '@storybook/react'
import { MarkdownPreview } from './MarkdownPreview'

// ENH-239 Phase 1 — read-only markdown preview ({ path, onOpenMarkdown }). It
// reads the file via window.electron.files.read(path); the mock bridge returns
// no bytes, so the preview surfaces its ErrorCard "Couldn't load preview" path
// in isolation. This is a mount smoke story — it must mount + render a stable
// state without throwing. Wrapped in a sized slot mirroring its WorkingPane tab.
const meta = {
  title: 'Status/MarkdownPreview',
  component: MarkdownPreview,
  args: {
    path: '/tmp/duo-preview/notes.md',
    onOpenMarkdown: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ height: 360, width: 640, display: 'flex', background: 'var(--duo-surface-0)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MarkdownPreview>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
