// ── Tab / terminal session ───────────────────────────────────────────────────

export interface TabSession {
  id: string
  title: string
  cwd: string
}

// ── Duo socket protocol ──────────────────────────────────────────────────────

export interface DuoRequest {
  id: string
  cmd: DuoCommandName
  args: Record<string, unknown>
}

export interface DuoResponse {
  id: string
  ok: boolean
  result?: unknown
  error?: string
}

export type DuoCommandName =
  | 'navigate'
  | 'open'
  | 'url'
  | 'title'
  | 'dom'
  | 'text'
  | 'ax'
  | 'click'
  | 'fill'
  | 'focus'
  | 'type'
  | 'key'
  | 'eval'
  | 'screenshot'
  | 'console'
  | 'tabs'
  | 'tab'
  | 'close'
  | 'wait'

// ── Console capture ──────────────────────────────────────────────────────────

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'verbose'

export interface ConsoleEntry {
  ts: number            // Date.now() at capture
  level: ConsoleLevel
  source: 'console' | 'log-entry'
  text: string          // human-readable rendering of args
  url?: string
  lineNumber?: number
}

// ── Browser tab state ────────────────────────────────────────────────────────

export interface BrowserTab {
  id: number
  url: string
  title: string
  isActive: boolean
}

export interface BrowserState {
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
}

export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

// ── Skills panel ─────────────────────────────────────────────────────────────

export interface SkillEntry {
  name: string
  path: string
  source: 'SKILL.md' | 'CLAUDE.md' | '.claude/skills'
}

// ── IPC channel names (renderer ↔ main) ─────────────────────────────────────

export const IPC = {
  PTY_CREATE: 'pty:create',
  PTY_WRITE: 'pty:write',
  PTY_RESIZE: 'pty:resize',
  PTY_KILL: 'pty:kill',
  PTY_DATA: (id: string) => `pty:data:${id}`,
  PTY_EXIT: (id: string) => `pty:exit:${id}`,

  // Renderer → main
  BROWSER_NAVIGATE: 'browser:navigate',
  BROWSER_BACK: 'browser:back',
  BROWSER_FORWARD: 'browser:forward',
  BROWSER_RELOAD: 'browser:reload',
  BROWSER_BOUNDS: 'browser:bounds',
  BROWSER_GET_STATE: 'browser:get-state',
  BROWSER_GET_TABS: 'browser:get-tabs',
  BROWSER_ADD_TAB: 'browser:add-tab',
  BROWSER_SWITCH_TAB: 'browser:switch-tab',
  BROWSER_CLOSE_TAB: 'browser:close-tab',

  // Main → renderer
  BROWSER_STATE: 'browser:state',
  BROWSER_TABS: 'browser:tabs',

  SKILLS_SCAN: 'skills:scan',
  SKILLS_RESULT: 'skills:result'
} as const

// ── Electron preload API surface ─────────────────────────────────────────────

export interface ElectronEnv {
  HOME: string
  SHELL: string
}

export interface ElectronPtyAPI {
  create: (id: string, shell?: string, cwd?: string) => Promise<void>
  write: (id: string, data: string) => Promise<void>
  resize: (id: string, cols: number, rows: number) => Promise<void>
  kill: (id: string) => Promise<void>
  onData: (id: string, cb: (data: string) => void) => () => void
  onExit: (id: string, cb: (code: number) => void) => () => void
  // Note: tab titles come from xterm.js Terminal.onTitleChange() (OSC sequences),
  // not via IPC — no main-process emit needed.
}

export interface ElectronBrowserAPI {
  navigate: (url: string) => Promise<{ ok: boolean; url: string; title: string }>
  back: () => void
  forward: () => void
  reload: () => void
  setBounds: (bounds: BrowserBounds) => void
  getState: () => Promise<BrowserState>
  getTabs: () => Promise<BrowserTab[]>
  addTab: (url?: string) => Promise<{ ok: boolean; id: number; url: string; title: string }>
  switchTab: (id: number) => Promise<{ ok: boolean; error?: string }>
  closeTab: (id: number) => Promise<{ ok: boolean; error?: string }>
  onStateChange: (cb: (state: BrowserState) => void) => () => void
  onTabsChange: (cb: (tabs: BrowserTab[]) => void) => () => void
}

export interface ElectronAPI {
  env: ElectronEnv
  pty: ElectronPtyAPI
  browser: ElectronBrowserAPI
}

declare global {
  interface Window {
    electron: ElectronAPI
  }
}
