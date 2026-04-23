// Stage 10 Phase 3 — the right-column WorkingPane shell.
//
// Owns the unified tab strip. A tab's `type` picks which renderer mounts for
// the content area:
//   - browser         → BrowserRenderer (WebContentsView, existing)
//   - markdown-preview → Phase 5 (TBD)
//   - image / pdf / unknown → Phase 5 (TBD)
//
// In Phase 3 only browser tabs exist, so the renderer dispatch currently has
// one real branch. Subsequent phases add the others. This keeps the shell
// shape committed so later work slots in cleanly.

import { BrowserRenderer } from './BrowserRenderer'
import { WorkingTabStrip } from './WorkingTabStrip'
import { useBrowserState } from '../hooks/useBrowserState'
import type { WorkingTab } from '@shared/types'

export function WorkingPane() {
  const { tabs: browserTabs, addTab, switchTab, closeTab } = useBrowserState()

  // Adapt BrowserTab[] → WorkingTab[] for the shared strip. When Phase 4/5
  // introduce non-browser tabs, the merge happens here (concat + sort by id).
  const workingTabs: WorkingTab[] = browserTabs.map(bt => ({
    id: bt.id,
    type: 'browser',
    title: bt.title,
    isActive: bt.isActive,
    url: bt.url
  }))

  const active = workingTabs.find(t => t.isActive)

  return (
    <div className="flex flex-col w-full h-full bg-surface-1">
      <WorkingTabStrip
        tabs={workingTabs}
        onSelect={(id) => { switchTab(id) }}
        onNew={() => { addTab() }}
        onClose={(id) => { closeTab(id) }}
      />
      {/* Per-type renderer dispatch. Browser is the only real branch in
          Phase 3; Phase 5 adds the rest. */}
      {active?.type === 'browser' && <BrowserRenderer />}
    </div>
  )
}
