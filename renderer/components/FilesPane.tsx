// Stage 10 Phase 4 — the real file navigator.
// Header (breadcrumb + pin) + tree (lazy-loaded, folder-first, dotfile rule)
// + collapsed rail. Contents drive pending-CWD for new terminal tabs and
// file-open requests for the working pane (wired in App.tsx).

import { forwardRef, useImperativeHandle, useRef } from 'react'
import { Breadcrumb, type BreadcrumbHandle } from './Breadcrumb'
import { FileTree } from './FileTree'
import { PinnedNav } from './PinnedNav'
import { UserClaudePane } from './UserClaudePane'
import { ProjectClaudeContext } from './ProjectClaudeContext'
import type { DirEntry, NavPinEntry } from '@shared/types'
import type { NavigatorState, NavigatorActions } from '../hooks/useNavigator'
import type { NavPinsApi } from '../hooks/useNavPins'
import type { UserClaudeNavigatorApi } from '../hooks/useUserClaudeNavigator'

interface FilesPaneProps {
  collapsed: boolean
  focused: boolean
  home: string
  state: NavigatorState
  actions: NavigatorActions
  onOpenFile: (entry: DirEntry) => void
  onOpenTerminalHere: (folderPath: string) => void
  /** Stage 26 item 7 \u2014 hover \"new Claude here\" button. Spawns a new
   *  terminal tab with kind='claude' and an explicit CWD. */
  onOpenClaudeIn: (folderPath: string) => void
  revealChip: string | null
  onDismissRevealChip: () => void
  /** Stage 22 \u2014 independent state machine for the "Your Claude
   *  settings" pane. Lives in App.tsx so its `expanded` set persists
   *  across re-mounts of FilesPane. */
  userClaudeNav: UserClaudeNavigatorApi
  /** Stage 26 PR 2 (ENH-010) \u2014 navigator pins API. */
  navPins: NavPinsApi
  /** Flip collapsed state. Needed as a click-to-expand affordance so users
   *  stuck with \u2318B swallowed by an editor tab (bold) always have an escape. */
  onToggleCollapsed: () => void
  /** Stage 26 PR 3 item 2 \u2014 front terminal's launch CWD. Threaded
   *  through to FileTree so folder rows whose path matches render an
   *  ambient accent dot. `null` when no terminal exists or its cwd
   *  isn't tracked yet. */
  activeTerminalCwd?: string | null
  /** Stage 26 PR 3 item 3 \u2014 set of file paths currently open in any
   *  WorkingPane tab. Threaded down so file rows render with brighter
   *  text. */
  openFilePaths?: ReadonlySet<string>
  /** Stage 26 PR 3 item 3 \u2014 path of the currently-active file tab.
   *  The matching file row gets an accent dot (mirrors
   *  `activeTerminalCwd` on folders). */
  activeFilePath?: string | null
  /** Stage 26 PR 3 item 8 \u2014 fired when the editable breadcrumb
   *  resolves to a file. Host (App.tsx) routes to "navigate to
   *  parent + open file." */
  onRevealFile?: (path: string) => void
  /** Sprint 3 Phase 3b \u2014 fired when a FileTree row's right-click
   *  menu picks "Open in Split View". App.tsx routes to
   *  splitViewMoveTabByPath. */
  onOpenInSplit?: (path: string) => void
}

export interface FilesPaneHandle {
  /** Stage 26 PR 3 item 8 \u2014 programmatically open the breadcrumb's
   *  editable input. Wired to \u2318\u21e7G in App.tsx via useKeyboardShortcuts. */
  focusBreadcrumbEdit: () => void
}

export const FilesPane = forwardRef<FilesPaneHandle, FilesPaneProps>(function FilesPane({
  collapsed,
  focused,
  home,
  state,
  actions,
  userClaudeNav,
  navPins,
  onOpenFile,
  onOpenTerminalHere,
  onOpenClaudeIn,
  revealChip,
  onDismissRevealChip,
  onToggleCollapsed,
  activeTerminalCwd = null,
  openFilePaths,
  activeFilePath = null,
  onRevealFile,
  onOpenInSplit
}: FilesPaneProps, ref) {
  const breadcrumbRef = useRef<BreadcrumbHandle | null>(null)
  useImperativeHandle(ref, () => ({
    focusBreadcrumbEdit: () => {
      // Auto-expand if collapsed; otherwise focus is invisible.
      if (collapsed) onToggleCollapsed()
      // requestAnimationFrame so the layout settles after the
      // collapsed→expanded transition before the input mounts/focuses.
      requestAnimationFrame(() => breadcrumbRef.current?.focusEdit())
    }
  }), [collapsed, onToggleCollapsed])

  return (
    <div
      className={[
        // BUG-003 fix (rev 2): the inset-shadow ring approach was misleading
        // — it appeared to encircle the focused pane but xterm canvas
        // (Terminal) and WebContentsView (Working) painted over three of
        // four sides, leaving only an ambiguous seam line. The new
        // indicator lives in the chrome strip (renderer DOM, never
        // occluded): the column's header tints to `accent-soft` when
        // focused. Files pane's "header" is the breadcrumb row below.
        // Seam border still flips to full-opacity accent as a secondary
        // cue.
        //
        // Stage 26 PR 3 item 11 (v0.5.4) — focus signal extended from
        // chrome-only to a 2px LEFT-EDGE accent stripe on the column
        // wrapper itself. The column has no occluding child (unlike
        // Terminal's xterm canvas or Working's WebContentsView), so the
        // wrapper's own border paints unambiguously. Read together with
        // the existing tinted-header pattern: header chrome tints +
        // left edge stripes when focused = whole pane reads as
        // "this is the focused column."
        'flex flex-col h-full bg-surface-1 border-r border-l-2 transition-[width,border-color] duration-150',
        focused ? 'border-r-accent border-l-accent' : 'border-r-border border-l-transparent'
      ].join(' ')}
      style={{ width: collapsed ? '44px' : '208px', flexShrink: 0 }}
      aria-label="Files"
    >
      {collapsed ? (
        <CollapsedRail
          onExpand={onToggleCollapsed}
          projectName={state.cwd.split('/').filter(Boolean).pop() ?? '/'}
        />
      ) : (
        <div className="flex flex-col h-full min-w-0">
          {/* Stage 22 — top pane "Your Claude settings". Renders the
              user-level context (~/.claude/) above the project tree
              so non-technical PMs see at a glance that the agent
              reads from BOTH user-level and project-level context.
              Collapsible; defaults expanded. */}
          <UserClaudePane
            nav={userClaudeNav}
            onOpenFile={onOpenFile}
            onOpenTerminalHere={onOpenTerminalHere}
            focused={focused}
          />

          {/* Bottom pane — "This project". Existing breadcrumb +
              tree, with a new "Project Claude context" group above
              the tree that surfaces ./CLAUDE.md / ./.claude/ /
              ./tasks.md / ./AGENTS.md when they exist. */}
          <div
            className={[
              'flex items-center border-b shrink-0 transition-colors',
              focused ? 'bg-accent-soft border-accent' : 'border-border'
            ].join(' ')}
          >
            <div className="flex-1 min-w-0">
              <Breadcrumb
                ref={breadcrumbRef}
                cwd={state.cwd}
                home={home}
                onNavigate={actions.navigateTo}
                onRevealFile={onRevealFile}
              />
            </div>
            <PinButton pinned={state.pinned} onClick={actions.togglePinned} />
            <CollapseButton onClick={onToggleCollapsed} />
          </div>

          {/* Reveal chip — Stage 10 § D16 */}
          {revealChip && (
            <RevealChip path={revealChip} onDismiss={onDismissRevealChip} />
          )}

          {/* Stage 22 — project Claude context group: ./CLAUDE.md,
              ./.claude/, ./tasks.md, ./AGENTS.md when they exist.
              Hides when none exist so projects without Claude context
              don't show an empty section header. */}
          <ProjectClaudeContext
            state={state}
            actions={actions}
            onOpenFile={onOpenFile}
            onOpenTerminalHere={onOpenTerminalHere}
          />

          {/* Project tree */}
          <FileTree
            state={state}
            actions={actions}
            onOpenFile={onOpenFile}
            onOpenTerminalHere={onOpenTerminalHere}
            onOpenClaudeIn={onOpenClaudeIn}
            navPins={navPins}
            activeTerminalCwd={activeTerminalCwd}
            openFilePaths={openFilePaths}
            activeFilePath={activeFilePath}
            onOpenInSplit={onOpenInSplit}
          />

          {/* Stage 26 PR 2 (ENH-010) — Pinned files & folders.
              Hidden when empty; collapsible header when populated. */}
          <PinnedNav
            pins={navPins.pins}
            home={home}
            selectedPath={state.selected?.path ?? null}
            onSelect={(entry) => actions.selectItem(entry.path, entry.kind)}
            onOpenFile={(entry) => {
              // Build a DirEntry-shaped record so onOpenFile (which
              // expects DirEntry, not NavPinEntry) routes through the
              // same fileClassifier path as the project tree.
              onOpenFile({
                name: entry.title ?? entry.path.split('/').pop() ?? entry.path,
                path: entry.path,
                kind: 'file'
              })
            }}
            onOpenFolder={(entry) => actions.navigateTo(entry.path)}
            onOpenTerminalHere={onOpenTerminalHere}
            onRevealInFinder={(p) => window.electron.files.revealInFinder(p)}
            onUnpin={(entry) => navPins.toggle(entry)}
            onOpenInSplit={onOpenInSplit}
          />
        </div>
      )}
    </div>
  )
})

function CollapsedRail({ onExpand, projectName }: { onExpand: () => void; projectName: string }) {
  return (
    <button
      onClick={onExpand}
      title={`Show navigator: ${projectName} (\u2318B)`}
      aria-label={`Show navigator: ${projectName}`}
      className="h-full w-full flex flex-col items-center pt-3 gap-2 text-ink-mute hover:text-ink hover:bg-surface-2 transition-colors cursor-pointer"
    >
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M3 4.5A1.5 1.5 0 0 1 4.5 3h4l1.5 1.5h5.5A1.5 1.5 0 0 1 17 6v9.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15.5v-11Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
      {/* ENH-079 (v0.6.4) \u2014 vertical "Navigator: {project}" label,
          mirroring CollapsedPaneRail's terminal/canvas labels (font /
          size / writing-mode / rotation match exactly). Shows the
          basename of the project's cwd so a user with multiple Duo
          windows knows at a glance which one this rail belongs to. */}
      <span
        className="font-serif italic text-[13px] text-ink-mute mt-1 tracking-wide"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
      >
        {`Navigator: ${projectName}`}
      </span>
    </button>
  )
}

function RevealChip({ path, onDismiss }: { path: string; onDismiss: () => void }) {
  // Stage 10 § D16 — surfaces agent-driven navigator changes so the user
  // knows the tree moved without their input. Short-lived; dismissable.
  const shortPath = path.length > 40 ? '…' + path.slice(path.length - 40) : path
  return (
    <div className="mx-2 mt-2 mb-1 px-2 py-1.5 rounded bg-accent/15 text-accent-foreground flex items-center gap-2 text-[11px]">
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="text-accent shrink-0">
        <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M6 3.5v2.5l2 1.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
      <span className="truncate flex-1 text-zinc-300">Claude moved to <span className="text-zinc-100" title={path}>{shortPath}</span></span>
      <button
        onClick={onDismiss}
        className="shrink-0 w-4 h-4 rounded flex items-center justify-center text-zinc-500 hover:text-zinc-100 hover:bg-surface-3 transition-colors"
        aria-label="Dismiss"
      >
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  )
}

function PinButton({ pinned, onClick }: { pinned: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={pinned ? 'Unpin (navigator follows the active terminal tab)' : 'Pin (freeze navigator regardless of terminal tab)'}
      className={[
        'shrink-0 w-7 h-7 flex items-center justify-center rounded transition-colors',
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

// Stage 12 — collapse the Files column to a 44px rail. Pairs with
// CollapsedRail (which is the click-to-expand affordance). Atelier
// annotation showed a chevron-into-rail glyph next to the pin button.
function CollapseButton({ onClick }: { onClick: () => void }) {
  // ENH-015 — discoverability: bumped color from text-zinc-600 (barely
  // visible against the cream paper bg) to text-ink-mute, so the button
  // reads as "present and clickable" at rest. Glyph swapped from a
  // chevron-into-rail to the macOS-Finder-style sidebar-toggle (rail +
  // filled column on one side) — that pattern is already in users'
  // muscle memory from Finder, VS Code, Mail. The two visual cues
  // together (better contrast + recognizable glyph) close the
  // user-reported "cannot find the button to collapse the file
  // navigator" gap; the optional first-launch coach-mark from the
  // task entry is deferred to Stage 18 FTUX.
  return (
    <button
      onClick={onClick}
      title="Collapse files column (⌘B)"
      aria-label="Collapse files column"
      className="shrink-0 w-7 h-7 mr-1 flex items-center justify-center rounded transition-colors text-ink-mute hover:text-ink hover:bg-surface-3"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        {/* Sidebar-toggle glyph: rounded outer rect + a left-side filled
            column representing "the sidebar." Mirrors macOS Finder's
            sidebar-toggle in the toolbar. Wider/taller than the previous
            chevron so it reads at rest. */}
        <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
        <rect x="1.5" y="2.5" width="3.5" height="9" fill="currentColor" opacity="0.55" />
      </svg>
    </button>
  )
}
