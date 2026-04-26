// Stage 10 Phase 5 — polymorphic WorkingPane shell.
//
// Merges browser tabs (owned by main-process BrowserManager via the
// `browser:*` IPC) with file tabs (owned by the renderer state that App.tsx
// passes down) into a single unified tab strip. A single active-tab state
// controls which renderer mounts below the strip.

import { BrowserRenderer } from './BrowserRenderer'
import { MarkdownPreview } from './MarkdownPreview'
import { MarkdownEditor } from './editor/MarkdownEditor'
import { ImagePreview, PdfPreview, UnknownFilePreview } from './FileRenderers'
import { WorkingTabStrip } from './WorkingTabStrip'
import { useBrowserState } from '../hooks/useBrowserState'
import type { WorkingTab, WorkingTabType } from '@shared/types'

export interface FileTab {
  id: string
  type: Exclude<WorkingTabType, 'browser'>
  path: string
  title: string
  mime: string
  /** Stage 11 — unsaved-edits flag for `editor` tabs. */
  dirty?: boolean
  /** Stage 11 § D33a — newly-created file that hasn't been named/written
   *  to disk yet. The editor renders a "Name this document" interstitial
   *  before the prose canvas while this is true. */
  isNew?: boolean
}

export type ActiveWorking =
  | { kind: 'browser' }
  | { kind: 'file'; id: string }

interface WorkingPaneProps {
  fileTabs: FileTab[]
  activeWorking: ActiveWorking
  setActiveWorking: (a: ActiveWorking) => void
  closeFileTab: (id: string) => void
  onOpenMarkdown: (path: string) => void
  /** Stage 11 — let the editor push its dirty state up so the tab chip can
   *  show the unsaved dot. */
  onTabDirtyChange: (id: string, dirty: boolean) => void
  /** Stage 11 § D33a — finalize a new-file tab: write empty file at
   *  resolved path, drop `isNew`, update title. */
  onCommitNewFile: (id: string, path: string, title: string) => Promise<void>
  /** BUG-003 fix — passed through to the tab strip so it can paint a
   *  focused state. */
  focused?: boolean
  /** Stage 15.1 — host callback fired when the editor's Send → Duo
   *  pill is clicked. Receives an already-formatted payload string;
   *  the host writes it to the active terminal's PTY. `null` props
   *  the pill from rendering at all. */
  onSendToDuo?: ((payload: string) => void) | null
}

export function WorkingPane({
  fileTabs,
  activeWorking,
  setActiveWorking,
  closeFileTab,
  onOpenMarkdown,
  onTabDirtyChange,
  onCommitNewFile,
  focused = false,
  onSendToDuo
}: WorkingPaneProps) {
  const { tabs: browserTabs, addTab, switchTab, closeTab: closeBrowserTab } = useBrowserState()

  // Merge for the strip. Stable order: file tabs first (in insertion order),
  // then browser tabs by their id. The strip serializes both into the shared
  // `WorkingTab` shape. IDs in the merged view: file tabs carry their
  // string uuid; browser tabs' numeric ids get prefixed with "b:" so the
  // two namespaces can't collide inside the strip.
  const mergedTabs: WorkingTab[] = [
    ...fileTabs.map(ft => ({
      id: stringifyFileId(ft.id),
      type: ft.type,
      title: ft.isNew ? `${ft.title} \u00b7 unsaved` : ft.title,
      path: ft.path,
      mime: ft.mime,
      dirty: ft.dirty || ft.isNew,
      isActive: activeWorking.kind === 'file' && activeWorking.id === ft.id
    })),
    ...browserTabs.map(bt => ({
      id: stringifyBrowserId(bt.id),
      type: 'browser' as const,
      title: bt.title,
      url: bt.url,
      // Browser's own active flag survives at the main-process level, but
      // when a file tab is active in the strip, no browser tab should show
      // as active.
      isActive: activeWorking.kind === 'browser' && bt.isActive
    }))
  ]

  const handleSelect = (id: string) => {
    const parsed = parseId(id)
    if (parsed.kind === 'file') {
      setActiveWorking({ kind: 'file', id: parsed.id })
    } else {
      setActiveWorking({ kind: 'browser' })
      void switchTab(parsed.id)
    }
  }

  const handleClose = (id: string) => {
    const parsed = parseId(id)
    if (parsed.kind === 'file') {
      closeFileTab(parsed.id)
    } else {
      void closeBrowserTab(parsed.id)
    }
  }

  const handleNew = () => {
    // New-tab button defaults to a browser tab (matches Stage 8's
    // `duo open` semantics and preserves current muscle memory).
    setActiveWorking({ kind: 'browser' })
    void addTab()
  }

  // Renderer dispatch.
  let activeRenderer: React.ReactNode = null
  if (activeWorking.kind === 'browser') {
    activeRenderer = <BrowserRenderer onSendToDuo={onSendToDuo} />
  } else {
    const tab = fileTabs.find(ft => ft.id === activeWorking.id)
    if (!tab) {
      // Stale active id — fall back to browser.
      activeRenderer = <BrowserRenderer onSendToDuo={onSendToDuo} />
    } else if (tab.type === 'editor') {
      activeRenderer = (
        <MarkdownEditor
          key={tab.id}
          path={tab.path}
          isNew={tab.isNew}
          onDirtyChange={(d) => onTabDirtyChange(tab.id, d)}
          onCommitNewFile={(p, t) => onCommitNewFile(tab.id, p, t)}
          onCancelNew={() => closeFileTab(tab.id)}
          onSendToDuo={onSendToDuo}
        />
      )
    } else if (tab.type === 'markdown-preview') {
      activeRenderer = (
        <MarkdownPreview
          path={tab.path}
          onOpenMarkdown={onOpenMarkdown}
        />
      )
    } else if (tab.type === 'image') {
      activeRenderer = <ImagePreview tab={asWorkingTab(tab)} />
    } else if (tab.type === 'pdf') {
      activeRenderer = <PdfPreview tab={asWorkingTab(tab)} />
    } else {
      activeRenderer = <UnknownFilePreview tab={asWorkingTab(tab)} />
    }
  }

  return (
    // Stage 12 Phase 3 — working pane sits on `paper` (surface-0) so the
    // active tab in WorkingTabStrip (also paper) reads as continuous with
    // the content below. Strip itself is paper-deep (surface-1) for
    // contrast. See docs/design/atelier/project/duo-components.jsx ~L286.
    <div className="flex flex-col w-full h-full bg-surface-0">
      <WorkingTabStrip
        tabs={mergedTabs}
        onSelect={handleSelect}
        onNew={handleNew}
        onClose={handleClose}
        focused={focused}
      />
      {activeRenderer}
    </div>
  )
}

function asWorkingTab(ft: FileTab): WorkingTab {
  return {
    id: stringifyFileId(ft.id),
    type: ft.type,
    title: ft.title,
    isActive: true,
    path: ft.path,
    mime: ft.mime
  }
}

function stringifyFileId(id: string): string { return 'f:' + id }
function stringifyBrowserId(id: number): string { return 'b:' + id }
function parseId(id: string): { kind: 'file'; id: string } | { kind: 'browser'; id: number } {
  if (id.startsWith('f:')) return { kind: 'file', id: id.slice(2) }
  if (id.startsWith('b:')) return { kind: 'browser', id: parseInt(id.slice(2), 10) }
  throw new Error(`Invalid tab id: ${id}`)
}
