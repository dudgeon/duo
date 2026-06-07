import ReactDOM from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles/globals.css'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ClaudePresenceProvider } from './contexts/ClaudePresenceContext'

// BUG-065 — global listeners for window-level errors and unhandled
// promise rejections. The Error Boundary below catches render
// errors; these handle async ones (promise rejections from event
// handlers, IPC callbacks, etc.) by at least logging them so
// dev-tools / future telemetry can surface them.
window.addEventListener('error', (event) => {
  // eslint-disable-next-line no-console
  console.error('[window.error]', event.error ?? event.message, event)
})
window.addEventListener('unhandledrejection', (event) => {
  // eslint-disable-next-line no-console
  console.error('[unhandledrejection]', event.reason)
})

// StrictMode intentionally omitted: the renderer owns real side-effect resources
// (PTY sessions, CDP debugger attach) where StrictMode's dev-mode double-invoke
// tears them down and recreates them, producing spurious "[process exited]"
// frames and wasted native process churn. Re-enable only after effects are
// idempotent at the resource level.
//
// BUG-065 — ErrorBoundary wraps App so any uncaught render error
// surfaces as a visible fallback panel instead of blanking the
// entire window. Doesn't recover state, but converts "what
// happened?" → "here's the error, here's a Reload button."
ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <ClaudePresenceProvider>
      <App />
    </ClaudePresenceProvider>
  </ErrorBoundary>
)
