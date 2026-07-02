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
  RollupFilterDto,
  RollupModelDto,
  RollupViewDataDto,
  RollupViewRowDto,
  VaultRollupDto,
  VaultSchemaDto,
} from '@shared/host-api'
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

const OPS: { value: RollupFilterDto['op']; label: string }[] = [
  { value: 'eq', label: 'is' },
  { value: 'ne', label: 'is not' },
  { value: 'set', label: 'is set' },
  { value: 'notset', label: 'is not set' },
]

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
  const [collapsed, setCollapsed] = useState(readCollapsed)

  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
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
        // Auto-select the first rollup when nothing is selected yet.
        setSelected((cur) => cur ?? listRes.rollups[0]?.note ?? null)
      } else {
        setError(listRes.error)
      }
      if (schemaRes.ok) setSchema(schemaRes.schema)
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : String(e))
    }
  }, [defaultVault])

  const fetchView = useCallback(async () => {
    if (!defaultVault || !selected) {
      setView(null)
      return
    }
    try {
      const res = await window.electron.vault.rollupView({ vaultRoot: defaultVault, note: selected })
      if (!aliveRef.current) return
      if (res.ok) setView(res.data)
      else setError(res.error)
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : String(e))
    }
  }, [defaultVault, selected])

  const refreshAll = useCallback(() => {
    void fetchList()
    void fetchView()
  }, [fetchList, fetchView])

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

  // Selecting a different rollup drops the row selection + any pending undo.
  useEffect(() => {
    setPanel(null)
    setUndo(null)
  }, [selected])

  // ── actions ──────────────────────────────────────────────────────────────
  const onNewRollup = useCallback(async () => {
    if (!defaultVault || !schema) return
    const model: RollupModelDto = {
      title: 'Untitled rollup',
      types: [schema.types.find((t) => t !== 'rollup') ?? schema.types[0] ?? 'note'],
      groupBy: [],
      filters: [],
      columns: [],
    }
    try {
      const res = await window.electron.vault.rollupSave({ vaultRoot: defaultVault, model })
      if (res.ok && aliveRef.current) {
        await fetchList()
        setSelected(res.note)
      } else if (!res.ok) {
        setError(res.error)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [defaultVault, schema, fetchList])

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
          void fetchView()
          void fetchList() // the title may have changed
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

  const onDoctor = useCallback(() => {
    if (!defaultVault || !view) return
    emit('duo-rollups-doctor', { vaultRoot: defaultVault, note: view.note, error: view.error ?? '' })
  }, [defaultVault, view])

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
              <li key={r.note}>
                <button
                  type="button"
                  className={`duo-rollups-item${r.note === selected ? ' selected' : ''}`}
                  onClick={() => setSelected(r.note)}
                  title={r.note}
                >
                  {r.title}
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
          <h1 className="duo-rollups-title font-serif">{view?.title ?? 'Rollups'}</h1>
          <div className="duo-rollups-head-actions">
            <button type="button" className="duo-vault-btn" onClick={refreshAll} title="Re-read the vault">
              ↻ Refresh
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

        {!selected ? (
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
          <GroupedRows view={view} onOpen={onOpenRow} onSelect={onSelectRow} selectedPath={panel?.note ?? null} />
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
          {view && !view.error ? (
            view.model ? (
              <BuilderPanel model={view.model} schema={schema} onChange={(m) => void saveModel(m)} />
            ) : (
              <div className="duo-rollups-viewonly">
                This rollup’s spec is hand-authored (formulas or query features the builder doesn’t
                model), so it’s view-only here. Reshape it in the editor or with the Claude
                authoring loop.
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
  const tree = useMemo(() => groupRows(view.rows, depth), [view.rows, depth])

  if (view.rows.length === 0) {
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
      {nodes.map((n) => (
        <div key={`${prefix}/${n.label}`} className={`duo-rollups-group depth-${level}`}>
          <div className={`duo-rollups-group-h depth-${level}`}>
            {view.groupBy[level]}: {n.label} <span className="duo-rollups-count">{n.rows.length}</span>
          </div>
          {n.children ? renderNodes(n.children, level + 1, `${prefix}/${n.label}`) : table(n.rows)}
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
}: {
  model: RollupModelDto
  schema: VaultSchemaDto | null
  onChange: (m: RollupModelDto) => void
}) {
  // Title edits buffer locally and commit on blur/Enter (every commit saves).
  const [title, setTitle] = useState(model.title)
  useEffect(() => setTitle(model.title), [model.title])

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
              onClick={() => onChange({ ...model, groupBy: model.groupBy.filter((x) => x !== g) })}
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

      <div className="duo-rollups-fieldlabel">Filters</div>
      <div className="duo-rollups-filters">
        {model.filters.map((f, i) => (
          <div key={`${f.property}-${i}`} className="duo-rollups-filter">
            <code>{f.property}</code>
            <span>{OPS.find((o) => o.value === f.op)?.label}</span>
            {f.op === 'eq' || f.op === 'ne' ? <code>{f.value}</code> : null}
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
        <AddFilter props={props} enumOptions={enumOptions} onAdd={(f) => onChange({ ...model, filters: [...model.filters, f] })} />
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

function AddFilter({
  props,
  enumOptions,
  onAdd,
}: {
  props: string[]
  enumOptions: (property: string) => string[]
  onAdd: (f: RollupFilterDto) => void
}) {
  const [property, setProperty] = useState('')
  const [op, setOp] = useState<RollupFilterDto['op']>('eq')
  const [value, setValue] = useState('')
  const needsValue = op === 'eq' || op === 'ne'
  const options = property ? enumOptions(property) : []

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
        onChange={(e) => {
          setProperty(e.target.value)
          setValue('')
        }}
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
            {OPS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {needsValue ? (
            options.length > 0 ? (
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
