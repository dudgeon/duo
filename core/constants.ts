import { homedir } from 'os'
import { join } from 'path'

export const APP_NAME = 'Duo'
export const APP_VERSION = '0.1.0'

export const DUO_DIR = join(homedir(), 'Library', 'Application Support', 'duo')
export const SOCKET_PATH = join(DUO_DIR, 'duo.sock')

// Stage 20 — TCP fallback. Claude Code's macOS sandbox blocks Unix
// sockets by default but allows localhost TCP, so we publish an
// ephemeral 127.0.0.1 port + per-launch auth token for the CLI to
// fall back on. See docs/DECISIONS.md → *Sandbox-tolerant transport*.
export const PORT_FILE = join(DUO_DIR, 'duo.port')

export const SKILL_SOURCE_DIR = 'skill' // relative to app resources
export const SKILL_INSTALL_DIR = join(homedir(), '.claude', 'skills', 'duo')

// Stage 19b — PATH shim for `claude`. PtyManager prepends SHIM_DIR to
// every spawned PTY's env.PATH so any `claude` invocation inside a Duo
// terminal hits our wrapper (which calls real-claude with
// `--append-system-prompt <priming-content>`). Outside Duo the shim is
// a no-op pass-through, so it's safe even if a user accidentally adds
// SHIM_DIR to their global PATH. Lives next to priming.md / pins.json
// in ~/.claude/duo/ so the whole user-facing Duo state tree stays in
// one place.
export const SHIM_DIR = join(homedir(), '.claude', 'duo', 'bin')

// Stage 18b — Distro skill packs live under ~/.claude/duo/packs/.
// Each subdirectory is one pack, identified by a PACK.json manifest
// at its root. The pack directory's basename is the canonical pack
// name; the loader rejects packs whose `name` field disagrees.
export const PACKS_DIR = join(homedir(), '.claude', 'duo', 'packs')

// Stage 18b — Per-pack first-launch state. Keyed on `<name>@<version>`
// so a pack version bump re-fires the first-launch defaults. Atomic
// tmp-rename writes; missing/corrupt = treat all packs as not-yet-
// first-launched (defaults fire on next boot).
export const INSTALLED_PACKS_PATH = join(homedir(), '.claude', 'duo', 'installed-packs.json')

export const BROWSER_SESSION_PARTITION = 'persist:duo-browser'
export const BROWSER_SESSION_PATH = join(DUO_DIR, 'browser-session')

export const DEFAULT_SHELL = process.env.SHELL ?? '/bin/zsh'
export const DEFAULT_CWD = homedir()

export const TERMINAL_DEFAULTS = {
  cols: 80,
  rows: 24,
  scrollback: 10_000
}
