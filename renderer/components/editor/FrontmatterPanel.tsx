// BUG-139 — Properties panel. Renders YAML frontmatter as a
// structured key:value list with a chevron-to-collapse header. The
// "Edit raw" button flips the body into a textarea for free-form
// editing; click-outside or the Save button commits.
//
// Fix shape: B · Collapsible panel + raw-YAML toggle.
//
// Lifecycle:
//   - MarkdownEditor passes the current `frontmatter` string + a
//     setter (`onChange`). Empty/null frontmatter renders the
//     "+ Add properties" call-to-action.
//   - Local state holds the textarea draft + whether we're in raw
//     edit mode. On commit (Save / click-outside / blur), validate
//     via parseFrontmatter; if invalid, surface the error inline and
//     stay in edit mode. If valid, propagate via onChange.
//   - The collapsed/expanded state is driven by props so it can
//     persist in the sidecar (BUG-139c).

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  parseFrontmatter,
  displayValue,
  type FrontmatterValue
} from '../../../core/markdown/frontmatterParser'

/**
 * BUG-139 v1.1 Q5 — expanded-row display formatter.
 *
 * Strings render verbatim (preserves newlines if any).
 * Arrays + objects pretty-print with 2-space indent so the multi-line
 * expansion gives the user something readable. Falls back to
 * `displayValue` for primitives.
 */
function expandedValue(value: FrontmatterValue): string {
  if (value === null || value === undefined) return '∅'
  if (typeof value === 'string') return value
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

interface Props {
  /** Current YAML frontmatter text (without the `---` fences). `null`
   *  means the file has no frontmatter block. */
  frontmatter: string | null
  /** Commit a new YAML string. `null` to clear the frontmatter block
   *  (caller decides whether to also strip the `---` fences via
   *  `joinFrontmatter` semantics — passing `null` is the "remove
   *  frontmatter" path). */
  onChange: (next: string | null) => void
  /** Persisted collapsed state from the sidecar. */
  collapsed: boolean
  onToggleCollapsed: () => void
}

export function FrontmatterPanel({ frontmatter, onChange, collapsed, onToggleCollapsed }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string>('')
  const [parseError, setParseError] = useState<string>('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  // BUG-139 v1.1 Q5 — per-row expand state for click-to-expand long
  // values. Ephemeral; not persisted to the sidecar. Reset on
  // remount, which is acceptable — the typical expand session is
  // measured in seconds.
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set())
  const toggleRow = useCallback((key: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // Sync draft from props whenever we enter edit mode or the
  // frontmatter changes externally (e.g. an agent writes the file).
  useEffect(() => {
    if (editing) {
      setDraft(frontmatter ?? '')
      setParseError('')
      // Focus the textarea on entry.
      const ta = textareaRef.current
      if (ta) {
        ta.focus()
        ta.setSelectionRange(ta.value.length, ta.value.length)
      }
    }
  }, [editing, frontmatter])

  // Click-outside commits the draft (or surfaces a parse error and
  // keeps the panel open). Only attached while editing.
  useEffect(() => {
    if (!editing) return
    const handler = (e: MouseEvent) => {
      const panel = panelRef.current
      if (!panel) return
      if (panel.contains(e.target as Node)) return
      commit()
    }
    // Defer the listener so the click that opened edit mode doesn't
    // immediately fire it.
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', handler)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, draft])

  const commit = useCallback(() => {
    const result = parseFrontmatter(draft)
    if (!result.valid) {
      setParseError(result.error)
      return
    }
    setParseError('')
    setEditing(false)
    // Trim trailing newlines so the joined output is canonical.
    const next = draft.replace(/\r?\n+$/, '')
    onChange(next.length > 0 ? next : null)
  }, [draft, onChange])

  const cancel = useCallback(() => {
    setEditing(false)
    setParseError('')
    setDraft(frontmatter ?? '')
  }, [frontmatter])

  // Empty / no-frontmatter case → "+ Add properties" affordance.
  // Doesn't show the chevron because there's nothing to collapse.
  const parsed = parseFrontmatter(frontmatter)
  const isEmpty = parsed.empty
  const entries = parsed.parsed ? Object.entries(parsed.parsed) : []

  if (isEmpty && !editing) {
    return (
      <div
        className="flex items-center h-7 px-3 border-b border-border bg-surface-1 text-[11px] text-zinc-500 shrink-0"
        data-duo-frontmatter-panel="empty"
      >
        <button
          type="button"
          className="text-zinc-400 hover:text-accent transition-colors"
          onMouseDown={(e) => {
            e.preventDefault()
            setDraft('title: ')
            setEditing(true)
          }}
          title="Add a YAML frontmatter block"
        >
          + Add properties
        </button>
      </div>
    )
  }

  return (
    <div
      ref={panelRef}
      className="flex flex-col border-b border-border bg-surface-1 shrink-0"
      data-duo-frontmatter-panel={editing ? 'editing' : 'view'}
      data-duo-frontmatter-collapsed={collapsed ? 'true' : 'false'}
    >
      {/* Header — chevron + count + edit toggle */}
      <div className="flex items-center h-7 px-3 gap-2 text-[11px]">
        <button
          type="button"
          className="text-zinc-400 hover:text-zinc-200 flex items-center gap-1"
          onMouseDown={(e) => {
            e.preventDefault()
            onToggleCollapsed()
          }}
          title={collapsed ? 'Expand properties' : 'Collapse properties'}
        >
          <span className={`inline-block transition-transform ${collapsed ? '' : 'rotate-90'}`}>›</span>
          <span className="font-medium uppercase tracking-wider text-zinc-500">
            Properties {entries.length > 0 && <span className="text-zinc-400">({entries.length})</span>}
          </span>
        </button>
        <div className="ml-auto flex items-center gap-1">
          {editing ? (
            <>
              <button
                type="button"
                className="px-2 py-0.5 rounded text-[10px] text-emerald-400 hover:bg-emerald-500/15"
                onMouseDown={(e) => { e.preventDefault(); commit() }}
                title="Save (Cmd-Enter)"
              >
                Save
              </button>
              <button
                type="button"
                className="px-2 py-0.5 rounded text-[10px] text-zinc-400 hover:text-zinc-200 hover:bg-surface-3"
                onMouseDown={(e) => { e.preventDefault(); cancel() }}
                title="Cancel (Esc)"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="px-2 py-0.5 rounded text-[10px] text-zinc-400 hover:text-accent hover:bg-surface-3"
              onMouseDown={(e) => {
                e.preventDefault()
                setDraft(frontmatter ?? '')
                setEditing(true)
              }}
              title="Edit raw YAML"
            >
              Edit raw
            </button>
          )}
        </div>
      </div>

      {/* Body — structured rows OR raw textarea */}
      {!collapsed && (
        editing ? (
          <div className="flex flex-col px-3 pb-2 gap-1">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                // Re-validate live so the error message clears as
                // the user fixes the YAML.
                const r = parseFrontmatter(e.target.value)
                setParseError(r.valid ? '' : r.error)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  cancel()
                } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  commit()
                }
              }}
              className="w-full font-mono text-[12px] bg-surface-2 border border-border rounded px-2 py-1 text-zinc-200 focus:outline-none focus:border-accent/60 resize-y min-h-[64px]"
              spellCheck={false}
              placeholder="title: …"
              data-duo-frontmatter-textarea="1"
            />
            {parseError && (
              <div className="text-[11px] text-rose-400 font-mono pl-1" data-duo-frontmatter-error="1">
                {parseError}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col px-3 pb-1.5 gap-0.5">
            {entries.length === 0 ? (
              <div className="text-[11px] text-zinc-500 italic pl-1">
                (empty)
              </div>
            ) : (
              entries.map(([key, value]) => (
                <PropertyRow
                  key={key}
                  k={key}
                  v={value}
                  expanded={expandedRows.has(key)}
                  onToggle={() => toggleRow(key)}
                />
              ))
            )}
          </div>
        )
      )}
    </div>
  )
}

interface RowProps {
  k: string
  v: FrontmatterValue
  expanded: boolean
  onToggle: () => void
}

function PropertyRow({ k, v, expanded, onToggle }: RowProps) {
  // BUG-139 v1.1 Q5 — clicking the row toggles expanded state.
  // Collapsed: existing single-line truncated display.
  // Expanded: multi-line view with a left accent border; arrays /
  // objects pretty-print with 2-space indent.
  const handleClick = useCallback(() => onToggle(), [onToggle])
  return (
    <div
      className={
        'flex gap-3 text-[12px] py-0.5 rounded -mx-1 px-1 cursor-pointer ' +
        'hover:bg-surface-2/50 transition-colors ' +
        (expanded
          ? 'items-start border-l-2 border-accent/60 pl-2 bg-surface-2/30'
          : 'items-baseline')
      }
      data-duo-frontmatter-row="1"
      data-duo-key={k}
      data-duo-expanded={expanded ? 'true' : 'false'}
      onClick={handleClick}
      title={expanded ? 'Click to collapse' : 'Click to expand'}
    >
      <span className="font-medium text-zinc-300 min-w-[100px] shrink-0">{k}</span>
      {expanded ? (
        <pre className="text-zinc-300 font-mono flex-1 whitespace-pre-wrap break-words m-0 leading-snug">
          {expandedValue(v)}
        </pre>
      ) : (
        <span className="text-zinc-400 font-mono truncate flex-1">{displayValue(v)}</span>
      )}
    </div>
  )
}
