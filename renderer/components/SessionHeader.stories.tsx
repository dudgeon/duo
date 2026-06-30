import type { Meta, StoryObj } from '@storybook/react'
import { SessionHeader } from './SessionHeader'

// ENH-239 Phase 1 — polymorphic session header (heavy: in-memory store +
// per-tab IPC). It computes S0 (quiet) / S1 (resume pills) / S3 (restore-offer)
// from per-tab signals. The mock bridge returns no prior sessions and no banner
// title, so S1 (needs session.listPrior rows) can't render in isolation; S3
// renders from a captured lastClaudeSession with claude NOT live, falling back
// to the short-UUID title. Wrapped in a banner-width slot.
const meta = {
  title: 'Status/SessionHeader',
  component: SessionHeader,
  args: {
    tabId: 'tab-1',
    cwd: '/tmp/duo-preview',
    lastClaudeSession: null,
    claudePresence: 'shell',
    onResume: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ width: 560 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SessionHeader>

export default meta
type Story = StoryObj<typeof meta>

// S0 — quiet. No captured session, claude not live, no prior sessions → null.
export const Quiet: Story = {}

// S3 — restore offer. A captured prior session UUID + claude not running.
export const RestoreOffer: Story = {
  args: {
    lastClaudeSession: { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', capturedAt: Date.now() },
    claudePresence: 'shell',
  },
}
