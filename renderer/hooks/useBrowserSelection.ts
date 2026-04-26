// Stage 15.2 — live browser selection state from the page-side observer.
//
// Mirrors the editor's selection-aware lifecycle: a non-null snapshot
// means the user has a non-collapsed text selection somewhere in the
// active browser tab; the floating pill anchors itself to `rect`.
// `null` means selection is collapsed, focus moved off the page, or
// the tab just navigated.

import { useEffect, useState } from 'react'
import type { BrowserSelectionPush } from '@shared/types'

const EMPTY_PUSH: BrowserSelectionPush = { snapshot: null, rect: null }

export function useBrowserSelection(): BrowserSelectionPush {
  const [push, setPush] = useState<BrowserSelectionPush>(EMPTY_PUSH)

  useEffect(() => {
    return window.electron.browser?.onSelection((p) => {
      setPush(p)
    })
  }, [])

  return push
}
