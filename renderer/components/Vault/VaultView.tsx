// ENH-228 — the Vault view: a top-level surface beside Home (slot 1), shown
// while a default vault is set (D3/D4). Two columns over the resolved vault:
//   - Inbox  — `inbox/` captures, newest-first, stale > 1wk flagged; + Capture.
//   - Rollups — every `type: rollup` note with a freshness chip; View opens the
//               rendered HTML artifact; + New rollup spawns a seeded Claude
//               session (App owns the spawn; VaultView dispatches the intent).
//
// VaultView talks to main directly for reads/writes it owns (getDefault,
// setDefault, capture, the useVaultSnapshot hook); it stays free of App props
// and routes tab-opening / session-spawning through window CustomEvents (the
// HomeView pattern), which App listens for. `isActive` gates all fetching so a
// kept-mounted-but-hidden tab never polls (BUG-046 lineage).

import { useCallback, useEffect, useRef, useState } from 'react'
import { useVaultSnapshot } from './useVaultSnapshot'
import type { VaultInboxEntryDto, VaultRollupDto } from '@shared/host-api'
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

  const onNewRollup = useCallback(() => {
    if (defaultVault) emit('duo-vault-new-rollup', { vaultRoot: defaultVault })
  }, [defaultVault])

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
            <button type="button" className="duo-vault-btn" onClick={onNewRollup}>
              + New rollup
            </button>
          </div>
          {rollups.length === 0 ? (
            <div className="duo-vault-col-empty">
              {loading ? 'Loading…' : 'No rollups yet — “+ New rollup” starts a guided session.'}
            </div>
          ) : (
            <ul className="duo-vault-list">
              {rollups.map((r) => (
                <RollupRow
                  key={r.note}
                  rollup={r}
                  onOpenNote={() => onOpenNote(r.absPath)}
                  onView={r.out ? () => onOpenArtifact(snapshot!.root, r.out!) : undefined}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
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
}: {
  rollup: VaultRollupDto
  onOpenNote: () => void
  onView?: () => void
}) {
  // Freshness: never-rendered (no last_hash) → "not rendered"; stale → "stale";
  // else "fresh". Amber (warn) for the first two, green (ok) for fresh — both
  // theme-legible via the shared duo-banner-* classes.
  const chip = rollup.last_hash == null
    ? { label: 'not rendered', cls: 'duo-banner-warn' }
    : rollup.stale
      ? { label: 'stale', cls: 'duo-banner-warn' }
      : { label: 'fresh', cls: 'duo-banner-ok' }
  return (
    <li className="duo-vault-row">
      <button type="button" className="duo-vault-row-main" onClick={onOpenNote} title={rollup.note}>
        <span className="duo-vault-row-title">{rollup.title}</span>
        <span className="duo-vault-row-meta">
          <span className={`duo-vault-chip ${chip.cls}`}>{chip.label}</span>
          <span className="duo-vault-row-fmt">{rollup.format}</span>
        </span>
      </button>
      {onView ? (
        <button
          type="button"
          className="duo-vault-view"
          onClick={onView}
          title="Open the rendered HTML artifact"
        >
          View ↗
        </button>
      ) : null}
    </li>
  )
}
