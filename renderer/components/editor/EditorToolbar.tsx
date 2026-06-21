// Stage 11 (initial) → Stage 17a polish item 3 (refactored) — shared
// presentational toolbar for both the markdown editor and the HTML
// canvas. The toolbar does not import TipTap or any DOM primitives;
// it dispatches every action through an `EditorActions` interface
// the host supplies. See `EditorActions.ts` for the contract.
//
// Reactivity: the toolbar re-renders when `selectionVersion` changes.
// Hosts bump that counter on every selectionUpdate / iframe
// selectionchange so contextual state (active marks, current block,
// inTable, can-X disabled flags) stays in sync.

import type { EditorActions } from './EditorActions'
import { SaveControl } from './SaveControl'
import { requestLinkPrompt } from './LinkPromptModal'

interface Props {
  actions: EditorActions
  /** Bumped by the host on every selection / state change so the
   *  toolbar re-renders and re-queries `actions.isActive(...)`. */
  selectionVersion: number
  onSave: () => void
  dirty: boolean
  saving: boolean
  /** Sprint 10 ENH-103 — last save failure (cleared on next edit /
   *  successful save). Drives the SaveControl pill's "Failed — retry"
   *  state. */
  saveError: string | null
  /** Sprint 10 ENH-104 — current autosave preference (persisted
   *  per-app by the host). */
  autosaveOn: boolean
  onToggleAutosave: () => void
  /** ENH-221 — open the file version-history modal ("the richer rewind").
   *  Distinct from undo/redo: a cross-session timeline + restore-any-point. */
  onShowHistory?: () => void
}

export function EditorToolbar({
  actions, onSave, dirty, saving,
  saveError, autosaveOn, onToggleAutosave, onShowHistory
}: Props) {
  // selectionVersion is consumed via the prop signature alone — the
  // mere change of value triggers React to re-render this component,
  // and the action queries below are called fresh on every render.

  const currentBlock = actions.currentBlock()
  const inTable = actions.inTable()
  const tableOps = actions.tableOps
  const extras = actions.extras

  const setBlock = (v: string) => {
    actions.setBlock(v as ReturnType<EditorActions['currentBlock']>)
  }

  const insertLink = () => {
    // BUG-137 walk-3 fix — Electron renderers throw on window.prompt;
    // route through the LinkPromptModal Promise helper instead.
    const prev = actions.currentLinkHref()
    void requestLinkPrompt(prev ?? 'https://').then((url) => {
      if (url === null) return
      actions.setLink(url.trim() === '' ? null : url)
    })
  }

  return (
    <div className="flex flex-col shrink-0 border-b border-border bg-surface-1">
      {/* `flex-nowrap` + per-Btn `shrink-0` keep the toolbar on a
          single horizontal line on narrow canvases — the row scrolls
          horizontally via overflow-x-auto rather than wrapping (which
          would break the fixed h-10 height contract). Owner directive
          2026-05-18. */}
      <div className="flex flex-nowrap items-center h-10 gap-1 px-2 text-zinc-300 text-sm overflow-x-auto">
        <select
          value={currentBlock}
          onChange={(e) => setBlock(e.target.value)}
          className="bg-surface-2 border border-border rounded px-2 py-1 text-xs focus:outline-none focus:border-accent/60"
          title="Paragraph / Heading level"
        >
          <option value="p">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="h4">Heading 4</option>
          <option value="h5">Heading 5</option>
          <option value="h6">Heading 6</option>
        </select>

        <Sep />

        <Btn onMouseDown={() => actions.toggleBold()} active={actions.isActive('bold')} title="Bold (⌘B)">
          <span className="font-bold">B</span>
        </Btn>
        <Btn onMouseDown={() => actions.toggleItalic()} active={actions.isActive('italic')} title="Italic (⌘I)">
          <span className="italic">I</span>
        </Btn>
        <Btn onMouseDown={() => actions.toggleUnderline()} active={actions.isActive('underline')} title="Underline (⌘U)">
          <span className="underline">U</span>
        </Btn>
        <Btn onMouseDown={() => actions.toggleStrike()} active={actions.isActive('strike')} title="Strikethrough">
          <span className="line-through">S</span>
        </Btn>
        <Btn onMouseDown={() => actions.toggleCode()} active={actions.isActive('code')} title="Inline code (⌘E)">
          <span className="font-mono text-xs">{'</>'}</span>
        </Btn>

        <Sep />

        <Btn onMouseDown={insertLink} active={actions.isActive('link')} title="Link (⌘K)">
          <LinkIcon />
        </Btn>

        <Sep />

        <Btn onMouseDown={() => actions.toggleBulletList()} active={actions.isActive('bulletList')} title="Bullet list">
          <span className="font-bold">•</span>
        </Btn>
        <Btn onMouseDown={() => actions.toggleOrderedList()} active={actions.isActive('orderedList')} title="Numbered list">
          <span className="text-xs">1.</span>
        </Btn>
        <Btn onMouseDown={() => actions.toggleTaskList()} active={actions.isActive('taskList')} title="Task list">
          <span className="text-xs">☐</span>
        </Btn>
        <Btn onMouseDown={() => actions.toggleBlockquote()} active={actions.isActive('blockquote')} title="Blockquote">
          <span className="text-xs">❝</span>
        </Btn>
        <Btn onMouseDown={() => actions.toggleCodeBlock()} active={actions.isActive('codeBlock')} title="Code block">
          <span className="font-mono text-xs">{'{}'}</span>
        </Btn>
        <Btn onMouseDown={() => actions.insertHr()} title="Horizontal rule">
          <span className="text-xs">—</span>
        </Btn>
        <Btn onMouseDown={() => actions.insertTable()} title="Insert table">
          <TableIcon />
        </Btn>

        <Sep />

        <Btn onMouseDown={() => actions.undo()} disabled={!actions.canUndo()} title="Undo (⌘Z)">
          <span className="text-xs">↶</span>
        </Btn>
        <Btn onMouseDown={() => actions.redo()} disabled={!actions.canRedo()} title="Redo (⌘⇧Z)">
          <span className="text-xs">↷</span>
        </Btn>
        {onShowHistory && (
          <Btn onMouseDown={onShowHistory} title="Version history">
            <span className="text-xs">◷</span>
          </Btn>
        )}

        {extras && (extras.insertComponent || extras.toggleViewSource || extras.toggleLock) && (
          <>
            <Sep />
            {extras.insertComponent && (
              <Btn onMouseDown={extras.insertComponent} title="Insert component">
                <span className="text-xs">＋▦</span>
              </Btn>
            )}
            {extras.toggleViewSource && (
              <Btn onMouseDown={extras.toggleViewSource} title="View source">
                <span className="font-mono text-[10px]">{'<>'}</span>
              </Btn>
            )}
            {extras.toggleLock && (
              <Btn onMouseDown={extras.toggleLock} title="Lock / unlock element">
                <span className="text-xs">🔒</span>
              </Btn>
            )}
          </>
        )}

        {/* Sprint 6 BUG-081 — discoverable Comment affordance. Replaces
            the hover Comment pill with an always-present toolbar
            button, gated to disabled when there's no selection with a
            duo-id anchor. Mirrors Google Docs' toolbar comment icon.
            Hidden entirely when the host doesn't wire comments
            (markdown side until Phase 4 / MISSING-001 lands). */}
        {actions.startComment && (
          <>
            <Sep />
            <Btn
              onMouseDown={() => actions.startComment?.()}
              disabled={!(actions.canStartComment?.() ?? false)}
              title="Comment (⌘⌥M)"
            >
              <span className="text-xs">💬</span>
            </Btn>
          </>
        )}

        {/* BUG-138 Phase 4 — Suggesting mode toggle. Fixed-width icon
            button (matches the rest of the toolbar's footprint) so
            narrow canvases don't wrap the toolbar. Active state goes
            through the standard Btn `active` prop → accent color +
            surface-3 fill, matching every other toggle. The little
            corner dot on the icon makes the "ON" state legible from
            a glance even before the color cue lands. */}
        {actions.toggleSuggesting && (
          <>
            <Sep />
            <Btn
              onMouseDown={() => actions.toggleSuggesting?.()}
              active={!!actions.suggestingOn}
              title={actions.suggestingOn ? 'Suggesting: ON — typing wraps as track-changes (⌘⌥T)' : 'Suggesting (⌘⌥T)'}
            >
              <SuggestIcon active={!!actions.suggestingOn} />
            </Btn>
          </>
        )}

        <div className="ml-auto flex items-center">
          <SaveControl
            dirty={dirty}
            saving={saving}
            saveError={saveError}
            autosaveOn={autosaveOn}
            onToggleAutosave={onToggleAutosave}
            onSave={onSave}
          />
        </div>
      </div>

      {inTable && tableOps && (
        <div className="flex items-center h-9 gap-1 px-2 border-t border-border bg-surface-2 text-zinc-300 text-xs overflow-x-auto">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 mr-2">Table</span>
          <Btn small onMouseDown={() => tableOps.addRowBefore()} disabled={!tableOps.canAddRowBefore()} title="Insert row above (⌥⇧↑)">
            ↑＋
          </Btn>
          <Btn small onMouseDown={() => tableOps.addRowAfter()} disabled={!tableOps.canAddRowAfter()} title="Insert row below (⌥⇧↓)">
            ↓＋
          </Btn>
          <Btn small onMouseDown={() => tableOps.deleteRow()} disabled={!tableOps.canDeleteRow()} title="Delete row">
            ✕row
          </Btn>
          <Sep />
          <Btn small onMouseDown={() => tableOps.addColumnBefore()} disabled={!tableOps.canAddColumnBefore()} title="Insert column left (⌥⇧←)">
            ←＋
          </Btn>
          <Btn small onMouseDown={() => tableOps.addColumnAfter()} disabled={!tableOps.canAddColumnAfter()} title="Insert column right (⌥⇧→)">
            →＋
          </Btn>
          <Btn small onMouseDown={() => tableOps.deleteColumn()} disabled={!tableOps.canDeleteColumn()} title="Delete column">
            ✕col
          </Btn>
          <Sep />
          <Btn small onMouseDown={() => tableOps.toggleHeaderRow()} disabled={!tableOps.canToggleHeaderRow()} title="Toggle header row">
            Header
          </Btn>
          <Btn small onMouseDown={() => tableOps.deleteTable()} disabled={!tableOps.canDeleteTable()} title="Delete table">
            ✕table
          </Btn>
        </div>
      )}
    </div>
  )
}

function Btn({
  onMouseDown, active, disabled, title, children, small
}: {
  onMouseDown: () => void
  active?: boolean
  disabled?: boolean
  title: string
  children: React.ReactNode
  small?: boolean
}) {
  return (
    <button
      // mousedown so we don't lose the editor / iframe selection to a
      // focus shift before the action runs.
      onMouseDown={(e) => {
        e.preventDefault()
        if (!disabled) onMouseDown()
      }}
      disabled={disabled}
      title={title}
      className={[
        small
          ? 'min-w-7 h-6 px-1.5 flex items-center justify-center rounded text-[11px]'
          : 'w-7 h-7 flex items-center justify-center rounded',
        'shrink-0 hover:bg-surface-3 disabled:opacity-40 disabled:hover:bg-transparent',
        active ? 'bg-surface-3 text-accent' : 'text-zinc-300'
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function Sep() {
  return <div className="w-px h-5 shrink-0 bg-border mx-1" />
}

function LinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

// BUG-138 Phase 4 — Suggesting mode icon. Lucide pencil-line + an
// accent indicator dot at the tip when active so the ON state is
// visible at a glance (Btn's accent color cue handles the rest).
function SuggestIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Pencil body — diagonal stroke down to the page line. */}
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
      {active && (
        // Small fill dot near the pencil tip — readable from a glance.
        <circle cx="4.5" cy="19.5" r="1.4" fill="currentColor" stroke="none" />
      )}
    </svg>
  )
}

function TableIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </svg>
  )
}
