import type { Meta, StoryObj } from '@storybook/react'
import { FirstLaunchBanner } from './FirstLaunchBanner'

// ENH-239 Phase 1 — first-launch self-install banner. Takes NO props: it reads
// window.electron.install.status() and gates its visibility on that result.
// The mock bridge returns no status, so it renders null in isolation — this is
// a mount smoke story (it must mount without throwing). Wrapped in a
// banner-width slot to mirror the strip it occupies above the WorkingPane.
const meta = {
  title: 'Status/FirstLaunchBanner',
  component: FirstLaunchBanner,
  decorators: [
    (Story) => (
      <div style={{ width: 640 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FirstLaunchBanner>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
