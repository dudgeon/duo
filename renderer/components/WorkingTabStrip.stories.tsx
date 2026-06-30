import type { Meta, StoryObj } from '@storybook/react'
import type { WorkingTab } from '@shared/types'
import { WorkingTabStrip } from './WorkingTabStrip'

// ENH-239 Phase 1 — the unified WorkingPane tab strip. Pure presentational:
// it renders mixed-type tab chips (browser / editor / page / image / …) plus
// the new-tab split-button cluster. Context menus + confirm dialogs only fire
// on interaction (covered by the mock electron decorator). Tabs are real
// `WorkingTab` fixtures so each chip's TypeIcon + active/dirty/pinned state
// renders authentically.
const tab = (over: Partial<WorkingTab> & Pick<WorkingTab, 'id' | 'type' | 'title'>): WorkingTab => ({
  isActive: false,
  ...over,
})

const mixedTabs: WorkingTab[] = [
  tab({ id: 'f:home', type: 'home', title: 'Home' }),
  tab({ id: 'f:1', type: 'editor', title: 'notes.md', path: '/tmp/notes.md', isActive: true }),
  tab({ id: 'f:2', type: 'page', title: 'dashboard.html', path: '/tmp/dashboard.html', dirty: true }),
  tab({ id: 'f:3', type: 'image', title: 'logo.png', path: '/tmp/logo.png' }),
  tab({ id: 'b:1', type: 'browser', title: 'Anthropic', url: 'https://www.anthropic.com' }),
]

const meta = {
  title: 'Panes/WorkingTabStrip',
  component: WorkingTabStrip,
  args: {
    tabs: mixedTabs,
    onSelect: () => {},
    onNewFile: () => {},
    onNewBrowserTab: () => {},
    onClose: () => {},
    onTogglePin: () => {},
    onRevealInNavigator: () => {},
    onTrashFile: () => {},
    onStartRenameFromTab: () => {},
    onReorderTab: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ width: 720, background: 'var(--duo-paper)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WorkingTabStrip>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Focused: Story = { args: { focused: true } }

export const SingleTab: Story = {
  args: {
    tabs: [tab({ id: 'f:1', type: 'editor', title: 'README.md', path: '/tmp/README.md', isActive: true })],
  },
}

export const WithPinnedAndDirty: Story = {
  args: {
    tabs: [
      tab({ id: 'f:home', type: 'home', title: 'Home' }),
      tab({ id: 'f:1', type: 'editor', title: 'spec.md', path: '/tmp/spec.md', pinned: true }),
      tab({ id: 'f:2', type: 'json', title: 'config.json', path: '/tmp/config.json', dirty: true, isActive: true }),
      tab({ id: 'f:3', type: 'pdf', title: 'report.pdf', path: '/tmp/report.pdf' }),
    ],
  },
}

export const CanvasCollapsed: Story = {
  args: {
    isCanvasCollapsed: true,
    onToggleCanvasCollapsed: () => {},
  },
}
