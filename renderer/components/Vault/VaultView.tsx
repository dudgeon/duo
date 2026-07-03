// ENH-228 — the Vault view: a top-level surface beside Home (slot 1), shown
// while a default vault is set (D3/D4). Two columns over the resolved vault:
//   - Inbox  — `inbox/` captures, newest-first, stale > 1wk flagged; + Capture.
//   - Rollups — every `type: rollup` note with a freshness chip; the row's
//               name opens the rendered HTML artifact, "Edit" jumps to the
//               Rollups tab with that note selected; + New rollup DEFAULTS
//               to the Rollups tab's instant GUI-builder flow (ENH-251),
//               right-click for the seeded-Claude-session flow instead
//               (App owns both the tab-switch and the spawn; VaultView
//               only dispatches the intent).
//
// VaultView talks to main directly for reads/writes it owns (getDefault,
// setDefault, capture, the useVaultSnapshot hook); it stays free of App props
// and routes tab-opening / session-spawning through window CustomEvents (the
// HomeView pattern), which App listens for. `isActive` gates all fetching so a
// kept-mounted-but-hidden tab never polls (BUG-046 lineage).

import { useCallback, useEffect, useRef, useState } from 'react'
import { useVaultSnapshot } from './useVaultSnapshot'
import type { VaultInboxEntryDto, VaultRollupDto } from '@shared/host-api'
import type { MenuTemplateItem } from '@shared/types'
import './Vault.css'

/** The trailing folder name of an absolute path — the switcher's display label. */
function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || trimmed
}

/** Dispatch a window CustomEvent App listens for (tab-open / session-spawn). */
function emit(name: string, detail: unknown): void {
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

export function VaultView({ isActive }: { isActive: boolean }) {
  const [defaultVault, setDefaultVault] = useState<string | null>(null)
  const [knownVaults, setKnownVaults] = useState<string[]>([])

  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const fetchDefault = useCallback(async () => {
    try {
      const r = await window.electron.vault.getDefault()
      if (!aliveRef.current) return
      setDefaultVault(r.defaultVault)
      setKnownVaults(r.knownVaults)
    } catch {
      /* leave prior state */
    }
  }, [])

  // Refresh the default/known set on activate + when any path changes it.
  useEffect(() => {
    if (!isActive) return
    void fetchDefault()
    const onChanged = () => void fetchDefault()
    window.addEventListener('duo-vault-default-changed', onChanged)
    return () => window.removeEventListener('duo-vault-default-changed', onChanged)
  }, [isActive, fetchDefault])

  const { snapshot, loading, error, refresh } = useVaultSnapshot(defaultVault, isActive)

  // ENH-248 walk-2 — any surface that just re-rendered an artifact (the
  // Rollups tab's Refresh, the browser pane's artifact toolbar) pings this
  // so the freshness chips update NOW instead of on the next 30s poll
  // ("these rollups seem to stay stale" was partly this lag).
  useEffect(() => {
    const onRefresh = () => refresh()
    window.addEventListener('duo-vault-refresh', onRefresh)
    return () => window.removeEventListener('duo-vault-refresh', onRefresh)
  }, [refresh])

  // ENH-248 R7 — the Entities section: every `type:` with a live count
  // (corpus schema, no sidecar). Same isActive gate + refresh cadence as
  // the snapshot; a click hands off to the Rollups tab's instant type view.
  const [typeCounts, setTypeCounts] = useState<Record<string, number> | null>(null)
  useEffect(() => {
    let alive = true
    if (!isActive || !defaultVault) return
    const fetchCounts = async () => {
      try {
        const res = await window.electron.vault.schema({ vaultRoot: defaultVault })
        if (alive && res.ok) setTypeCounts(res.schema.countsByType)
      } catch {
        /* counts are a glance aid — a failed fetch just keeps the prior view */
      }
    }
    void fetchCounts()
    const id = setInterval(() => void fetchCounts(), 30_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [isActive, defaultVault])

  const onBrowseType = useCallback(
    (type: string) => {
      if (defaultVault) emit('duo-vault-browse-type', { vaultRoot: defaultVault, type })
    },
    [defaultVault],
  )

  // Header switcher — re-point AND update the default vault (D3). Broadcast so
  // App re-evaluates the present-when-default tab gate + other surfaces refresh.
  const onSwitch = useCallback(
    async (root: string) => {
      if (!root || root === defaultVault) return
      try {
        const res = await window.electron.vault.setDefault({ root })
        if (res.ok && aliveRef.current) {
          setDefaultVault(res.defaultVault)
          emit('duo-vault-default-changed', { defaultVault: res.defaultVault })
        }
      } catch {
        /* a failed switch leaves the prior selection */
      }
    },
    [defaultVault],
  )

  const onCapture = useCallback(async () => {
    try {
      const res = await window.electron.vault.capture({})
      if (res.ok) {
        const name = res.path.slice(res.path.lastIndexOf('/') + 1) || res.path
        emit('duo-vault-open-note', { path: res.absPath, name })
        refresh()
      }
    } catch {
      /* ignore — the user can retry */
    }
  }, [refresh])

  const onOpenNote = useCallback((absPath: string) => {
    const name = absPath.slice(absPath.lastIndexOf('/') + 1) || absPath
    emit('duo-vault-open-note', { path: absPath, name })
  }, [])

  const onOpenArtifact = useCallback((root: string, outRel: string) => {
    const abs = `${root}/${outRel}`
    const name = outRel.slice(outRel.lastIndexOf('/') + 1) || outRel
    emit('duo-vault-open-rollup', { path: abs, name })
  }, [])

  // ENH-251 (owner walk feedback) — "+ New rollup" DEFAULTS to the instant
  // GUI-builder flow in the Rollups tab (matches the Rollups tab's own "+
  // New rollup"; construction lives there now). The seeded-Claude-session
  // flow (freeform authoring for anything the builder doesn't model) is
  // still first-class — moved to a right-click context menu on the SAME
  // button rather than deleted, per owner instruction.
  const onNewRollupGui = useCallback(() => {
    if (defaultVault) emit('duo-vault-new-rollup-gui', { vaultRoot: defaultVault })
  }, [defaultVault])

  const onNewRollupClaude = useCallback(() => {
    if (defaultVault) emit('duo-vault-new-rollup', { vaultRoot: defaultVault })
  }, [defaultVault])

  const onNewRollupContextMenu = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault()
      if (!defaultVault) return
      const items: MenuTemplateItem[] = [
        { id: 'claude', label: 'Start a Claude authoring session…' },
      ]
      const result = await window.electron.menu.popup({ items, x: e.clientX, y: e.clientY })
      if (result.chosenId === 'claude') onNewRollupClaude()
    },
    [defaultVault, onNewRollupClaude],
  )

  // No default vault — App normally hides the tab, but a transient (default
  // cleared while the tab is active) lands here. Friendly, not an error.
  if (!defaultVault) {
    return (
      <div className="duo-vault" data-duo-tab-kind="vault">
        <div className="duo-vault-empty">
          No default vault is set. Set one with <code>duo vault default &lt;path&gt;</code> or
          Settings → Default Vault, and the inbox + rollups land here.
        </div>
      </div>
    )
  }

  const inbox = snapshot?.inbox ?? []
  const rollups = snapshot?.rollups ?? []

  return (
    <div className="duo-vault" data-duo-tab-kind="vault">
      <header className="duo-vault-head">
        <div className="duo-vault-title-row">
          <h1 className="duo-vault-title font-serif">Vault</h1>
          {knownVaults.length > 1 ? (
            <select
              className="duo-vault-switcher"
              value={defaultVault}
              onChange={(e) => void onSwitch(e.target.value)}
              title="Switch the default vault"
              aria-label="Switch the default vault"
            >
              {knownVaults.map((v) => (
                <option key={v} value={v}>
                  {basename(v)}
                </option>
              ))}
            </select>
          ) : (
            <span className="duo-vault-name">{basename(defaultVault)}</span>
          )}
        </div>
        <div className="duo-vault-path" title={defaultVault}>
          {defaultVault}
        </div>
        {error ? <div className="duo-banner-warn duo-vault-banner">Couldn’t read the vault: {error}</div> : null}
      </header>

      <div className="duo-vault-cols">
        <section className="duo-vault-col">
          <div className="duo-vault-col-head">
            <h2 className="duo-vault-col-title font-serif">
              Inbox <span className="duo-vault-count">{inbox.length}</span>
            </h2>
            <button type="button" className="duo-vault-btn" onClick={() => void onCapture()}>
              + Capture
            </button>
          </div>
          {inbox.length === 0 ? (
            <div className="duo-vault-col-empty">
              {loading ? 'Loading…' : 'Inbox is empty — capture a quick note to start.'}
            </div>
          ) : (
            <ul className="duo-vault-list">
              {inbox.map((entry) => (
                <InboxRow key={entry.note} entry={entry} onOpen={() => onOpenNote(entry.absPath)} />
              ))}
            </ul>
          )}
        </section>

        <section className="duo-vault-col">
          <div className="duo-vault-col-head">
            <h2 className="duo-vault-col-title font-serif">
              Rollups <span className="duo-vault-count">{rollups.length}</span>
            </h2>
            <button
              type="button"
              className="duo-vault-btn"
              onClick={onNewRollupGui}
              onContextMenu={onNewRollupContextMenu}
              title="Create a rollup in the Rollups tab — right-click for a Claude authoring session instead"
            >
              + New rollup
            </button>
          </div>
          {rollups.length === 0 ? (
            <div className="duo-vault-col-empty">
              {loading ? 'Loading…' : 'No rollups yet — “+ New rollup” opens the Rollups tab to build one (right-click for a Claude authoring session instead).'}
            </div>
          ) : (
            <ul className="duo-vault-list">
              {rollups.map((r) => (
                <RollupRow
                  key={r.note}
                  rollup={r}
                  onOpenNote={() => onOpenNote(r.absPath)}
                  onView={r.out ? () => onOpenArtifact(snapshot!.root, r.out!) : undefined}
                  onEdit={() => emit('duo-vault-edit-rollup', { note: r.note })}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ENH-248 R7 — the corpus at a glance: every entity type with a live
          count. Click → an instant (unsaved) view over that type in the
          Rollups tab; keep it from there with "Save as rollup". */}
      {typeCounts && Object.keys(typeCounts).length > 0 ? (
        <section className="duo-vault-entities">
          <div className="duo-vault-col-head">
            <h2 className="duo-vault-col-title font-serif">
              Entities{' '}
              <span className="duo-vault-count">
                {Object.values(typeCounts).reduce((a, b) => a + b, 0)}
              </span>
            </h2>
          </div>
          <ul className="duo-vault-entity-grid">
            {Object.entries(typeCounts)
              .filter(([t]) => t !== 'rollup')
              .map(([type, count]) => (
                <li key={type}>
                  <button
                    type="button"
                    className="duo-vault-entity-tile"
                    onClick={() => onBrowseType(type)}
                    title={`Browse every ${type} in the Rollups tab`}
                  >
                    <span className="duo-vault-entity-type">{type}</span>
                    <span className="duo-vault-entity-count">{count}</span>
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function InboxRow({ entry, onOpen }: { entry: VaultInboxEntryDto; onOpen: () => void }) {
  return (
    <li className="duo-vault-row">
      <button type="button" className="duo-vault-row-main" onClick={onOpen} title={entry.note}>
        <span className="duo-vault-row-title">{entry.title}</span>
        <span className="duo-vault-row-meta">
          {entry.captured ?? 'undated'}
          {entry.stale ? <span className="duo-vault-chip duo-banner-warn">stale</span> : null}
        </span>
      </button>
    </li>
  )
}

function RollupRow({
  rollup,
  onOpenNote,
  onView,
  onEdit,
}: {
  rollup: VaultRollupDto
  onOpenNote: () => void
  onView?: () => void
  onEdit: () => void
}) {
  // Freshness: never-rendered (no last_hash) → "not rendered"; stale → "stale";
  // else "fresh". Amber (warn) for the first two, green (ok) for fresh — both
  // theme-legible via the shared duo-banner-* classes.
  const chip = rollup.last_hash == null
    ? { label: 'not rendered', cls: 'duo-banner-warn' }
    : rollup.stale
      ? { label: 'stale', cls: 'duo-banner-warn' }
      : { label: 'fresh', cls: 'duo-banner-ok' }
  // ENH-250 (gap #4) — the row's primary click opens the rendered artifact
  // (what a reader wants); construction lives one click away via "Edit". A
  // rollup with no artifact yet (never rendered — shouldn't happen for a
  // builder-created one post-ENH-250, but possible for an old hand-authored
  // one) falls back to the note so the row is never a dead click.
  const primaryAction = onView ?? onOpenNote
  return (
    <li className="duo-vault-row">
      <button
        type="button"
        className="duo-vault-row-main"
        onClick={primaryAction}
        title={onView ? `Open the rendered rollup (${rollup.note})` : rollup.note}
      >
        <span className="duo-vault-row-title">{rollup.title}</span>
        <span className="duo-vault-row-meta">
          <span className={`duo-vault-chip ${chip.cls}`}>{chip.label}</span>
          <span className="duo-vault-row-fmt">{rollup.format}</span>
        </span>
      </button>
      <button
        type="button"
        className="duo-vault-view"
        onClick={onEdit}
        title="Edit this rollup in the Rollups tab"
      >
        Edit
      </button>
    </li>
  )
}
