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
  | 'url'
  | 'title'
  | 'dom'
  | 'text'
  | 'click'
  | 'fill'
  | 'eval'
  | 'screenshot'
  | 'tabs'
  | 'tab'
  | 'wait'

// ── Browser tab state ────────────────────────────────────────────────────────

export interface BrowserTab {
  id: number
  url: string
  title: string
  isActive: boolean
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
  PTY_TITLE: (id: string) => `pty:title:${id}`,

  BROWSER_NAVIGATE: 'browser:navigate',
  BROWSER_STATE: 'browser:state',

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
  onTitle: (id: string, cb: (title: string) => void) => () => void
}

export interface ElectronAPI {
  env: ElectronEnv
  pty: ElectronPtyAPI
}

declare global {
  interface Window {
    electron: ElectronAPI
  }
}
