import type { Meta, StoryObj } from '@storybook/react'
import { JsonView } from './JsonView'

// ENH-239 Phase 1 — heavy editor smoke story. JsonView (ENH-110) mounts a
// CodeMirror source editor + @uiw/react-json-view tree and drives load /
// save / autosave / disk-reconciliation through window.electron.files. The
// mock has no file bytes for an arbitrary path, so this mounts into the
// "Loading…" state — a crash-free smoke render of the surface. A populated
// tree/source story needs a real file fixture wired into the mock seam.
const meta = {
  title: 'Page/JsonView',
  component: JsonView,
  args: {
    path: '/Users/preview/config/settings.json',
    onDirtyChange: () => {},
    isActive: true,
  },
  decorators: [
    (Story) => (
      <div style={{ width: 560, height: 360, display: 'flex' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof JsonView>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
