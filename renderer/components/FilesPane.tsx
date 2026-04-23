// Stage 10 Phase 4 — the real file navigator.
// Header (breadcrumb + pin) + tree (lazy-loaded, folder-first, dotfile rule)
// + collapsed rail. Contents drive pending-CWD for new terminal tabs and
// file-open requests for the working pane (wired in App.tsx).

import { Breadcrumb } from './Breadcrumb'
import { FileTree } from './FileTree'
import type { DirEntry } from '@shared/types'
import type { NavigatorState, NavigatorActions } from '../hooks/useNavigator'

interface FilesPaneProps {
  collapsed: boolean
  focused: boolean
  home: string
  state: NavigatorState
  actions: NavigatorActions
  onOpenFile: (entry: DirEntry) => void
}

export function FilesPane({
  collapsed,
  focused,
  home,
  state,
  actions,
  onOpenFile
}: FilesPaneProps) {
  return (
    <div
      className={[
        'flex flex-col h-full bg-surface-1 border-r transition-[width] duration-150',
        focused ? 'border-accent/60' : 'border-border'
      ].join(' ')}
      style={{ width: collapsed ? '48px' : '240px', flexShrink: 0 }}
      aria-label="Files"
    >
      {collapsed ? (
        <CollapsedRail />
      ) : (
        <div className="flex flex-col h-full min-w-0">
          {/* Header: breadcrumb + pin toggle */}
          <div className="flex items-center border-b border-border shrink-0">
            <div className="flex-1 min-w-0">
              <Breadcrumb
                cwd={state.cwd}
                home={home}
                onNavigate={actions.navigateTo}
              />
            </div>
            <PinButton pinned={state.pinned} onClick={actions.togglePinned} />
          </div>

          {/* Tree */}
          <FileTree
            state={state}
            actions={actions}
            onOpenFile={onOpenFile}
          />
        </div>
      )}
    </div>
  )
}

function CollapsedRail() {
  return (
    <div className="h-full flex flex-col items-center pt-3 gap-2 text-zinc-500">
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M3 4.5A1.5 1.5 0 0 1 4.5 3h4l1.5 1.5h5.5A1.5 1.5 0 0 1 17 6v9.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15.5v-11Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

function PinButton({ pinned, onClick }: { pinned: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={pinned ? 'Unpin (navigator follows the active terminal tab)' : 'Pin (freeze navigator regardless of terminal tab)'}
      className={[
        'shrink-0 w-7 h-7 mr-1 flex items-center justify-center rounded transition-colors',
        pinned ? 'text-accent hover:bg-surface-3' : 'text-zinc-600 hover:text-zinc-300 hover:bg-surface-3'
      ].join(' ')}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path
          d="M6 8.5v2.2M4 2.5h4M6 2.5v5l-1.8 1.5h3.6L6 7.5v-5Z"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </button>
  )
}
