import type { Meta, StoryObj } from '@storybook/react'
import { PageTab } from './PageTab'

// ENH-239 Phase 1 — heavy container smoke story. PageTab (Stage 17a) owns the
// full HTML-canvas lifecycle: load / save / dirty / autosave, the shared
// EditorToolbar, the RenderedPage iframe, the comment rail, sidecar I/O, and a
// deep web of duo-html / image / goto IPC. The mock has no file bytes for an
// arbitrary path, so this mounts into the toolbar + "Loading…" shell — a
// crash-free smoke render of the surface. A populated-canvas story needs a
// real file fixture + iframe handshake wired into the mock seam.
const meta = {
  title: 'Page/PageTab',
  component: PageTab,
  args: {
    path: '/Users/preview/canvases/page.html',
    onDirtyChange: () => {},
    onSendToDuo: () => {},
    isActive: true,
  },
  decorators: [
    (Story) => (
      <div style={{ width: 640, height: 420, display: 'flex' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PageTab>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
