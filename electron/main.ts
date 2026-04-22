import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { join } from 'path'
import { PtyManager } from './pty-manager'
import { IPC } from '../shared/types'

nativeTheme.themeSource = 'dark'

let mainWindow: BrowserWindow | null = null
const ptyManager = new PtyManager()

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

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
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
}
