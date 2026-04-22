import { homedir } from 'os'
import { join } from 'path'

export const APP_NAME = 'Orbit'
export const APP_VERSION = '0.1.0'

export const ORBIT_DIR = join(homedir(), '.orbit')
export const SOCKET_PATH = join(ORBIT_DIR, 'orbit.sock')

export const SKILL_SOURCE_DIR = 'skill' // relative to app resources
export const SKILL_INSTALL_DIR = join(homedir(), '.claude', 'skills', 'orbit')

export const BROWSER_SESSION_PARTITION = 'persist:orbit-browser'
export const BROWSER_SESSION_PATH = join(
  homedir(),
  'Library',
  'Application Support',
  'orbit',
  'browser-session'
)

export const DEFAULT_SHELL = process.env.SHELL ?? '/bin/zsh'
export const DEFAULT_CWD = homedir()

export const TERMINAL_DEFAULTS = {
  cols: 80,
  rows: 24,
  scrollback: 10_000
}
