import type { Meta, StoryObj } from '@storybook/react'
import { UpdateAvailableBanner } from './UpdateAvailableBanner'

// ENH-239 Phase 1 — GitHub-Releases upgrade-available banner. Takes NO props:
// it calls window.electron.update.check() and renders only when an update is
// available. The mock bridge reports none, so it renders null in isolation —
// this is a mount smoke story (it must mount without throwing). Wrapped in a
// banner-width slot to mirror the strip it occupies above the WorkingPane.
const meta = {
  title: 'Status/UpdateAvailableBanner',
  component: UpdateAvailableBanner,
  decorators: [
    (Story) => (
      <div style={{ width: 560 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof UpdateAvailableBanner>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
