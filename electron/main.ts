import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { join } from 'path'
import { PtyManager } from './pty-manager'
import { BrowserManager } from './browser-manager'
import { CdpBridge } from './cdp-bridge'
import { SocketServer, ensureSocketDir } from './socket-server'
import { IPC } from '../shared/types'
import type { BrowserBounds, BrowserState, BrowserTab } from '../shared/types'

nativeTheme.themeSource = 'dark'

let mainWindow: BrowserWindow | null = null
const ptyManager = new PtyManager()
let browserManager: BrowserManager | null = null
let socketServer: SocketServer | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#080808',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false // required for preload to use Node.js APIs
    }
  })

  ptyManager.setWebContents(mainWindow.webContents)

  // Browser manager owns WebContentsViews and forwards state to renderer
  const cdpBridge = new CdpBridge()
  browserManager = new BrowserManager(
    mainWindow,
    cdpBridge,
    (state: BrowserState) => mainWindow?.webContents.send(IPC.BROWSER_STATE, state),
    (tabs: BrowserTab[]) => mainWindow?.webContents.send(IPC.BROWSER_TABS, tabs)
  )

  // Socket server starts listening; CLI connects here
  ensureSocketDir()
  socketServer = new SocketServer(cdpBridge, browserManager)
  socketServer.start()

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Once the renderer reports its bounds, attach CDP to the active tab
  mainWindow.webContents.once('did-finish-load', async () => {
    if (browserManager) await browserManager.attachCdp()
  })

  mainWindow.on('closed', () => {
    socketServer?.stop()
    browserManager?.dispose()
    mainWindow = null
    browserManager = null
    socketServer = null
  })
}

app.whenReady().then(() => {
  setupIPC()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  ptyManager.dispose()
  if (process.platform !== 'darwin') app.quit()
})

function setupIPC(): void {
  // ── PTY ──────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.PTY_CREATE, (_event, { id, shell, cwd }: { id: string; shell?: string; cwd?: string }) => {
    ptyManager.create(id, shell, cwd)
  })

  ipcMain.handle(IPC.PTY_WRITE, (_event, { id, data }: { id: string; data: string }) => {
    ptyManager.write(id, data)
  })

  ipcMain.handle(IPC.PTY_RESIZE, (_event, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
    ptyManager.resize(id, cols, rows)
  })

  ipcMain.handle(IPC.PTY_KILL, (_event, { id }: { id: string }) => {
    ptyManager.kill(id)
  })

  // ── Browser ───────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.BROWSER_NAVIGATE, async (_event, { url }: { url: string }) => {
    if (!browserManager) return { ok: false, error: 'BrowserManager not ready' }
    return browserManager.navigate(url)
  })

  ipcMain.on(IPC.BROWSER_BACK, () => {
    browserManager?.goBack()
  })

  ipcMain.on(IPC.BROWSER_FORWARD, () => {
    browserManager?.goForward()
  })

  ipcMain.on(IPC.BROWSER_RELOAD, () => {
    browserManager?.reload()
  })

  // Renderer reports the pixel bounds of the browser content area whenever
  // the split moves or the window resizes. We reposition the WebContentsView.
  ipcMain.on(IPC.BROWSER_BOUNDS, (_event, bounds: BrowserBounds) => {
    browserManager?.setBounds(bounds)
  })

  ipcMain.handle(IPC.BROWSER_GET_STATE, () => {
    return browserManager?.getState() ?? null
  })

  ipcMain.handle(IPC.BROWSER_GET_TABS, () => {
    return browserManager?.getTabs() ?? []
  })

  ipcMain.handle(IPC.BROWSER_ADD_TAB, async (_event, { url }: { url?: string }) => {
    if (!browserManager) return { id: -1 }
    return browserManager.openTab(url)
  })

  ipcMain.handle(IPC.BROWSER_SWITCH_TAB, async (_event, { id }: { id: number }) => {
    if (!browserManager) return { ok: false, error: 'BrowserManager not ready' }
    return browserManager.switchTab(id)
  })

  ipcMain.handle(IPC.BROWSER_CLOSE_TAB, async (_event, { id }: { id: number }) => {
    if (!browserManager) return { ok: false, error: 'BrowserManager not ready' }
    return browserManager.closeTab(id)
  })
}
