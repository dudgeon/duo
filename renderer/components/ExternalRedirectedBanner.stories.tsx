import type { Meta, StoryObj } from '@storybook/react'
import { ExternalRedirectedBanner } from './ExternalRedirectedBanner'

// ENH-239 Phase 1 — post-redirect chrome banner. Takes NO props: it subscribes
// to window.electron.external.onRedirected and renders only after a push
// arrives. The mock bridge fires no push, so it renders null in isolation —
// this is a mount smoke story (it must mount without throwing). Wrapped in a
// banner-width slot to mirror the strip it occupies above the WorkingPane.
const meta = {
  title: 'Status/ExternalRedirectedBanner',
  component: ExternalRedirectedBanner,
  decorators: [
    (Story) => (
      <div style={{ width: 560 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ExternalRedirectedBanner>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
