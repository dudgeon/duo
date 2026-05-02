// BUG-065 (v0.6.3) — defensive Error Boundary.
//
// Without this, ANY uncaught render error in the renderer collapses
// the entire React tree to a blank document — no DOM under <body>,
// no surfaces visible. Two such incidents during the v0.6.3 walk-1
// (one from dual-Electron-instance state corruption, one from a
// still-unidentified path through ⌘⇧G + navigator focus) showed
// the user a fully blank Electron window with traffic lights and
// nothing else.
//
// This boundary doesn't RECOVER the app — there's no general way to
// recover from a render error mid-tree without dropping all
// component state — but it converts "blank window" into "visible
// error message + Reload button" so:
//   1. The user can see SOMETHING happened (vs. wondering whether
//      the app crashed silently).
//   2. The error message + stack is captured in plain sight, so the
//      next recurrence is diagnosable instead of a black box.
//   3. The Reload button gives a one-click recovery path that
//      doesn't require dock-bar app management.
//
// Caveat: a render error in a CHILD of this boundary is caught;
// errors in the boundary's own render are not. Keep this component
// minimal so it can't itself throw.

import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: { componentStack?: string } | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, errorInfo: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null }
  }

  componentDidCatch(error: Error, errorInfo: { componentStack?: string }) {
    // Logging surface — the dev-tools console already shows the error
    // via React's default unhandled-error logging, but our explicit
    // log makes it grep-able in any future error-aggregation pipeline
    // and survives if console output gets crowded.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] caught render error:', error, errorInfo)
    this.setState({ errorInfo })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const { error, errorInfo } = this.state
    const stack = errorInfo?.componentStack ?? error?.stack ?? ''

    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          padding: '32px',
          background: '#fbf8f1',
          color: '#2b2620',
          fontFamily: '-apple-system, "SF Pro Text", system-ui, sans-serif',
          fontSize: '14px',
          lineHeight: 1.5,
          overflow: 'auto',
          zIndex: 9999
        }}
      >
        <div style={{ maxWidth: '720px', margin: '0 auto' }}>
          <h1
            style={{
              fontFamily: '"New York", "Iowan Old Style", Georgia, serif',
              fontStyle: 'italic',
              fontSize: '22px',
              fontWeight: 500,
              margin: '0 0 8px',
              color: '#2b2620'
            }}
          >
            Duo hit a render error
          </h1>
          <p style={{ color: '#6f6557', margin: '0 0 16px' }}>
            Something in the renderer threw mid-render and the React tree
            unmounted. Reload to recover; if the error reproduces, capture
            the message below to file a bug.
          </p>
          <div
            style={{
              background: '#f3ede0',
              border: '1px solid #d9cea8',
              borderRadius: '6px',
              padding: '12px 16px',
              marginBottom: '16px',
              fontFamily: '"SF Mono", ui-monospace, Menlo, Consolas, monospace',
              fontSize: '12px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: '#4a4238',
              maxHeight: '40vh',
              overflow: 'auto'
            }}
          >
            <strong>{error?.name ?? 'Error'}: </strong>
            {error?.message ?? 'unknown'}
            {stack && (
              <>
                {'\n\n'}
                <span style={{ color: '#6f6557' }}>{stack}</span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              appearance: 'none',
              background: '#c46a1c',
              color: 'white',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '5px',
              fontFamily: 'inherit',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer'
            }}
          >
            Reload renderer
          </button>
        </div>
      </div>
    )
  }
}
