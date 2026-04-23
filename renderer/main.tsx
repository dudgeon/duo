import ReactDOM from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles/globals.css'
import { App } from './App'

// StrictMode intentionally omitted: the renderer owns real side-effect resources
// (PTY sessions, CDP debugger attach) where StrictMode's dev-mode double-invoke
// tears them down and recreates them, producing spurious "[process exited]"
// frames and wasted native process churn. Re-enable only after effects are
// idempotent at the resource level.
ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
