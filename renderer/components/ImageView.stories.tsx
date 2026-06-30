import type { Meta, StoryObj } from '@storybook/react'
import type { WorkingTab } from '@shared/types'
import { ImageView } from './ImageView'

// ENH-239 Phase 1 — image viewer with zoom/fit/copy toolbar chrome. Heavy: the
// image bytes load via files.read IPC + a blob URL (mocked by the decorator, so
// no real pixels render), but the toolbar + image-area chrome mount fine. This
// is a smoke story exercising the surrounding controls. Flex-fills, so it's
// wrapped in a sized slot.

const imageTab: WorkingTab = {
  id: 'f:img-1',
  type: 'image',
  title: 'screenshot.png',
  isActive: true,
  path: '/Users/geoff/Desktop/screenshot.png',
  mime: 'image/png',
}

const meta = {
  title: 'Modals/ImageView',
  component: ImageView,
  args: { tab: imageTab },
  decorators: [
    (Story) => (
      <div style={{ height: 420, width: 560, display: 'flex', flexDirection: 'column', background: 'var(--duo-paper)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ImageView>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
