import { useState, useEffect, useCallback } from 'react'
import type { BrowserState } from '@shared/types'

const DEFAULT_STATE: BrowserState = {
  url: 'about:blank',
  title: '',
  canGoBack: false,
  canGoForward: false,
  isLoading: false
}

export function useBrowserState() {
  const [state, setState] = useState<BrowserState>(DEFAULT_STATE)

  useEffect(() => {
    return window.electron.browser.onStateChange(setState)
  }, [])

  const navigate = useCallback((url: string) => {
    return window.electron.browser.navigate(url)
  }, [])

  return { state, navigate }
}
