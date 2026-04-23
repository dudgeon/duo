import { homedir } from 'os'
import { join } from 'path'

export const APP_NAME = 'Duo'
export const APP_VERSION = '0.1.0'

export const DUO_DIR = join(homedir(), 'Library', 'Application Support', 'duo')
export const SOCKET_PATH = join(DUO_DIR, 'duo.sock')

export const SKILL_SOURCE_DIR = 'skill' // relative to app resources
export const SKILL_INSTALL_DIR = join(homedir(), '.claude', 'skills', 'duo')

export const BROWSER_SESSION_PARTITION = 'persist:duo-browser'
export const BROWSER_SESSION_PATH = join(DUO_DIR, 'browser-session')

export const DEFAULT_SHELL = process.env.SHELL ?? '/bin/zsh'
export const DEFAULT_CWD = homedir()

export const TERMINAL_DEFAULTS = {
  cols: 80,
  rows: 24,
  scrollback: 10_000
}
