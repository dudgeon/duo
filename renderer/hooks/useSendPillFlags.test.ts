// ENH-176 — feature flags for the two Send-pill variants. Tests pin
// the default-on / default-off contract + the parsing of the stored
// values + the imperative setters' storage shape.

import { beforeEach, describe, expect, it } from 'vitest'
import { setSendPillAgentFlag, setSendPillTerminalFlag } from './useSendPillFlags'

const LS_KEY_AGENT = 'duo.sendPill.agent'
const LS_KEY_TERMINAL = 'duo.sendPill.terminal'

describe('useSendPillFlags imperative setters — ENH-176', () => {
  beforeEach(() => {
    // @ts-expect-error — jsdom localStorage shim
    if (typeof window === 'undefined') globalThis.window = {} as Window
    if (!window.localStorage) {
      const store = new Map<string, string>()
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => { store.set(k, v) },
          removeItem: (k: string) => { store.delete(k) },
          clear: () => { store.clear() },
          key: (i: number) => Array.from(store.keys())[i] ?? null,
          get length() { return store.size }
        }
      })
    }
    window.localStorage.clear()
    if (typeof window.dispatchEvent !== 'function') {
      (window as unknown as { dispatchEvent: (e: Event) => boolean }).dispatchEvent = () => true
      ;(globalThis as unknown as { CustomEvent: unknown }).CustomEvent = function (this: { type: string }, type: string) { this.type = type }
    }
  })

  it('setSendPillAgentFlag(true) persists "true"', () => {
    setSendPillAgentFlag(true)
    expect(window.localStorage.getItem(LS_KEY_AGENT)).toBe('true')
  })

  it('setSendPillAgentFlag(false) persists "false"', () => {
    setSendPillAgentFlag(false)
    expect(window.localStorage.getItem(LS_KEY_AGENT)).toBe('false')
  })

  it('setSendPillTerminalFlag(true) persists "true"', () => {
    setSendPillTerminalFlag(true)
    expect(window.localStorage.getItem(LS_KEY_TERMINAL)).toBe('true')
  })

  it('setSendPillTerminalFlag(false) persists "false"', () => {
    setSendPillTerminalFlag(false)
    expect(window.localStorage.getItem(LS_KEY_TERMINAL)).toBe('false')
  })

  it('agent flag does not affect terminal flag (independent)', () => {
    setSendPillAgentFlag(true)
    setSendPillTerminalFlag(false)
    expect(window.localStorage.getItem(LS_KEY_AGENT)).toBe('true')
    expect(window.localStorage.getItem(LS_KEY_TERMINAL)).toBe('false')
  })
})
