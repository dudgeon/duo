import type { Meta, StoryObj } from '@storybook/react'
import { PageFindBar } from './PageFindBar'

// ENH-239 Phase 1 — canvas-mode find bar (BUG-126). Operates against an
// iframe contentDocument via the pageFind helpers. In Storybook there is no
// live iframe, so we pass `iframe: null`: the bar chrome (input + counter +
// nav buttons) still renders, with the input disabled and the "not
// supported" placeholder (the null-window → isHighlightSupported=false path).
const meta = {
  title: 'Page/PageFindBar',
  component: PageFindBar,
  args: {
    iframe: null,
    open: true,
    onClose: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ width: 420, background: 'var(--duo-paper)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PageFindBar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

// Closed → renders nothing (early return on !open).
export const Closed: Story = { args: { open: false } }
