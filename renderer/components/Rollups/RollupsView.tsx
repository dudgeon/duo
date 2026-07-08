// ENH-243 — the Rollups tab: a master–detail rollup viewer/editor (PRD D1).
//
//   left rail   — every rollup in the vault + "New rollup" (collapsible)
//   center      — the selected rollup evaluated LIVE against the corpus,
//                 grouped at every `group_by:` depth (D5); hover a row for
//                 its vault path, click to open it in Duo (D6)
//   inspector   — "Roll Up" (owner-named), stacked (collapsible):
//                 the definition builder (types → ordered group levels →
//                 filters → columns; every change saves + re-renders, D9)
//                 and the frontmatter flip subpane for the ✎-selected row
//                 (instant apply + undo toast, D2)
//
// Data flows over the ENH-243 vault IPC (schema / rollupView / rollupSave /
// entityPanel / setFrontmatter) — the same core/vault builder layer as the
// `duo rollup new|show|set|doctor` verbs. Tab-opening + the doctor's
// session-spawn route through window CustomEvents (the VaultView pattern);
// App owns the machinery. `isActive` gates all fetching (BUG-046 lineage).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  EntityPanelDto,
  EntityRefDto,
  RollupFilterDto,
  RollupModelDto,
  RollupViewDataDto,
  RollupViewRowDto,
  VaultRollupDto,
  VaultSchemaDto,
} from '@shared/host-api'
import type { MenuTemplateItem } from '@shared/types'
import './Rollups.css'

function emit(name: string, detail: unknown): void {
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

const POLL_MS = 30_000
const COLLAPSE_KEY = 'duo-rollups-collapsed' // JSON {left?: boolean, right?: boolean}

function readCollapsed(): { left: boolean; right: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}')
    return { left: !!v.left, right: !!v.right }
  } catch {
    return { left: false, right: false }
  }
}

/** R3 — "checked just now / 40s ago / 3m ago" for the refresh feedback. */
function fmtCheckedAgo(at: number): string {
  const s = Math.floor((Date.now() - at) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`
}

const OPS: { value: RollupFilterDto['op']; label: string }[] = [
  { value: 'eq', label: 'is' },
  { value: 'ne', label: 'is not' },
  // ENH-255 — membership on a multi-valued field; a list-of-links field
  // matches on the linked note's identity, not its display text.
  { value: 'contains', label: 'has member' },
  { value: 'set', label: 'is set' },
  { value: 'notset', label: 'is not set' },
]

/** Ops whose filter takes a value operand. */
const VALUE_OPS = new Set<RollupFilterDto['op']>(['eq', 'ne', 'contains'])

/** One flip's undo memo — what to write back to restore the prior value. */
interface UndoMemo {
  notePath: string
  key: string
  prev: string | number | boolean | null
  label: string
}

export function RollupsView({ isActive }: { isActive: boolean }) {
  const [defaultVault, setDefaultVault] = useState<string | null>(null)
  const [rollups, setRollups] = useState<VaultRollupDto[]>([])
  const [schema, setSchema] = useState<VaultSchemaDto | null>(null)
  const [selected, setSelected] = useState<string | null>(null) // note rel path
  const [view, setView] = useState<RollupViewDataDto | null>(null)
  const [panel, setPanel] = useState<EntityPanelDto | null>(null)
  const [undo, setUndo] = useState<UndoMemo | null>(null)
  const [error, setError] = useState<string | null>(null)
  // ENH-248 R3 — the Refresh button's feedback: in-flight state, when the
  // last check landed, and how the row count moved (a silent click was
  // indistinguishable from a no-op — the owner's exact walk complaint).
  const [refreshState, setRefreshState] = useState<{
    busy: boolean
    at: number | null
    delta: number | null
  }>({ busy: false, at: null, delta: null })
  // ENH-248 R7 — an ephemeral type view (the Vault tab's Entities section
  // click-through): every entity of ONE type, evaluated live, no note
  // behind it until "Save as rollup".
  const [browseType, setBrowseType] = useState<string | null>(null)
  // ENH-250 (gap #3) — the note just created by "+ New rollup", so the
  // builder can auto-focus + select its Title field once (renaming is
  // the natural first action after creating an "Untitled rollup").
  const [justCreatedNote, setJustCreatedNote] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(readCollapsed)

  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // ENH-250 (gap #5) — "Edit" in the Vault tab's rollup row dispatches this
  // (via App.tsx, which also switches the active tab to Rollups) so the
  // just-clicked rollup is selected here. UNCONDITIONAL — not gated on
  // isActive: the tab-switch and this dispatch happen in the same event
  // handler, before React commits the isActive prop flip, so an
  // isActive-gated listener would miss it. The component stays mounted
  // (display:none when hidden), so this is safe to always attach.
  useEffect(() => {
    const onSelect = (e: Event) => {
      const d = (e as CustomEvent<{ note: string }>).detail
      if (d?.note) {
        setBrowseType(null)
        setSelected(d.note)
      }
    }
    window.addEventListener('duo-rollups-select', onSelect)
    return () => window.removeEventListener('duo-rollups-select', onSelect)
  }, [])

  // ENH-248 R7 — the Vault tab's Entities section click-through (relayed by
  // App with the tab-switch, like duo-rollups-select above — unconditional
  // for the same commit-timing reason).
  useEffect(() => {
    const onBrowse = (e: Event) => {
      const d = (e as CustomEvent<{ vaultRoot?: string; type?: string }>).detail
      if (!d?.type) return
      if (d.vaultRoot) setDefaultVault((cur) => cur ?? d.vaultRoot ?? null)
      setSelected(null)
      setBrowseType(d.type)
    }
    window.addEventListener('duo-rollups-browse-type', onBrowse)
    return () => window.removeEventListener('duo-rollups-browse-type', onBrowse)
  }, [])

  const setCollapse = useCallback((side: 'left' | 'right', v: boolean) => {
    setCollapsed((prev) => {
      const next = { ...prev, [side]: v }
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next))
      } catch {
        /* persistence is best-effort */
      }
      return next
    })
  }, [])

  // ── default vault (same gate + broadcast as VaultView) ──────────────────
  const fetchDefault = useCallback(async () => {
    try {
      const r = await window.electron.vault.getDefault()
      if (aliveRef.current) setDefaultVault(r.defaultVault)
    } catch {
      /* leave prior state */
    }
  }, [])

  useEffect(() => {
    if (!isActive) return
    void fetchDefault()
    const onChanged = () => void fetchDefault()
    window.addEventListener('duo-vault-default-changed', onChanged)
    return () => window.removeEventListener('duo-vault-default-changed', onChanged)
  }, [isActive, fetchDefault])

  // ── list + schema + view fetches ─────────────────────────────────────────
  const fetchList = useCallback(async () => {
    if (!defaultVault) return
    try {
      const [listRes, schemaRes] = await Promise.all([
        window.electron.vault.listRollups({ vaultRoot: defaultVault }),
        window.electron.vault.schema({ vaultRoot: defaultVault }),
      ])
      if (!aliveRef.current) return
      if (listRes.ok) {
        setRollups(listRes.rollups)
        setError(null)
        // Auto-select the first rollup when nothing is selected yet — but
        // never while an ephemeral type view (R7) holds the center.
        if (!browseType) setSelected((cur) => cur ?? listRes.rollups[0]?.note ?? null)
      } else {
        setError(listRes.error)
      }
      if (schemaRes.ok) setSchema(schemaRes.schema)
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : String(e))
    }
  }, [defaultVault, browseType])

  // Returns the fetched row count (R3's delta feedback) or null on failure.
  const fetchView = useCallback(async (): Promise<number | null> => {
    if (!defaultVault || (!selected && !browseType)) {
      setView(null)
      return null
    }
    try {
      // R7 — an ephemeral type view has no note; it evaluates a synthetic
      // single-type model through the same engine (vault:type-view).
      const res = browseType
        ? await window.electron.vault.typeView({ vaultRoot: defaultVault, type: browseType })
        : await window.electron.vault.rollupView({ vaultRoot: defaultVault, note: selected! })
      if (!aliveRef.current) return null
      if (res.ok) {
        setView(res.data)
        return res.data.rows.length
      }
      setError(res.error)
      return null
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : String(e))
      return null
    }
  }, [defaultVault, selected, browseType])

  // R3 — the header Refresh: same reads as the poll, but with visible
  // feedback (busy state, "checked Xs ago", row-count delta).
  // ENH-248 walk-2 fix — Refresh also RE-RENDERS the selected rollup's
  // artifact when it has gone stale. The original split (editor Refresh =
  // re-evaluate only; artifact re-render = the page toolbar's job) read as
  // broken on the walk: "these rollups seem to stay stale, even when I
  // click 'refresh'". The user's mental model of Refresh is "make this
  // rollup current" — so one click now does exactly that, and the
  // freshness chips (here + Vault tab, via duo-vault-refresh) follow.
  const refreshAll = useCallback(async () => {
    setRefreshState((s) => ({ ...s, busy: true }))
    const prev = view?.rows.length ?? null
    if (defaultVault && selected && view && !view.error && view.stale !== false) {
      try {
        await window.electron.vault.rollupRender({ vaultRoot: defaultVault, note: selected })
        window.dispatchEvent(new CustomEvent('duo-vault-refresh'))
      } catch {
        /* the re-evaluate below still runs; a render failure shows via view.stale */
      }
    }
    const [, count] = await Promise.all([fetchList(), fetchView()])
    if (!aliveRef.current) return
    setRefreshState({
      busy: false,
      at: Date.now(),
      delta: prev != null && count != null ? count - prev : null,
    })
  }, [fetchList, fetchView, view, defaultVault, selected])

  useEffect(() => {
    if (!isActive || !defaultVault) return
    void fetchList()
    const id = setInterval(() => void fetchList(), POLL_MS)
    return () => clearInterval(id)
  }, [isActive, defaultVault, fetchList])

  useEffect(() => {
    if (!isActive) return
    void fetchView()
    const id = setInterval(() => void fetchView(), POLL_MS)
    return () => clearInterval(id)
  }, [isActive, fetchView])

  // Selecting a different rollup (or entering/leaving a type view) drops the
  // row selection + any pending undo.
  useEffect(() => {
    setPanel(null)
    setUndo(null)
  }, [selected, browseType])

  // ── actions ──────────────────────────────────────────────────────────────
  // ENH-251 — the Vault tab's "+ New rollup" NOW defaults to triggering
  // this (via the 'duo-rollups-new' listener below) instead of spawning a
  // Claude session. That trigger can land BEFORE this tab was ever active
  // — `defaultVault`/`schema` local state may still be unset (both are
  // isActive-gated fetches). `vaultRootOverride` carries the vault the
  // caller already knows is valid; schema is fetched live when missing
  // rather than silently no-op'ing on a first-ever visit.
  const onNewRollup = useCallback(async (vaultRootOverride?: string) => {
    const root = vaultRootOverride ?? defaultVault
    if (!root) return
    // Sync local state so the isActive-gated fetchView/fetchList polling
    // (which reads defaultVault from ITS OWN closure) works once this tab
    // becomes active — without this, a first-ever-visit trigger leaves
    // defaultVault null and the view stays stuck showing nothing.
    if (root !== defaultVault) setDefaultVault(root)
    let sch = schema
    if (!sch) {
      try {
        const schemaRes = await window.electron.vault.schema({ vaultRoot: root })
        if (!schemaRes.ok) {
          setError(schemaRes.error)
          return
        }
        sch = schemaRes.schema
        if (aliveRef.current) setSchema(sch)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return
      }
    }
    const model: RollupModelDto = {
      title: 'Untitled rollup',
      types: [sch.types.find((t) => t !== 'rollup') ?? sch.types[0] ?? 'note'],
      groupBy: [],
      buckets: [],
      filters: [],
      columns: [],
    }
    try {
      const res = await window.electron.vault.rollupSave({ vaultRoot: root, model })
      if (res.ok && aliveRef.current) {
        // A direct listRollups (using `root`, not the outer fetchList's
        // possibly-stale `defaultVault` closure) — this call can run before
        // this tab's OWN defaultVault state has ever synced (see the
        // vaultRootOverride note above), and fetchList would silently
        // no-op in that case.
        const listRes = await window.electron.vault.listRollups({ vaultRoot: root })
        if (listRes.ok && aliveRef.current) setRollups(listRes.rollups)
        setBrowseType(null)
        setSelected(res.note)
        setJustCreatedNote(res.note)
        if (!res.rendered) setError(`Created, but the rollup couldn't render yet: ${res.renderError}`)
      } else if (!res.ok) {
        setError(res.error)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [defaultVault, schema])

  // ENH-251 — the Vault tab's "+ New rollup" (default click, not the
  // right-click Claude option) triggers this. UNCONDITIONAL — not gated on
  // isActive, for the same reason as the 'duo-rollups-select' listener
  // above: App's tab-switch and this dispatch happen in the same handler,
  // before React commits the isActive prop flip.
  useEffect(() => {
    const onNew = (e: Event) => {
      const d = (e as CustomEvent<{ vaultRoot?: string }>).detail
      void onNewRollup(d?.vaultRoot)
    }
    window.addEventListener('duo-rollups-new', onNew)
    return () => window.removeEventListener('duo-rollups-new', onNew)
  }, [onNewRollup])

  const saveModel = useCallback(
    async (model: RollupModelDto) => {
      if (!defaultVault || !selected) return
      try {
        const res = await window.electron.vault.rollupSave({
          vaultRoot: defaultVault,
          note: selected,
          model,
        })
        if (res.ok) {
          // Await these before deciding on a warning banner — fetchList's
          // success path clears the error, which would otherwise race a
          // warning set beforehand and silently clobber it back to null.
          await Promise.all([fetchView(), fetchList()]) // the title may have changed
          if (!res.rendered) setError(`Saved, but the re-render failed: ${res.renderError}`)
          else if (res.linksDegraded) {
            setError('Saved, but GitHub links could not be resolved (no repo / non-GitHub remote) — the rendered page uses relative links instead.')
          }
        } else {
          setError(res.error)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [defaultVault, selected, fetchView, fetchList],
  )

  const onOpenRow = useCallback((row: RollupViewRowDto) => {
    const name = row.path.slice(row.path.lastIndexOf('/') + 1) || row.path
    emit('duo-vault-open-note', { path: row.absPath, name })
  }, [])

  const onSelectRow = useCallback(
    async (row: RollupViewRowDto) => {
      if (!defaultVault) return
      try {
        const res = await window.electron.vault.entityPanel({
          vaultRoot: defaultVault,
          notePath: row.path,
        })
        if (res.ok && aliveRef.current) {
          setPanel(res.panel)
          setCollapse('right', false)
        } else if (!res.ok) {
          setError(res.error)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [defaultVault, setCollapse],
  )

  const applyFlip = useCallback(
    async (key: string, value: string | number | boolean | null, prevRaw: string, kind: string) => {
      if (!defaultVault || !panel) return
      // The undo memo restores the PRIOR typed value ('' → the key was unset).
      let prev: string | number | boolean | null = prevRaw
      if (prevRaw === '') prev = null
      else if (kind === 'bool') prev = prevRaw === 'true'
      else if (kind === 'number' && !Number.isNaN(Number(prevRaw))) prev = Number(prevRaw)
      try {
        const res = await window.electron.vault.setFrontmatter({
          vaultRoot: defaultVault,
          notePath: panel.note,
          updates: { [key]: value },
        })
        if (!res.ok) {
          setError(res.error)
          return
        }
        setUndo({ notePath: panel.note, key, prev, label: `${key} → ${value === null ? 'unset' : String(value)}` })
        void fetchView()
        void onSelectRowByPath(panel.note)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [defaultVault, panel, fetchView],
  )

  // Re-fetch the flip panel after a write (the row object may have re-grouped).
  const onSelectRowByPath = useCallback(
    async (notePath: string) => {
      if (!defaultVault) return
      try {
        const res = await window.electron.vault.entityPanel({ vaultRoot: defaultVault, notePath })
        if (res.ok && aliveRef.current) setPanel(res.panel)
      } catch {
        /* panel refresh is best-effort */
      }
    },
    [defaultVault],
  )

  const applyUndo = useCallback(async () => {
    if (!defaultVault || !undo) return
    try {
      const res = await window.electron.vault.setFrontmatter({
        vaultRoot: defaultVault,
        notePath: undo.notePath,
        updates: { [undo.key]: undo.prev },
      })
      if (res.ok) {
        setUndo(null)
        void fetchView()
        void onSelectRowByPath(undo.notePath)
      } else {
        setError(res.error)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [defaultVault, undo, fetchView, onSelectRowByPath])

  // (ENH-248 owner note — "Copy as Markdown" left this header: the rendered
  // artifact carries it, and that's where copying belongs. The CLI twin
  // `duo rollup markdown` remains.)

  const onDoctor = useCallback(() => {
    if (!defaultVault || !view) return
    emit('duo-rollups-doctor', { vaultRoot: defaultVault, note: view.note, error: view.error ?? '' })
  }, [defaultVault, view])

  // ENH-248 R5 — a hand-authored (view-only) rollup is valid but beyond the
  // builder's dialect. This primes a Claude session to NORMALIZE it —
  // rewrite the spec canonically with identical semantics — so it becomes
  // GUI-editable. App owns the spawn (same machinery as the doctor).
  const onNormalize = useCallback(() => {
    if (!defaultVault || !view) return
    emit('duo-rollups-normalize', { vaultRoot: defaultVault, note: view.note })
  }, [defaultVault, view])

  // ENH-248 (new req) — the under-title artifact link: open the rendered
  // rollup in Duo's browser pane.
  const openArtifact = useCallback(() => {
    if (!defaultVault || !view?.out) return
    const name = view.out.slice(view.out.lastIndexOf('/') + 1) || view.out
    emit('duo-vault-open-rollup', { path: `${defaultVault}/${view.out}`, name })
  }, [defaultVault, view])

  // ENH-248 R8 — persist the note's entity-link mode ('github' → blob URLs
  // in the rendered page). Rides the normal save path, so the artifact
  // re-renders with the new mode immediately.
  const saveLinks = useCallback(
    async (github: boolean) => {
      if (!defaultVault || !selected || !view?.model) return
      try {
        const res = await window.electron.vault.rollupSave({
          vaultRoot: defaultVault,
          note: selected,
          model: view.model,
          links: github ? 'github' : 'relative',
        })
        if (res.ok) {
          void fetchView()
          if (res.linksDegraded) {
            setError('GitHub links could not be resolved (no repo / non-GitHub remote) — the rendered page uses relative links instead.')
          }
        } else {
          setError(res.error)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [defaultVault, selected, view, fetchView],
  )

  // ENH-248 R7 — keep an ephemeral type view as a real rollup.
  const onSaveTypeView = useCallback(async () => {
    if (!defaultVault || !view?.model || !browseType) return
    try {
      const res = await window.electron.vault.rollupSave({
        vaultRoot: defaultVault,
        model: { ...view.model, title: `All ${browseType}s` },
      })
      if (res.ok) {
        setBrowseType(null)
        setSelected(res.note)
        setJustCreatedNote(res.note)
        void fetchList()
      } else {
        setError(res.error)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [defaultVault, view, browseType, fetchList])

  // ENH-248 R6 — rail-row lifecycle menu (right-click + the ⋯ button):
  // Duplicate / Reveal in navigator / Open definition note / Delete…
  // Native menu + native confirm (the ENH-050 patterns).
  const onRowMenu = useCallback(
    async (r: VaultRollupDto, x: number, y: number) => {
      if (!defaultVault) return
      const items: MenuTemplateItem[] = [
        { id: 'duplicate', label: 'Duplicate' },
        { id: 'reveal', label: 'Reveal in navigator' },
        { id: 'note', label: 'Open definition note' },
        { type: 'separator' },
        { id: 'delete', label: 'Delete…' },
      ]
      const res = await window.electron.menu.popup({ items, x, y })
      if (!res.chosenId) return
      if (res.chosenId === 'duplicate') {
        const d = await window.electron.vault.rollupDuplicate({ vaultRoot: defaultVault, note: r.note })
        if (d.ok) {
          setBrowseType(null)
          setSelected(d.note)
          void fetchList()
        } else {
          setError(d.error)
        }
      } else if (res.chosenId === 'reveal') {
        emit('duo-rollups-reveal', { absPath: r.absPath })
      } else if (res.chosenId === 'note') {
        const name = r.note.slice(r.note.lastIndexOf('/') + 1) || r.note
        emit('duo-vault-open-note', { path: r.absPath, name })
      } else if (res.chosenId === 'delete') {
        const confirm = await window.electron.dialog.confirm({
          title: `Delete rollup “${r.title}”?`,
          message:
            'Removes the definition note and its rendered page. File history keeps a restorable copy of the note.',
          buttons: ['Cancel', 'Delete'],
          defaultId: 1,
          cancelId: 0,
          type: 'warning',
        })
        if (confirm.response !== 1) return
        const d = await window.electron.vault.rollupDelete({ vaultRoot: defaultVault, note: r.note })
        if (d.ok) {
          setSelected((cur) => (cur === r.note ? null : cur))
          void fetchList()
          if (d.warning) setError(`Deleted the note, but couldn't remove its rendered artifact: ${d.warning}`)
        } else {
          setError(d.error)
        }
      }
    },
    [defaultVault, fetchList],
  )

  // ── render ───────────────────────────────────────────────────────────────
  if (!defaultVault) {
    return (
      <div className="duo-rollups" data-duo-tab-kind="rollups">
        <div className="duo-rollups-empty">
          No default vault is set. Set one with <code>duo vault default &lt;path&gt;</code> or
          Settings → Default Vault, and the rollup viewer lands here.
        </div>
      </div>
    )
  }

  return (
    <div className="duo-rollups" data-duo-tab-kind="rollups">
      {/* ── left rail ── */}
      {collapsed.left ? (
        <button
          type="button"
          className="duo-rollups-rail-expand"
          onClick={() => setCollapse('left', false)}
          title="Show the rollup list"
        >
          ▸
        </button>
      ) : (
        <aside className="duo-rollups-rail">
          <div className="duo-rollups-rail-head">
            <h2 className="duo-rollups-rail-title font-serif">Rollups</h2>
            <button
              type="button"
              className="duo-rollups-collapse"
              onClick={() => setCollapse('left', true)}
              title="Hide the rollup list"
            >
              ◂
            </button>
          </div>
          <ul className="duo-rollups-list">
            {rollups.map((r) => (
              <li key={r.note} className="duo-rollups-item-row">
                <button
                  type="button"
                  className={`duo-rollups-item${r.note === selected && !browseType ? ' selected' : ''}`}
                  onClick={() => {
                    setBrowseType(null)
                    setSelected(r.note)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    void onRowMenu(r, e.clientX, e.clientY)
                  }}
                  title={r.note}
                >
                  {r.title}
                </button>
                <button
                  type="button"
                  className="duo-rollups-item-menu"
                  title="Duplicate, reveal, open note, delete…"
                  onClick={(e) => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    void onRowMenu(r, rect.left, rect.bottom)
                  }}
                >
                  ⋯
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="duo-vault-btn duo-rollups-new" onClick={() => void onNewRollup()}>
            + New rollup
          </button>
        </aside>
      )}

      {/* ── center ── */}
      <section className="duo-rollups-main">
        <header className="duo-rollups-head">
          <div className="duo-rollups-head-titles">
            <h1 className="duo-rollups-title font-serif">
              {browseType ? `type: ${browseType}` : (view?.title ?? 'Rollups')}
            </h1>
            {/* ENH-248 (new req) — the rendered artifact's path, clickable:
                opens the rollup page in Duo's browser pane. */}
            {!browseType && view?.out ? (
              <button
                type="button"
                className="duo-rollups-outlink"
                onClick={openArtifact}
                title="Open the rendered rollup page in Duo"
              >
                {view.out}
                {view.stale ? ' · stale' : ''}
              </button>
            ) : null}
          </div>
          <div className="duo-rollups-head-actions">
            {/* R3 — refresh feedback: what the last check found, and when. */}
            {refreshState.at != null && !refreshState.busy ? (
              <span className="duo-rollups-checked" role="status">
                {refreshState.delta != null && refreshState.delta !== 0
                  ? `${refreshState.delta > 0 ? '+' : ''}${refreshState.delta} row${Math.abs(refreshState.delta) === 1 ? '' : 's'} · `
                  : 'no changes · '}
                checked {fmtCheckedAgo(refreshState.at)}
              </span>
            ) : null}
            <button
              type="button"
              className="duo-vault-btn"
              onClick={() => void refreshAll()}
              disabled={refreshState.busy}
              title="Re-read the vault and re-evaluate this view now (a background check also runs every 30s)"
            >
              {refreshState.busy ? 'Checking…' : '↻ Refresh'}
            </button>
            {collapsed.right ? (
              <button
                type="button"
                className="duo-vault-btn"
                onClick={() => setCollapse('right', false)}
                title="Show the Roll Up panel"
              >
                ◂ Roll Up
              </button>
            ) : null}
          </div>
        </header>
        {error ? <div className="duo-banner-warn duo-rollups-banner">{error}</div> : null}

        {!selected && !browseType ? (
          <div className="duo-rollups-empty">
            No rollups yet — “+ New rollup” creates one you can shape in the Roll Up panel.
          </div>
        ) : view?.error ? (
          <div className="duo-rollups-doctor">
            <div className="duo-banner-error duo-rollups-doctor-msg">
              This rollup’s config can’t be read: {view.error}
            </div>
            <p className="duo-rollups-doctor-hint">
              The config file (<code>{view.note}</code>) is machine-owned — instead of editing it by
              hand, let Claude repair it.
            </p>
            <button type="button" className="duo-vault-btn duo-rollups-doctor-btn" onClick={onDoctor}>
              Fix with Claude
            </button>
          </div>
        ) : view ? (
          <>
            {/* ENH-255 — a broken filter must never read as an empty rollup. */}
            {view.warnings.map((w) => (
              <div key={w} className="duo-banner-warn duo-rollups-banner">
                ⚠ {w}
              </div>
            ))}
            <GroupedRows view={view} onOpen={onOpenRow} onSelect={onSelectRow} selectedPath={panel?.note ?? null} />
          </>
        ) : (
          <div className="duo-rollups-empty">Loading…</div>
        )}
      </section>

      {/* ── right inspector: "Roll Up" ── */}
      {collapsed.right ? null : (
        <aside className="duo-rollups-inspector">
          <div className="duo-rollups-rail-head">
            <h2 className="duo-rollups-rail-title font-serif">Roll Up</h2>
            <button
              type="button"
              className="duo-rollups-collapse"
              onClick={() => setCollapse('right', true)}
              title="Hide the Roll Up panel"
            >
              ▸
            </button>
          </div>
          {browseType && view && !view.error ? (
            // R7 — an ephemeral type view: no note yet, so no builder. One
            // action: keep it.
            <div className="duo-rollups-typeview-card">
              <p>
                An instant view over every <code>{browseType}</code> in the vault — nothing is
                saved yet.
              </p>
              <button type="button" className="duo-vault-btn" onClick={() => void onSaveTypeView()}>
                Save as rollup
              </button>
            </div>
          ) : view && !view.error ? (
            view.model ? (
              <>
                <BuilderPanel
                  model={view.model}
                  schema={schema}
                  onChange={(m) => void saveModel(m)}
                  autoFocusTitle={justCreatedNote === view.note}
                  onAutoFocusConsumed={() => setJustCreatedNote(null)}
                />
                {/* R8 — entity-link mode for the RENDERED page (blob URLs
                    survive GitHub Pages; relative links only work locally). */}
                <label
                  className="duo-rollups-links-toggle"
                  title="Rendered page: link entities to their GitHub page (needs the vault in a GitHub repo) instead of local relative paths"
                >
                  <input
                    type="checkbox"
                    checked={view.links === 'github'}
                    onChange={(e) => void saveLinks(e.target.checked)}
                  />
                  GitHub links in rendered page
                </label>
              </>
            ) : (
              <div className="duo-rollups-viewonly">
                This rollup’s spec is hand-authored (formulas or query features the builder doesn’t
                model), so it’s view-only here.
                {/* R5 — the path forward: a Claude session that rewrites the
                    spec into the builder's dialect, semantics preserved. */}
                <button
                  type="button"
                  className="duo-vault-btn duo-rollups-normalize-btn"
                  onClick={onNormalize}
                  title="Start a Claude session that rewrites this spec into the builder's dialect (same rows, verified) so it becomes editable here"
                >
                  Normalize with Claude
                </button>
              </div>
            )
          ) : null}
          <FlipPanel panel={panel} onFlip={applyFlip} />
          {undo ? (
            <div className="duo-rollups-undo" role="status">
              <span className="duo-rollups-undo-label">{undo.label}</span>
              <button type="button" className="duo-vault-btn" onClick={() => void applyUndo()}>
                Undo
              </button>
            </div>
          ) : null}
        </aside>
      )}
    </div>
  )
}

// ── center: nested grouped tables (D5 — GUI-side multi-depth) ──────────────

interface GroupNode {
  label: string
  children: GroupNode[] | null
  rows: RollupViewRowDto[]
}

function groupRows(rows: RollupViewRowDto[], depth: number, level = 0): GroupNode[] {
  if (level >= depth) return []
  const order: string[] = []
  const byKey = new Map<string, RollupViewRowDto[]>()
  for (const r of rows) {
    const k = r.groups[level] ?? '—'
    if (!byKey.has(k)) {
      byKey.set(k, [])
      order.push(k)
    }
    byKey.get(k)!.push(r)
  }
  return order.map((label) => {
    const bucket = byKey.get(label)!
    const children = level + 1 < depth ? groupRows(bucket, depth, level + 1) : null
    return { label, children, rows: bucket }
  })
}

/** ENH-255 — apply the declared level-1 buckets to the level-0 nodes:
 *  declared buckets first, in declaration order, relabeled; an empty bucket
 *  is injected as a zero-row node (an empty bucket is signal); undeclared
 *  groups keep their derived order after.
 *
 *  INVARIANT (review fix, finding p): the `n.label === b.key` bridge is
 *  exact by construction, not a re-derivation — core's rollupViewData
 *  computes BOTH `rows[].groups[0]` (which groupRows keys nodes by) and
 *  `buckets[].key` from the SAME bucketRows pass (levelOneGrouping in
 *  core/vault/builder.ts), so alias-variant merging and identity matching
 *  happen once, in core, and this bridge is pure string plumbing. */
function applyBuckets(
  nodes: GroupNode[],
  buckets: RollupViewDataDto['buckets'],
  depth: number,
): GroupNode[] {
  if (!buckets.length || depth === 0) return nodes
  const used = new Set<GroupNode>()
  const out: GroupNode[] = []
  for (const b of buckets) {
    const node = b.key != null ? nodes.find((n) => !used.has(n) && n.label === b.key) : undefined
    if (node) {
      used.add(node)
      out.push({ ...node, label: b.label })
    } else {
      out.push({ label: b.label, children: depth > 1 ? [] : null, rows: [] })
    }
  }
  for (const n of nodes) if (!used.has(n)) out.push(n)
  return out
}

function GroupedRows({
  view,
  onOpen,
  onSelect,
  selectedPath,
}: {
  view: RollupViewDataDto
  onOpen: (row: RollupViewRowDto) => void
  onSelect: (row: RollupViewRowDto) => void
  selectedPath: string | null
}) {
  const depth = view.groupBy.length
  const tree = useMemo(
    () => applyBuckets(groupRows(view.rows, depth), view.buckets, depth),
    [view.rows, depth, view.buckets],
  )

  // Declared buckets render even over an empty result set (ENH-255).
  if (view.rows.length === 0 && view.buckets.length === 0) {
    return <div className="duo-rollups-empty">No entities match this rollup’s filters.</div>
  }

  const table = (rows: RollupViewRowDto[]) => (
    <table className="duo-rollups-table">
      <thead>
        <tr>
          {view.columns.map((c) => (
            <th key={c}>{c === 'file.name' ? 'title' : c.replace(/^(note|file)\./, '')}</th>
          ))}
          <th className="duo-rollups-edit-col" aria-label="edit" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.path} className={r.path === selectedPath ? 'selected' : ''}>
            {view.columns.map((c, i) =>
              i === 0 ? (
                <td key={c}>
                  <button
                    type="button"
                    className="duo-rollups-rowlink"
                    onClick={() => onOpen(r)}
                    title={r.path}
                  >
                    {r.title}
                  </button>
                </td>
              ) : (
                <td key={c}>{r.cells[c] === '' ? '—' : r.cells[c]}</td>
              ),
            )}
            <td className="duo-rollups-edit-col">
              <button
                type="button"
                className="duo-rollups-rowedit"
                onClick={() => onSelect(r)}
                title={`Edit ${r.title}'s attributes`}
              >
                ✎
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  const renderNodes = (nodes: GroupNode[], level: number, prefix: string) => (
    <>
      {/* Index-qualified keys (review fix, finding o): duplicate bucket
          labels are reachable (free-text labels, no dedupe) and must not
          collide as React keys. */}
      {nodes.map((n, i) => (
        <div key={`${prefix}/${i}:${n.label}`} className={`duo-rollups-group depth-${level}`}>
          <div className={`duo-rollups-group-h depth-${level}`}>
            {view.groupBy[level]}: {n.label} <span className="duo-rollups-count">{n.rows.length}</span>
          </div>
          {n.rows.length === 0 ? (
            // ENH-255 — a declared-but-empty bucket: the empty state IS signal.
            <div className="duo-rollups-empty">— none —</div>
          ) : n.children ? (
            renderNodes(n.children, level + 1, `${prefix}/${n.label}`)
          ) : (
            table(n.rows)
          )}
        </div>
      ))}
    </>
  )

  return depth === 0 ? table(view.rows) : <div>{renderNodes(tree, 0, '')}</div>
}

// ── inspector: the definition builder ───────────────────────────────────────

function BuilderPanel({
  model,
  schema,
  onChange,
  autoFocusTitle,
  onAutoFocusConsumed,
}: {
  model: RollupModelDto
  schema: VaultSchemaDto | null
  onChange: (m: RollupModelDto) => void
  /** ENH-250 (gap #3) — true for exactly one render right after "+ New
   *  rollup" creates this note, so renaming is the natural first action. */
  autoFocusTitle?: boolean
  onAutoFocusConsumed?: () => void
}) {
  // Title edits buffer locally and commit on blur/Enter (every commit saves).
  const [title, setTitle] = useState(model.title)
  useEffect(() => setTitle(model.title), [model.title])

  const titleInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!autoFocusTitle) return
    // The sibling `setTitle(model.title)` effect above writes the input's
    // controlled `.value` in this SAME commit (the just-created note's
    // fetchView response lands as its own render), and a native `.value`
    // write collapses any existing selection to the end — even one this
    // effect just made. rAF defers focus+select past every same-tick DOM
    // write so the highlight actually survives (verified live: without
    // this, focus lands but the selection silently collapses to length).
    const id = requestAnimationFrame(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
      // Consumed INSIDE the frame, not synchronously: calling this earlier
      // flips the parent's state (autoFocusTitle → false) before the frame
      // fires, which runs this effect's OWN cleanup and cancels the frame
      // — a self-cancelling bug caught live.
      onAutoFocusConsumed?.()
    })
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocusTitle])

  const types = schema?.types.filter((t) => t !== 'rollup') ?? []
  const props = useMemo(() => {
    const set = new Set<string>()
    for (const t of model.types) for (const p of schema?.propsByType[t] ?? []) set.add(p)
    for (const bad of ['type', 'id', 'aliases']) set.delete(bad)
    return [...set].sort()
  }, [model.types, schema])

  const enumOptions = (property: string): string[] => {
    const out = new Set<string>()
    for (const t of model.types) for (const v of schema?.enumsByType[`${t}.${property}`] ?? []) out.add(v)
    return [...out].sort()
  }

  // ENH-258 — a link-valued property's entity options (union across the
  // rolled-up types, deduped by slug). Non-empty ⇒ the property is an entity
  // reference: its filter/bucket value is PICKED from these entities and
  // matched by identity (contains), never compared as a raw link string.
  const entityOptions = (property: string): EntityRefDto[] => {
    const bySlug = new Map<string, string>()
    for (const t of model.types)
      for (const e of schema?.entityRefsByType[`${t}.${property}`] ?? []) if (!bySlug.has(e.slug)) bySlug.set(e.slug, e.name)
    return [...bySlug.entries()].map(([slug, name]) => ({ name, slug })).sort((a, b) => a.name.localeCompare(b.name))
  }
  const isLinkProp = (property: string): boolean => entityOptions(property).length > 0

  const commitTitle = () => {
    const t = title.trim()
    if (t && t !== model.title) onChange({ ...model, title: t })
    else setTitle(model.title)
  }

  const toggleType = (t: string) => {
    const has = model.types.includes(t)
    if (has && model.types.length === 1) return // at least one type
    onChange({ ...model, types: has ? model.types.filter((x) => x !== t) : [...model.types, t] })
  }

  return (
    <div className="duo-rollups-builder">
      <label className="duo-rollups-fieldlabel" htmlFor="duo-rollup-title">
        Title
      </label>
      <input
        id="duo-rollup-title"
        ref={titleInputRef}
        className="duo-rollups-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />

      <div className="duo-rollups-fieldlabel">Entity types</div>
      <div className="duo-rollups-chiprow">
        {types.map((t) => (
          <button
            key={t}
            type="button"
            className={`duo-rollups-chip${model.types.includes(t) ? ' on' : ''}`}
            onClick={() => toggleType(t)}
            title={
              model.types.includes(t) && model.types.length === 1
                ? 'A rollup needs at least one type'
                : undefined
            }
          >
            {t}
          </button>
        ))}
      </div>

      <div className="duo-rollups-fieldlabel">Group by (ordered)</div>
      <div className="duo-rollups-chiprow">
        {model.groupBy.map((g, i) => (
          <span key={g} className="duo-rollups-chip on">
            {i + 1} · {g}
            <button
              type="button"
              className="duo-rollups-chip-x"
              onClick={() => {
                const groupBy = model.groupBy.filter((x) => x !== g)
                // Buckets declare groups for level 1 — they can't outlive it
                // (a groups: block without groupBy drops the note to view-only).
                onChange({ ...model, groupBy, buckets: groupBy.length === 0 ? [] : model.buckets })
              }}
              aria-label={`Remove group level ${g}`}
            >
              ✕
            </button>
          </span>
        ))}
        <AddSelect
          placeholder="+ level"
          options={props.filter((p) => !model.groupBy.includes(p))}
          onPick={(p) => onChange({ ...model, groupBy: [...model.groupBy, p] })}
        />
      </div>

      {model.groupBy.length > 0 ? (
        <>
          {/* ENH-255 — declared buckets for group level 1: always render (even
              empty), in this order, under their labels. */}
          <div className="duo-rollups-fieldlabel">Buckets (level 1 — always shown, in order)</div>
          <div className="duo-rollups-chiprow">
            {model.buckets.map((b, i) => (
              <span key={`${b.value}-${i}`} className="duo-rollups-chip on">
                {b.label ? `${b.label} (${b.value})` : b.value}
                <button
                  type="button"
                  className="duo-rollups-chip-x"
                  onClick={() => onChange({ ...model, buckets: model.buckets.filter((_, j) => j !== i) })}
                  aria-label={`Remove bucket ${b.label ?? b.value}`}
                >
                  ✕
                </button>
              </span>
            ))}
            <AddBucket
              // ENH-258 — for a link-valued group prop the bucket value is an
              // ENTITY (matched by identity via memberEq), not a raw scalar.
              options={(isLinkProp(model.groupBy[0])
                ? entityOptions(model.groupBy[0]).map((e) => e.name)
                : enumOptions(model.groupBy[0])
              ).filter((v) => !model.buckets.some((b) => b.value === v))}
              onAdd={(b) => onChange({ ...model, buckets: [...model.buckets, b] })}
            />
          </div>
        </>
      ) : null}

      <div className="duo-rollups-fieldlabel">Filters</div>
      <div className="duo-rollups-filters">
        {model.filters.map((f, i) => (
          <div key={`${f.property}-${i}`} className="duo-rollups-filter">
            <code>{f.property}</code>
            {/* ENH-258 — an identity `contains` on a link prop reads as "is",
                not the multi-valued "has member" label. */}
            <span>{f.op === 'contains' && isLinkProp(f.property) ? 'is' : OPS.find((o) => o.value === f.op)?.label}</span>
            {VALUE_OPS.has(f.op) ? <code>{f.value}</code> : null}
            <button
              type="button"
              className="duo-rollups-chip-x"
              onClick={() => onChange({ ...model, filters: model.filters.filter((_, j) => j !== i) })}
              aria-label={`Remove filter on ${f.property}`}
            >
              ✕
            </button>
          </div>
        ))}
        <AddFilter
          props={props}
          enumOptions={enumOptions}
          entityOptions={entityOptions}
          isLinkProp={isLinkProp}
          onAdd={(f) => onChange({ ...model, filters: [...model.filters, f] })}
        />
      </div>

      <div className="duo-rollups-fieldlabel">Columns</div>
      <div className="duo-rollups-chiprow">
        {model.columns.map((c) => (
          <span key={c} className="duo-rollups-chip on">
            {c}
            <button
              type="button"
              className="duo-rollups-chip-x"
              onClick={() => onChange({ ...model, columns: model.columns.filter((x) => x !== c) })}
              aria-label={`Remove column ${c}`}
            >
              ✕
            </button>
          </span>
        ))}
        <AddSelect
          placeholder="+ column"
          options={props.filter((p) => !model.columns.includes(p))}
          onPick={(p) => onChange({ ...model, columns: [...model.columns, p] })}
        />
      </div>
      <div className="duo-rollups-livesave">Changes save to the rollup’s config and re-render live.</div>
    </div>
  )
}

/** A select that acts as an "add one" picker — resets to placeholder on pick. */
function AddSelect({
  placeholder,
  options,
  onPick,
}: {
  placeholder: string
  options: string[]
  onPick: (v: string) => void
}) {
  if (options.length === 0) return null
  return (
    <select
      className="duo-rollups-add"
      value=""
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value)
      }}
      aria-label={placeholder}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}

/** ENH-255 — the "+ bucket" adder: a value (enum pick or free text, matched
 *  by identity for link values) and an optional display label. */
function AddBucket({
  options,
  onAdd,
}: {
  options: string[]
  onAdd: (b: { value: string; label?: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [label, setLabel] = useState('')
  if (!open) {
    return (
      <button type="button" className="duo-rollups-add" onClick={() => setOpen(true)}>
        + bucket
      </button>
    )
  }
  const commit = () => {
    const v = value.trim()
    if (!v) return
    const l = label.trim()
    onAdd(l ? { value: v, label: l } : { value: v })
    setValue('')
    setLabel('')
    setOpen(false)
  }
  return (
    <div className="duo-rollups-addfilter">
      {/* Free text WITH suggestions — a bucket may declare a value no row has
          yet (that's the point of an empty bucket), so a pick-only select
          would block the primary use case. */}
      <input
        className="duo-rollups-input duo-rollups-filter-value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="value"
        aria-label="Bucket value"
        list="duo-rollups-bucket-options"
      />
      <datalist id="duo-rollups-bucket-options">
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <input
        className="duo-rollups-input duo-rollups-filter-value"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="label (optional)"
        aria-label="Bucket label"
      />
      <button type="button" className="duo-vault-btn" onClick={commit}>
        Add
      </button>
    </div>
  )
}

function AddFilter({
  props,
  enumOptions,
  entityOptions,
  isLinkProp,
  onAdd,
}: {
  props: string[]
  enumOptions: (property: string) => string[]
  entityOptions: (property: string) => EntityRefDto[]
  isLinkProp: (property: string) => boolean
  onAdd: (f: RollupFilterDto) => void
}) {
  const [property, setProperty] = useState('')
  const [op, setOp] = useState<RollupFilterDto['op']>('eq')
  const [value, setValue] = useState('')
  const link = property ? isLinkProp(property) : false
  const needsValue = VALUE_OPS.has(op)
  const options = property && !link ? enumOptions(property) : []
  const entOptions = property && link ? entityOptions(property) : []
  // ENH-258 — a link-valued property is matched by ENTITY IDENTITY, so its
  // ops are "is <entity>" (identity `contains`) + set/notset. A raw-string
  // `==` would never match the parsed Link, which is the bug this fixes.
  const opsForProp = link
    ? ([
        { value: 'contains', label: 'is' },
        { value: 'set', label: 'is set' },
        { value: 'notset', label: 'is not set' },
      ] as { value: RollupFilterDto['op']; label: string }[])
    : OPS

  const pickProperty = (p: string) => {
    setProperty(p)
    setValue('')
    // Default a link prop to identity membership so its value actually matches.
    setOp(p && isLinkProp(p) ? 'contains' : 'eq')
  }

  const commit = () => {
    if (!property) return
    if (needsValue && !value) return
    onAdd(needsValue ? { property, op, value } : { property, op })
    setProperty('')
    setValue('')
    setOp('eq')
  }

  return (
    <div className="duo-rollups-addfilter">
      <select
        className="duo-rollups-add"
        value={property}
        onChange={(e) => pickProperty(e.target.value)}
        aria-label="Filter property"
      >
        <option value="">+ filter…</option>
        {props.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      {property ? (
        <>
          <select
            className="duo-rollups-add"
            value={op}
            onChange={(e) => setOp(e.target.value as RollupFilterDto['op'])}
            aria-label="Filter operator"
          >
            {opsForProp.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {needsValue ? (
            link ? (
              // ENH-258 — pick an ENTITY; the stored value is its display name,
              // which the engine folds to the note's identity (memberEq), so a
              // `[[Growth]]` / `[Growth](./growth.md)` value all match.
              <select
                className="duo-rollups-add"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-label="Filter value"
              >
                <option value="">entity…</option>
                {entOptions.map((e) => (
                  <option key={e.slug} value={e.name}>
                    {e.name}
                  </option>
                ))}
              </select>
            ) : options.length > 0 ? (
              <select
                className="duo-rollups-add"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-label="Filter value"
              >
                <option value="">value…</option>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="duo-rollups-input duo-rollups-filter-value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="value"
                aria-label="Filter value"
              />
            )
          ) : null}
          <button type="button" className="duo-vault-btn" onClick={commit}>
            Add
          </button>
        </>
      ) : null}
    </div>
  )
}

// ── inspector: the frontmatter flip subpane (D2) ────────────────────────────

function FlipPanel({
  panel,
  onFlip,
}: {
  panel: EntityPanelDto | null
  onFlip: (key: string, value: string | number | boolean | null, prevRaw: string, kind: string) => void
}) {
  const [textDrafts, setTextDrafts] = useState<Record<string, string>>({})
  useEffect(() => setTextDrafts({}), [panel?.note])

  if (!panel) {
    return (
      <div className="duo-rollups-flip-empty">
        Select a row (✎) to flip its attributes here — one click per change, undoable.
      </div>
    )
  }

  return (
    <div className="duo-rollups-flip">
      <div className="duo-rollups-fieldlabel">
        Selected · <span title={panel.note}>{panel.title}</span>
      </div>
      <div className="duo-rollups-flip-rows">
        {panel.fields.map((f) => (
          <div key={f.key} className="duo-rollups-flip-row">
            <code className="duo-rollups-flip-key">{f.key}</code>
            {f.kind === 'bool' ? (
              <button
                type="button"
                className="duo-rollups-flip-val"
                onClick={() => onFlip(f.key, f.value !== 'true', f.value, f.kind)}
                title="Click to flip"
              >
                {f.value === '' ? '—' : f.value} ⇄
              </button>
            ) : f.kind === 'enum' ? (
              <select
                className="duo-rollups-add duo-rollups-flip-select"
                value={f.value}
                onChange={(e) => onFlip(f.key, e.target.value, f.value, f.kind)}
                aria-label={`Set ${f.key}`}
              >
                {f.value === '' ? <option value="">—</option> : null}
                {(f.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="duo-rollups-input duo-rollups-flip-text"
                value={textDrafts[f.key] ?? f.value}
                onChange={(e) => setTextDrafts((d) => ({ ...d, [f.key]: e.target.value }))}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v === f.value) return
                  onFlip(f.key, v === '' ? null : f.kind === 'number' && !Number.isNaN(Number(v)) ? Number(v) : v, f.value, f.kind)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
                placeholder="—"
                aria-label={`Set ${f.key}`}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
