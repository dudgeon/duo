/**
 * Duo Web — renderer entry.
 *
 * Boot order:
 *   1. Install the window.electron shim onto the global so any imported
 *      renderer code finds it on first reference.
 *   2. Connect the WebSocket + auth.
 *   3. Mount React.
 *
 * Steps 1 and 2 must complete before mount or the first render hits an
 * undefined `window.electron`.
 */

import ReactDOM from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import '../../../renderer/styles/globals.css'

import { connect, buildElectronApi, whenConnected } from './electron-shim'
import { WebApp } from './WebApp'

async function main(): Promise<void> {
  // 1. Build the shim NOW so any import-time `window.electron` accesses
  //    by transitive renderer imports don't crash. Methods will queue
  //    until the WS is open.
  ;(window as unknown as { electron: ReturnType<typeof buildElectronApi> }).electron =
    buildElectronApi()

  // 2. Connect.
  await connect()
  await whenConnected()

  // 3. Now that env (HOME, SHELL) is filled in, build a fresh shim so
  //    components reading `window.electron.env` see the real values.
  ;(window as unknown as { electron: ReturnType<typeof buildElectronApi> }).electron =
    buildElectronApi()

  // 4. Mount.
  ReactDOM.createRoot(document.getElementById('root')!).render(<WebApp />)
}

main().catch((err) => {
  document.body.innerHTML = `<pre style="padding:20px;color:#b91c1c">${
    err instanceof Error ? err.message : String(err)
  }</pre>`
})
