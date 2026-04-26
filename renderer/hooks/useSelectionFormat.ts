// Stage 15 G19 — Send → Duo payload format. Mirrors useTheme's pattern:
// renderer is the source of truth (persisted in localStorage), main
// caches the latest snapshot for `duo selection-format` reads, and a
// CLI-driven SET round-trips through `selectionFormat:set`.

import { useCallback, useEffect, useState } from 'react'
import type { SelectionFormat } from '@shared/types'

export type { SelectionFormat }

const STORAGE_KEY = 'duo.selectionFormat'
const DEFAULT_FORMAT: SelectionFormat = 'a'

function loadFormat(): SelectionFormat {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'a' || v === 'b' || v === 'c') return v
  } catch { /* localStorage may be sandboxed */ }
  return DEFAULT_FORMAT
}

export interface SelectionFormatApi {
  format: SelectionFormat
  setFormat: (f: SelectionFormat) => void
}

export function useSelectionFormat(): SelectionFormatApi {
  const [format, setFormatState] = useState<SelectionFormat>(loadFormat)

  // Push state to main so `duo selection-format` reads stay in sync.
  useEffect(() => {
    window.electron.selectionFormat?.pushState({ format })
  }, [format])

  // Listen for CLI-driven overrides (`duo selection-format <a|b|c>`).
  useEffect(() => {
    return window.electron.selectionFormat?.onSet((f) => {
      setFormatState(f)
      try { localStorage.setItem(STORAGE_KEY, f) } catch { /* sandbox */ }
    })
  }, [])

  const setFormat = useCallback((f: SelectionFormat) => {
    setFormatState(f)
    try { localStorage.setItem(STORAGE_KEY, f) } catch { /* sandbox */ }
  }, [])

  return { format, setFormat }
}
