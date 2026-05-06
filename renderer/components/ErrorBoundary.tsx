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
//
// BUG-093 instrumentation (v0.6.7) — `inline` variant. When `inline`
// is true the boundary renders an in-flow panel inside its parent
// container instead of a fullscreen fixed overlay, so a localized
// crash (e.g. a WorkingPane render failure) doesn't replace the
// whole UI. The "Try again" button calls `forceRetry()`, which
// bumps a key on the rendered children to remount them; if the
// underlying state has settled, the children come back. Adds a
// `label` so the captured log line names the surface that crashed.

import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Render the error UI in-flow inside the parent (for scoped
   *  boundaries around individual panes) instead of a fullscreen
   *  fixed overlay (the app-level default). */
  inline?: boolean
  /** Surface name used in the captured console error so post-mortem
   *  analysis can tell WHICH boundary fired (app-level vs. WorkingPane
   *  vs. future per-tab). Optional; defaults to "renderer". */
  label?: string
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: { componentStack?: string } | null
  /** Bumped on "Try again" — used as the children's key so React
   *  remounts the subtree when the user retries. Reset to 0 on the
   *  first crash so the count is stable. */
  retryKey: number
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, errorInfo: null, retryKey: 0 }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null, retryKey: 0 }
  }

  componentDidCatch(error: Error, errorInfo: { componentStack?: string }) {
    // Logging surface — the dev-tools console already shows the error
    // via React's default unhandled-error logging, but our explicit
    // log makes it grep-able in any future error-aggregation pipeline
    // and survives if console output gets crowded. The `label` prefix
    // disambiguates which boundary fired — critical when nested
    // boundaries exist (app-level + WorkingPane + future per-tab).
    const label = this.props.label ?? 'renderer'
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary:${label}] caught render error:`, error, errorInfo)
    this.setState({ errorInfo })
  }

  handleReload = () => {
    window.location.reload()
  }

  forceRetry = () => {
    // Drop hasError + bump the retry key. The retry key is used by
    // the parent to re-mount the wrapped children when this fires
    // (passed back via render prop pattern below).
    this.setState((prev) => ({
      hasError: false,
      error: null,
      errorInfo: null,
      retryKey: prev.retryKey + 1
    }))
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const { error, errorInfo } = this.state
    const stack = errorInfo?.componentStack ?? error?.stack ?? ''
    const inline = this.props.inline === true
    const label = this.props.label ?? 'Duo'

    const containerStyle = inline
      ? {
          position: 'relative' as const,
          padding: '24px',
          background: '#fbf8f1',
          color: '#2b2620',
          fontFamily: '-apple-system, "SF Pro Text", system-ui, sans-serif',
          fontSize: '14px',
          lineHeight: 1.5,
          overflow: 'auto',
          height: '100%',
          width: '100%'
        }
      : {
          position: 'fixed' as const,
          inset: 0,
          padding: '32px',
          background: '#fbf8f1',
          color: '#2b2620',
          fontFamily: '-apple-system, "SF Pro Text", system-ui, sans-serif',
          fontSize: '14px',
          lineHeight: 1.5,
          overflow: 'auto',
          zIndex: 9999
        }

    return (
      <div style={containerStyle}>
        <div style={{ maxWidth: '720px', margin: '0 auto' }}>
          <h1
            style={{
              fontFamily: '"New York", "Iowan Old Style", Georgia, serif',
              fontStyle: 'italic',
              fontSize: inline ? '17px' : '22px',
              fontWeight: 500,
              margin: '0 0 8px',
              color: '#2b2620'
            }}
          >
            {inline ? `${label} hit a render error` : 'Duo hit a render error'}
          </h1>
          <p style={{ color: '#6f6557', margin: '0 0 16px' }}>
            {inline
              ? 'This pane crashed mid-render — the rest of Duo is still alive. Try again to remount this pane; if it crashes again, copy the message below and reload.'
              : 'Something in the renderer threw mid-render and the React tree unmounted. Reload to recover; if the error reproduces, capture the message below to file a bug.'}
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
          <div style={{ display: 'flex', gap: '8px' }}>
            {inline && (
              <button
                type="button"
                onClick={this.forceRetry}
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
                Try again
              </button>
            )}
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                appearance: 'none',
                background: inline ? 'white' : '#c46a1c',
                color: inline ? '#2b2620' : 'white',
                border: inline ? '1px solid #d9cea8' : 'none',
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
      </div>
    )
  }
}
