import type { Meta, StoryObj } from '@storybook/react'
import { HomeView } from './HomeView'

// ENH-239 Phase 1 — HEAVY component (the full Home re-entry surface). Smoke
// story only: it mounts with isActive and reads its data live from
// window.electron.home.* (backed by the global mock-electron decorator). With
// the default mock it shows the loading/empty state; the goal is to confirm it
// mounts without crashing, not to exercise every snapshot shape.

const meta = {
  title: 'Home/HomeView',
  component: HomeView,
  args: { isActive: true },
} satisfies Meta<typeof HomeView>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
