import { useState, useEffect, useCallback } from 'react'
import type { BrowserState, BrowserTab } from '@shared/types'

const DEFAULT_STATE: BrowserState = {
  url: 'about:blank',
  title: '',
  canGoBack: false,
  canGoForward: false,
  isLoading: false
}

export function useBrowserState() {
  const [state, setState] = useState<BrowserState>(DEFAULT_STATE)
  const [tabs, setTabs] = useState<BrowserTab[]>([])

  // On mount, pull the current state snapshot so HMR / first render reflect
  // whatever the main process already has (prevents a stale about:blank
  // address bar after CDP-driven navigation).
  useEffect(() => {
    window.electron.browser.getState().then((s) => { if (s) setState(s) })
    window.electron.browser.getTabs().then(setTabs)
    const offState = window.electron.browser.onStateChange(setState)
    const offTabs = window.electron.browser.onTabsChange(setTabs)
    return () => { offState(); offTabs() }
  }, [])

  const navigate = useCallback((url: string) => {
    return window.electron.browser.navigate(url)
  }, [])

  const addTab = useCallback((url?: string) => {
    return window.electron.browser.addTab(url)
  }, [])

  const switchTab = useCallback((id: number) => {
    return window.electron.browser.switchTab(id)
  }, [])

  const closeTab = useCallback((id: number) => {
    return window.electron.browser.closeTab(id)
  }, [])

  return { state, tabs, navigate, addTab, switchTab, closeTab }
}
