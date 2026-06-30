import type { Meta, StoryObj } from '@storybook/react'
import { BrowserRenderer } from './BrowserRenderer'

// ENH-239 Phase 1 — browser pane chrome. Heavy: the actual page is a native
// WebContentsView positioned by main over the renderer-DOM slot via
// `browser.setBounds`. In Storybook only the renderer-DOM chrome renders —
// the nav buttons, address bar, and find bar — over an empty content slot
// (the mock electron decorator absorbs the browser.* IPC calls on mount).
//
// BrowserRenderer's props come from a default-param destructure
// (`({ … }: BrowserRendererProps = {})`), which makes CSF infer the story
// `args` slot as `never` under `satisfies Meta<typeof BrowserRenderer>`. We
// type the meta as a plain `Meta` and pass props via a `render` arrow so the
// stories typecheck while still registering the component.
const meta: Meta<typeof BrowserRenderer> = {
  title: 'Panes/BrowserRenderer',
  component: BrowserRenderer,
  decorators: [
    (Story) => (
      <div style={{ width: 640, height: 420, background: 'var(--duo-surface-1)' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof BrowserRenderer>

export const Default: Story = {
  render: () => <BrowserRenderer onSendToDuo={() => {}} />,
}

// `onSendToDuo: null` propagates "no terminal available" and props the Send
// pill from rendering.
export const NoTerminal: Story = {
  render: () => <BrowserRenderer onSendToDuo={null} />,
}
