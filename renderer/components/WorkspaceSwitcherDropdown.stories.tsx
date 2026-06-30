import type { Meta, StoryObj } from '@storybook/react'
import { useRef } from 'react'
import type { ActiveWorkspace } from '@shared/types'
import { WorkspaceSwitcherDropdown } from './WorkspaceSwitcherDropdown'

// ENH-239 Phase 1 — the titlebar workspace switcher ({ open, anchorRef,
// activeWorkspace, onClose }). It positions itself fixed under the anchor's
// bounding rect and reads the recent-workspace list from
// window.electron.workspaceFile (the global mock decorator). Because it needs a
// real anchor ref, every story renders a small trigger button and threads its
// ref in via a custom render arrow.
const ACTIVE: ActiveWorkspace = { path: '/Users/geoff/work.duo-workspace', name: 'work' }

function Harness({ open, activeWorkspace }: { open: boolean; activeWorkspace: ActiveWorkspace | null }) {
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  return (
    <div style={{ padding: 24 }}>
      <button
        ref={anchorRef}
        type="button"
        style={{ padding: '4px 10px', border: '1px solid var(--duo-paper-rule)', borderRadius: 4 }}
      >
        {activeWorkspace?.name ?? 'untitled'} ▾
      </button>
      <WorkspaceSwitcherDropdown
        open={open}
        anchorRef={anchorRef}
        activeWorkspace={activeWorkspace}
        onClose={() => {}}
      />
    </div>
  )
}

// Meta-level args satisfy the required-args type; every story overrides the
// whole subtree via a `render` arrow (the dropdown needs a live anchor ref),
// so these defaults are never actually consumed.
const meta = {
  title: 'Chrome/WorkspaceSwitcherDropdown',
  component: WorkspaceSwitcherDropdown,
  args: {
    open: true,
    anchorRef: { current: null },
    activeWorkspace: ACTIVE,
    onClose: () => {},
  },
} satisfies Meta<typeof WorkspaceSwitcherDropdown>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => <Harness open activeWorkspace={ACTIVE} />,
}

export const Untitled: Story = {
  render: () => <Harness open activeWorkspace={null} />,
}

export const Closed: Story = {
  render: () => <Harness open={false} activeWorkspace={ACTIVE} />,
}
