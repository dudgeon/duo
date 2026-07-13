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

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  parseFrontmatter,
  displayValue,
  type FrontmatterValue
} from '../../../core/markdown/frontmatterParser'
import { useFrontmatterWikilink } from './useFrontmatterWikilink'
import { resolveMdLinkInVault, type VaultFile } from './wikilinkResolver'
import type { VaultMode } from './okfLinks'

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

// ENH-241 — frontmatter vault-link navigation. `[[wikilink]]` (alt 1) and
// `[label](href)` markdown links (alt 2). Wikilinks are matched FIRST so a
// `[[Foo]]` is never mis-parsed as a `[…]( … )` md-link.
const FM_LINK_RE = /\[\[([^\]\n]+)\]\]|\[([^\]\n]*)\]\(([^)\n]+)\)/g

export type FmLinkToken =
  | { kind: 'text'; text: string }
  | { kind: 'wikilink'; raw: string; target: string }
  | { kind: 'mdlink'; raw: string; label: string; href: string }

/**
 * ENH-241 — split a frontmatter value string into plain-text + vault-link
 * tokens. Pure (no DOM, no fs) so the parsing is unit-testable independently of
 * React. The md-link's in-vault resolvability is decided at render time (needs
 * the doc path); here we only classify the syntax.
 */
export function tokenizeFrontmatterLinks(text: string): FmLinkToken[] {
  const tokens: FmLinkToken[] = []
  let last = 0
  let m: RegExpExecArray | null
  FM_LINK_RE.lastIndex = 0
  while ((m = FM_LINK_RE.exec(text)) !== null) {
    if (m.index > last) tokens.push({ kind: 'text', text: text.slice(last, m.index) })
    if (m[1] !== undefined) {
      tokens.push({ kind: 'wikilink', raw: m[0], target: m[1] })
    } else {
      tokens.push({ kind: 'mdlink', raw: m[0], label: m[2], href: m[3] })
    }
    last = m.index + m[0].length
  }
  if (last < text.length) tokens.push({ kind: 'text', text: text.slice(last) })
  return tokens
}

/** cmd/ctrl+click navigates; a plain click falls through to the row's
 *  expand/collapse toggle — the same modifier convention as the body editor
 *  (WikilinkDecorations / MarkdownEditor handleClickOn). Structural param type
 *  so we don't shadow the file's DOM-`MouseEvent` usage. */
function navigateFmLink(
  e: { metaKey: boolean; ctrlKey: boolean; preventDefault: () => void; stopPropagation: () => void },
  detail: { target: string; resolvedPath?: string }
): void {
  if (!(e.metaKey || e.ctrlKey)) return
  e.preventDefault()
  e.stopPropagation()
  // The SAME event App.tsx's global handler resolves (mode-aware, create-on-
  // missing). `[[ ]]` → { target }; md-link → { target: href, resolvedPath }.
  window.dispatchEvent(new CustomEvent('duo-wikilink-open', { detail }))
}

/**
 * ENH-241 — render a frontmatter value string with cmd+click-navigable vault
 * links, mirroring the body-link convention. `[[wikilinks]]` always render as
 * links; `[label](href)` md-links render as links only when they resolve INSIDE
 * the vault (external / anchor-only hrefs → `resolveMdLinkInVault` returns null
 * → left as literal text, never hijacked). Reuses the `.duo-wikilink` style.
 */
function renderLinkedText(text: string, docPath: string | undefined): ReactNode {
  const nodes: ReactNode[] = []
  let key = 0
  for (const tok of tokenizeFrontmatterLinks(text)) {
    if (tok.kind === 'text') {
      nodes.push(tok.text)
    } else if (tok.kind === 'wikilink') {
      nodes.push(
        <span
          key={`fl${key++}`}
          className="duo-wikilink cursor-pointer"
          data-duo-frontmatter-link="wikilink"
          data-duo-wikilink-target={tok.target}
          title="⌘-click to open"
          onClick={(e) => navigateFmLink(e, { target: tok.target })}
        >
          {tok.raw}
        </span>
      )
    } else {
      // md-link — clickable only when it resolves INSIDE the vault; external /
      // anchor-only hrefs (resolveMdLinkInVault → null) stay literal text.
      const resolved = docPath ? resolveMdLinkInVault(tok.href, docPath) : null
      if (resolved) {
        nodes.push(
          <span
            key={`fl${key++}`}
            className="duo-wikilink cursor-pointer"
            data-duo-frontmatter-link="mdlink"
            data-duo-mdlink-href={tok.href}
            title="⌘-click to open"
            onClick={(e) => navigateFmLink(e, { target: tok.href, resolvedPath: resolved })}
          >
            {tok.label || tok.href}
          </span>
        )
      } else {
        nodes.push(tok.raw)
      }
    }
  }
  return nodes
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
  /** FOLLOWUP-050 — live `[[ ]]` autocomplete in the raw-YAML editor, at
   *  parity with the body gesture. These are the SAME vault-index sources
   *  MarkdownEditor threads into the body WikilinkSuggestion. When absent,
   *  the panel renders no live popover (the textarea still edits raw YAML).
   *  ENH-266 — a picked note now writes a QUOTED markdown link in OKF mode
   *  (see `vaultMode` below); Obsidian keeps the unquoted `[[ ]]` form. */
  vaultFiles?: VaultFile[]
  vaultLoading?: boolean
  vaultRoot?: string | null
  onVaultRefresh?: () => void
  /** ENH-266 — the active vault's at-rest link mode (D4), threaded into the
   *  frontmatter `[[ ]]` gesture so an OKF pick writes a quoted markdown
   *  link instead of a wikilink. Defaults to `'obsidian'` (unchanged
   *  behavior) when absent. */
  vaultMode?: VaultMode
  /** ENH-241 — the open doc's absolute path, used to resolve `[md](rel.md)`
   *  frontmatter links relative to it (the `[[ ]]` path doesn't need it; App.tsx
   *  walks from the active doc). Absent → md-links render as plain text.
   *  ENH-266 — ALSO the rel-link base for a new OKF frontmatter pick. */
  docPath?: string
}

export function FrontmatterPanel({
  frontmatter,
  onChange,
  collapsed,
  onToggleCollapsed,
  vaultFiles,
  vaultLoading,
  vaultRoot,
  onVaultRefresh,
  vaultMode,
  docPath
}: Props) {
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

  // FOLLOWUP-050 — programmatic draft update mirroring the textarea's
  // onChange (set + live re-validate), used by the autocomplete inserts.
  const setDraftValidated = useCallback((next: string) => {
    setDraft(next)
    const r = parseFrontmatter(next)
    setParseError(r.valid ? '' : r.error)
  }, [])

  // FOLLOWUP-050 — live `[[ ]]` autocomplete in the raw-YAML textarea,
  // reusing the body editor's popover / ranking / type-picker (parity with
  // the body gesture). Inert (no popover) until the host threads the vault
  // index in.
  const fmWikilink = useFrontmatterWikilink({
    textareaRef,
    setValue: setDraftValidated,
    vaultFiles: vaultFiles ?? [],
    vaultLoading: vaultLoading ?? false,
    vaultRoot: vaultRoot ?? null,
    onVaultRefresh,
    vaultMode,
    docPath
  })

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
      // FOLLOWUP-050 — the autocomplete popover / type picker portal to
      // document.body (outside the panel); a click there must NOT commit.
      const t = e.target as Element | null
      if (t && typeof t.closest === 'function' && t.closest('.duo-suggestion-popover')) return
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
    // ENH-266 — the `[[ ]]` gesture already writes the mode-correct final
    // form at insert time (quoted markdown link for OKF, wikilink for
    // Obsidian — see useFrontmatterWikilink); commit stays a plain
    // synchronous validate + propagate, no save-time rewrite.
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
        data-duo-frontmatter-path={docPath ?? ''}
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
      data-duo-frontmatter-path={docPath ?? ''}
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
              // BUG-139 v1.2 (walk-1 owner note) — auto-grow the edit
              // pane up to 10 lines when the frontmatter is long.
              // Clamp [4, 10]; below 4 keeps the pane usable when
              // editing a small block, above 10 scrollbars take over.
              rows={Math.max(4, Math.min(10, draft.split('\n').length))}
              onChange={(e) => {
                // Re-validate live so the error message clears as the user
                // fixes the YAML, then re-evaluate the `[[ ]]` trigger.
                setDraftValidated(e.target.value)
                fmWikilink.onInput()
              }}
              onKeyDown={(e) => {
                // FOLLOWUP-050 — let the autocomplete consume nav/select/Esc
                // first; only fall through to the panel's own keys when it
                // didn't handle them.
                if (fmWikilink.onKeyDown(e)) return
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
            {fmWikilink.overlay}
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
                  docPath={docPath}
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
  /** ENH-241 — open doc path, for resolving `[md](rel.md)` links in values. */
  docPath?: string
}

function PropertyRow({ k, v, expanded, onToggle, docPath }: RowProps) {
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
          {renderLinkedText(expandedValue(v), docPath)}
        </pre>
      ) : (
        <span className="text-zinc-400 font-mono truncate flex-1">{renderLinkedText(displayValue(v), docPath)}</span>
      )}
    </div>
  )
}
