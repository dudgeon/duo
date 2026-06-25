// ENH-228 — the Vault view's data hook. Fetches a vault's inbox + rollups over
// IPC (the same core/vault reads as `vault.listInbox` / `duo rollup list`),
// gated on `isActive` and re-fetched on a 30s interval while active — mirroring
// HomeView's poll pattern (no main→renderer push channel needed). Re-runs
// whenever the subject `vaultRoot` changes (the header switcher re-points it).

import { useCallback, useEffect, useRef, useState } from 'react'
import type { VaultInboxEntryDto, VaultRollupDto } from '@shared/host-api'

/** Re-fetch cadence while the tab is active (ms). Matches HomeView's poll. */
const POLL_MS = 30_000

export interface VaultSnapshot {
  /** The resolved vault root the lists were read from. */
  root: string
  inbox: VaultInboxEntryDto[]
  rollups: VaultRollupDto[]
}

export interface UseVaultSnapshot {
  snapshot: VaultSnapshot | null
  loading: boolean
  error: string | null
  /** Force an immediate re-fetch (e.g. right after a capture / render). */
  refresh: () => void
}

/** Live inbox + rollups for `vaultRoot`, gated on `isActive`. Null `vaultRoot`
 *  (no default vault) → an idle hook with a null snapshot. */
export function useVaultSnapshot(vaultRoot: string | null, isActive: boolean): UseVaultSnapshot {
  const [snapshot, setSnapshot] = useState<VaultSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A monotonically increasing token forces a refetch when `refresh()` is called.
  const [nonce, setNonce] = useState(0)
  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  // Guard against a late-resolving fetch landing after unmount / a vaultRoot swap.
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const fetchSnapshot = useCallback(async () => {
    if (!vaultRoot) {
      setSnapshot(null)
      setError(null)
      return
    }
    setLoading(true)
    try {
      const [inboxRes, rollupRes] = await Promise.all([
        window.electron.vault.listInbox({ vaultRoot }),
        window.electron.vault.listRollups({ vaultRoot }),
      ])
      if (!aliveRef.current) return
      if (!inboxRes.ok) {
        setError(inboxRes.error)
        return
      }
      if (!rollupRes.ok) {
        setError(rollupRes.error)
        return
      }
      setError(null)
      setSnapshot({ root: inboxRes.root, inbox: inboxRes.items, rollups: rollupRes.rollups })
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [vaultRoot])

  // Fetch on mount / isActive flip / vaultRoot change / refresh(), plus a poll
  // interval that exists ONLY while active (cleared on unmount or going hidden).
  useEffect(() => {
    if (!isActive) return
    void fetchSnapshot()
    const id = setInterval(() => {
      void fetchSnapshot()
    }, POLL_MS)
    return () => clearInterval(id)
  }, [isActive, fetchSnapshot, nonce])

  return { snapshot, loading, error, refresh }
}
