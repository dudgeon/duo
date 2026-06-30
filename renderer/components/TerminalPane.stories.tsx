import type { Meta, StoryObj } from '@storybook/react'
import { TerminalPane } from './TerminalPane'

// ENH-239 Phase 1 — terminal column host. Heavy: each tab mounts a live
// xterm.js Terminal that opens a PTY over IPC. The smoke story passes an empty
// `tabs` list so no TerminalInstance (and thus no xterm/PTY) mounts — only the
// outer surface wrapper renders. Mounting a populated terminal needs a real PTY
// session, which Storybook can't provide.
const meta = {
  title: 'Panes/TerminalPane',
  component: TerminalPane,
  args: {
    tabs: [],
    activeTabId: '',
    onTitleChange: () => {},
    cozyByTab: {},
    cozyDefault: false,
    fontBumpByTab: {},
    fontBumpDefault: 0,
    themeEffective: 'light',
    onTerminalFocus: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ width: 560, height: 360, background: 'var(--duo-term-bg)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TerminalPane>

export default meta
type Story = StoryObj<typeof meta>

// Empty smoke: the column wrapper with no mounted terminal instance.
export const Empty: Story = {}
