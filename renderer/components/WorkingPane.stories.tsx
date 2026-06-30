import type { Meta, StoryObj } from '@storybook/react'
import { WorkingPane } from './WorkingPane'

// ENH-239 Phase 1 — the polymorphic WorkingPane shell. Heavy orchestrator: it
// merges renderer file tabs with main-process browser tabs (via useBrowserState
// over IPC) and mounts the active surface (editor / canvas / browser / …) below
// the tab strip. The smoke story mounts with no file tabs and the browser as
// the active surface, so it renders the WorkingTabStrip + BrowserRenderer chrome
// without needing a live editor/canvas/PTY. The mock electron decorator absorbs
// the browser.* + useBrowserState IPC on mount.
const meta = {
  title: 'Panes/WorkingPane',
  component: WorkingPane,
  args: {
    fileTabs: [],
    activeWorking: { kind: 'browser' },
    setActiveWorking: () => {},
    closeFileTab: () => {},
    onOpenMarkdown: () => {},
    onTabDirtyChange: () => {},
    onCommitNewFile: async () => {},
    onNewFile: () => {},
    pins: [],
    onTogglePin: async () => {},
    onSendToDuo: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ width: 760, height: 480, background: 'var(--duo-surface-0)', display: 'flex' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WorkingPane>

export default meta
type Story = StoryObj<typeof meta>

// Empty smoke: strip + browser surface, no file tabs mounted.
export const BrowserSurface: Story = {}
