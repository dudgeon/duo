/**
 * Duo Web — daemon constants.
 *
 * Mirrors `electron/constants.ts` for the bits the daemon needs.
 * Diverges where the runtime contract differs (no Application Support
 * dir; loopback-only HTTP + token).
 */

import { homedir } from 'os'
import { join } from 'path'

export const APP_NAME = 'Duo Web'
export const APP_VERSION = '0.5.0-web.0'

/** Per-user state directory. ~/.duo/ keeps web-only state out of the
 *  Electron app's `~/Library/Application Support/duo/` to avoid any
 *  accidental coupling between the two installs. */
export const STATE_DIR = join(homedir(), '.duo')

/** Token + port used by the renderer's HTTP bootstrap and the duo CLI's
 *  TCP transport. Format: `{ port: number, token: string }`. Mode 0600. */
export const PORT_FILE = join(STATE_DIR, 'web.port')

/** Loopback bind. Never bind 0.0.0.0 — even with the token, exposing the
 *  PTY-spawn surface to a LAN is a non-starter. */
export const HTTP_BIND = '127.0.0.1'

/** 0 = ephemeral. The PORT_FILE publishes the chosen port. */
export const HTTP_PORT_DEFAULT = Number(process.env.DUO_WEB_PORT ?? 0)

export const DEFAULT_SHELL = process.env.SHELL ?? '/bin/zsh'
export const DEFAULT_CWD = homedir()

export const TERMINAL_DEFAULTS = {
  cols: 80,
  rows: 24,
  scrollback: 10_000
}
