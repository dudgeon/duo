import type { Meta, StoryObj } from '@storybook/react'
import { ProposeBar } from './ProposeBar'

// ENH-239 Phase 1 — the "Propose changes" editor footer ({ path, active,
// refreshKey }). The bar is INERT (renders null) for ordinary files: it only
// appears for a diverged managed checkout, whose git/PR state is read live from
// main. Outside that live context it self-gates to null — so this is a smoke
// story that mounts the component with the least props that compile.
const meta = {
  title: 'Chrome/ProposeBar',
  component: ProposeBar,
  args: {
    path: '/Users/geoff/Documents/notes/inbox.md',
    active: true,
    refreshKey: 0,
  },
} satisfies Meta<typeof ProposeBar>

export default meta
type Story = StoryObj<typeof meta>

// Smoke: mounts cleanly; renders null until a live diverged checkout is present.
export const Default: Story = {}
