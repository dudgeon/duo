// @vitest-environment jsdom
//
// FOLLOWUP-031 — durable guard. The claude-presence subscription is hoisted to a
// single context provider, so the number of onClaudePresenceChange IPC listeners
// is 1 regardless of how many components consume it. Before this it was one per
// useClaudePresence() call, which tripped Node's MaxListenersExceededWarning once
// a session had ~9+ terminal tabs open. (createElement, not JSX, to stay a
// .test.ts — the repo's vitest include is **/*.test.ts.)

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { render } from '@testing-library/react'
import { ClaudePresenceProvider } from './ClaudePresenceContext'
import { useClaudePresence, useFrontTerminalClaudeLive } from '../hooks/useClaudePresence'

function PresenceConsumer() { useClaudePresence(); return null }
function LiveConsumer() { useFrontTerminalClaudeLive(); return null }

const prevElectron = (window as unknown as { electron?: unknown }).electron
afterEach(() => {
  ;(window as unknown as { electron?: unknown }).electron = prevElectron
  vi.restoreAllMocks()
})

describe('ClaudePresenceContext — FOLLOWUP-031', () => {
  it('registers exactly ONE onClaudePresenceChange listener for many consumers', () => {
    const subscribe = vi.fn(() => () => {})
    ;(window as unknown as { electron: unknown }).electron = { terminal: { onClaudePresenceChange: subscribe } }

    const consumers = [
      ...Array.from({ length: 12 }, (_, i) => createElement(PresenceConsumer, { key: 'p' + i })),
      ...Array.from({ length: 4 }, (_, i) => createElement(LiveConsumer, { key: 'l' + i })),
    ]
    render(createElement(ClaudePresenceProvider, null, consumers))

    // 16 consumers mounted, but the provider owns the single subscription.
    expect(subscribe).toHaveBeenCalledTimes(1)
  })
})
