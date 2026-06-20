#!/usr/bin/env node
/**
 * duo CLI — the agent's API surface into the running Duo app.
 * Called by Claude Code like any shell command; communicates with the Electron
 * main process over a Unix socket at ~/Library/Application Support/duo/duo.sock
 *
 * See §9 of duo-brief.md for the full command reference.
 */

import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { randomUUID } from 'crypto'
import type { DuoRequest, DuoResponse } from '../shared/types'
// ENH-208 Vault — the vault core is a pure fs-backed module (no Electron
// deps), so these verbs run ENTIRELY in the CLI process against the
// filesystem: no socket round-trip, no running app required. That is a
// deliberate parity asymmetry (it's what lets a headless processing job
// read the vault — PRD Phase 4). Only `base render --open` / `vault
// capture --open` reach the app (to surface a tab), and only when asked.
import * as vault from '../core/vault'
import { listWorktrees, createWorktree, removeWorktree } from '../core/git/worktree'

// Injected at build time from package.json by scripts/build-cli.mjs via
// esbuild `define`, so the CLI version always tracks the real release —
// no hand-bumped constant to forget. The `typeof` guard keeps a bare
// `esbuild` invocation (no define) from emitting a ReferenceError: it
// falls back to a clearly-not-real sentinel instead of a stale literal.
declare const __DUO_VERSION__: string
const VERSION = typeof __DUO_VERSION__ !== 'undefined' ? __DUO_VERSION__ : '0.0.0-dev'

// ── Verb inventory ───────────────────────────────────────────────────────────
// Single source of truth for the top-level verbs. `printHelp()` renders its
// COMMANDS block from this array (grouped + column-aligned), so adding a verb
// here keeps the global help in sync. Summaries are distilled — keep them to
// one or two short lines. `args` is the usage fragment shown after the name;
// `aliasOf` marks a back-compat spelling that should NOT get its own help row
// (its canonical form is rendered instead).
interface VerbSpec {
  name: string
  group: string
  summary: string
  args?: string
  aliasOf?: string
}

const VERBS: VerbSpec[] = [
  // ── Browser & tabs ──
  {
    name: 'navigate',
    group: 'Browser & tabs',
    args: '<url>',
    summary:
      'Open a URL in a NEW browser tab (or focus an existing tab whose URL matches). URLs only — never clobbers the active tab. For a local file use "open"; to move the navigator use "reveal".'
  },
  {
    name: 'open',
    group: 'Browser & tabs',
    args: '<path-or-url> [--canvas] [--reveal]',
    summary:
      'Open a local file or URL. HTML defaults to the browser pane (scripts run, interactive) — use this to show the user a generated explainer / playground. Non-HTML routes to its natural surface (.md → editor, image → viewer). --canvas forces canvas mode (source-editable, scripts blocked); --reveal expands the working pane.'
  },
  {
    name: 'reload',
    group: 'Browser & tabs',
    summary: 'Reload the active browser tab in place (no URL needed) — the iteration-loop pair for "navigate".'
  },
  {
    name: 'tabs',
    group: 'Browser & tabs',
    summary: 'List open browser tabs (JSON).'
  },
  {
    name: 'tab',
    group: 'Browser & tabs',
    args: '<n>',
    summary: 'Switch to browser tab N.'
  },
  {
    name: 'close',
    group: 'Browser & tabs',
    args: '<n>',
    summary: 'Close browser tab N (a tab id from "duo tabs"; cannot close the last).'
  },
  {
    name: 'window',
    group: 'Windows',
    args: 'new [--cwd <path>]',
    summary:
      'Open a second app window — blank, with its own workspace, browser pane, and navigator. Same action as File → New Window (Opt+Cmd+N). --cwd roots the new window\'s navigator at a path (e.g. a git worktree) — the CLI twin of the navigator Worktrees dropdown\'s "open in new window". Requires "Allow Multiple Windows" (Settings menu, default on); exits non-zero with a clean disabled-error when off. Subcommand: new.'
  },
  {
    name: 'windows',
    group: 'Windows',
    args: '',
    summary:
      'List open app windows as JSON: [{id, primary, focused, activeWorkspace}]. Pair with the global "--window N" flag (or a terminal\'s DUO_WINDOW env, auto-stamped per window) to address a specific window, e.g. "duo --window 2 dom body".'
  },
  {
    name: 'external',
    group: 'Browser & tabs',
    args: '<url>',
    summary: 'Open <url> in the macOS default browser (http(s) / mailto only) — for sites that do not render well in the embedded pane.'
  },
  {
    name: 'browser-mode',
    group: 'Browser & tabs',
    args: '[unfiltered|filtered|local-only]',
    summary:
      'Read or set the embedded browser URL filter. Default local-only: only file:// + localhost + 127.0.0.1 + [::1] render; everything else pops the system browser. filtered consults external-domains.json. unfiltered is DEBUG ONLY and requires --i-understand. No arg prints { mode }.'
  },
  {
    name: 'inspect',
    group: 'Browser & tabs',
    args: '[--on|--off]',
    summary:
      'Toggle element-inspect mode in the active browser pane (no arg toggles; --on/--off force). Hover outlines an element; click ships its tag + selector + heading trail + innerText to the active terminal. ESC exits. Chord ⌘⇧C inside the pane is the keystroke equivalent.'
  },

  // ── Read & inspect ──
  {
    name: 'url',
    group: 'Read & inspect',
    summary: 'Print the current browser URL.'
  },
  {
    name: 'title',
    group: 'Read & inspect',
    summary: 'Print the current page title.'
  },
  {
    name: 'dom',
    group: 'Read & inspect',
    args: '[<selector>] [--attr <n>] [--text] [--all] [--computed p1,p2] [--js "<expr>"]',
    summary:
      'Bare "duo dom" prints the browser pane\'s full HTML. With a selector, queries the main RENDERER (the React shell — useful for debugging editor / canvas / image-viewer state). --attr returns one attribute, --text returns textContent, --all returns an array of matches, --computed returns getComputedStyle props, --js evaluates an arbitrary expression in the renderer.'
  },
  {
    name: 'text',
    group: 'Read & inspect',
    args: '[--selector <css>]',
    summary: 'Print visible page text (or the matched element\'s text).'
  },
  {
    name: 'ax',
    group: 'Read & inspect',
    args: '[--selector <css>] [--format md|json]',
    summary: 'Print the accessibility tree (required for Google Docs and other canvas-rendered apps).'
  },
  {
    name: 'selection',
    group: 'Read & inspect',
    args: '[--pane auto|editor|browser|canvas]',
    summary:
      'Print the active surface\'s selection as JSON. Default --pane auto prefers a non-empty browser highlight, then a non-empty canvas selection, falling back to the editor\'s cached selection (informative even when collapsed — it carries the caret\'s paragraph + heading trail). Returns null when nothing is active.'
  },
  {
    name: 'screenshot',
    group: 'Read & inspect',
    args: '[--out <path>] [--selector <css>]',
    summary: 'Capture a screenshot of the browser pane (whole page or a matched element). --out writes a PNG; otherwise base64 is printed.'
  },

  // ── Interact ──
  {
    name: 'click',
    group: 'Interact',
    args: '<selector>',
    summary: 'Click an element in the browser pane by CSS selector.'
  },
  {
    name: 'fill',
    group: 'Interact',
    args: '<selector> <value>',
    summary: 'Fill an input in the browser pane.'
  },
  {
    name: 'focus',
    group: 'Interact',
    args: '<selector>',
    summary: 'Move browser-pane focus to the matching element (distinct from "focus-pane", which jumps between app panes).'
  },
  {
    name: 'type',
    group: 'Interact',
    args: '<text>',
    summary: 'Synthesize text input into the focused browser-pane element.'
  },
  {
    name: 'key',
    group: 'Interact',
    args: '<keyname> [--modifiers cmd,shift,...]',
    summary: 'Dispatch a named key (Enter, ArrowDown, Backspace, …) with optional modifiers. Cross-platform navigation combos are translated to Mac-native equivalents.'
  },
  {
    name: 'eval',
    group: 'Interact',
    args: '<js>',
    summary: 'Execute JS in the browser pane and return the result.'
  },
  {
    name: 'wait',
    group: 'Interact',
    args: '<selector> [--timeout ms]',
    summary: 'Wait for an element to appear in the browser pane (socket timeout extends to outlast --timeout).'
  },

  // ── Diagnostics ──
  {
    name: 'console',
    group: 'Diagnostics',
    args: '[--since <ts>] [--level log,warn,...] [--limit N]',
    summary: 'Dump buffered browser console messages (NDJSON, one event per line).'
  },
  {
    name: 'errors',
    group: 'Diagnostics',
    args: '[--since <ts>] [--limit N]',
    summary: 'Print uncaught browser exceptions (NDJSON; separate from "console", populated by Runtime.exceptionThrown).'
  },
  {
    name: 'network',
    group: 'Diagnostics',
    args: '[--since <ts>] [--filter <regex>] [--limit N]',
    summary: 'Print HTTP requests stitched from network events (NDJSON). --filter matches against the URL.'
  },
  {
    name: 'events',
    group: 'Diagnostics',
    args: '[--follow] [--since <cursor>] [--limit N]',
    summary:
      'Stream structured events from the event bus. Snapshot mode prints one JSON line per event from the ring (most-recent N with --limit; whole ring without). --follow keeps the connection open and prints each new event. --since <cursor> resumes from a known cursor (format <unix-ms>-<seq>).'
  },
  {
    name: 'devtools',
    group: 'Diagnostics',
    args: '[--browser-pane] [--close]',
    summary: 'Open DevTools on the main renderer (default) or the active browser pane. --close closes any open instance for the target. Sister to "duo dom" for the rare case a targeted query is not enough.'
  },
  {
    name: 'doctor',
    group: 'Diagnostics',
    summary:
      'Health-check both transports (Unix socket + TCP fallback), report the app/CLI version match, $DUO_SESSION presence, install path, and skill files. First move when a duo command fails — names the failure mode instead of dying silently. Exits 0 if either transport is reachable.'
  },

  // ── Files & navigator ──
  {
    name: 'view',
    group: 'Files & navigator',
    args: '<path> [--canvas]',
    summary:
      'Open a file in the working pane (new tab; type inferred from extension). Distinct from "open" (which opens a URL/HTML in a browser tab). --canvas forces canvas-mode mount — useful to view or edit a playground\'s source without firing its scripts.'
  },
  {
    name: 'edit',
    group: 'Files & navigator',
    args: '<path> [--browser] [--reveal]',
    summary:
      'Open a file to edit its source. HTML defaults to canvas mode (buttons inert, scripts blocked, document editable); .md opens in the rich editor; images / PDFs / JSON fall through to their viewers. --browser forces browser mode for HTML (symmetric with "open --canvas"); --canvas is accepted as a deprecated no-op; --reveal expands the working pane.'
  },
  {
    name: 'image',
    group: 'Files & navigator',
    args: 'insert <path> [--alt "…"]',
    summary: 'Save an image alongside the active markdown editor\'s doc and insert it at the caret (markdown only). Optional --alt sets alt text.'
  },
  {
    name: 'file',
    group: 'Files & navigator',
    args: '<rename|trash> ...',
    summary: 'file rename <old> <new> moves within the same filesystem (atomic); file trash <path> moves to the macOS Trash (recoverable). Mirrors the navigator\'s right-click Rename / Delete.'
  },
  {
    name: 'reveal',
    group: 'Files & navigator',
    args: '<path>',
    summary: 'Move the file navigator to <path> and surface a dismissible chip so the user knows you moved their tree.'
  },
  {
    name: 'ls',
    group: 'Files & navigator',
    args: '[path]',
    summary: 'List directory contents (JSON). Defaults to the navigator\'s current folder.'
  },
  {
    name: 'nav',
    group: 'Files & navigator',
    args: '<state|pin|unpin|pins> [<path>]',
    summary:
      'nav state prints navigator state (cwd, selection, expanded folders, pinned flag). nav pin <path> / nav unpin <path> manage the navigator\'s "Pinned" section (stored separately from tab pins); nav pins lists them.'
  },
  {
    name: 'nav-state',
    group: 'Files & navigator',
    aliasOf: 'nav state',
    summary: 'Back-compat alias for "duo nav state".'
  },
  {
    name: 'hidden-files',
    group: 'Files & navigator',
    args: '[show|hide|toggle]',
    summary: 'Show or hide dotfiles in the navigator (parity with View → Show Hidden Files, ⌘⇧.). .claude + .obsidian stay visible regardless. No arg prints { showDotfiles }.'
  },

  // ── Markdown editor (doc) ──
  {
    name: 'doc',
    group: 'Markdown editor (doc)',
    args: '<subcmd> [args]',
    summary:
      'Markdown editor operations against the live buffer. read / write / goto / find / edit (plain-text), plus CriticMarkup ops insert / delete / substitute / highlight / comment / accept / reject, and conflict-log. Run "duo doc --help" (or "duo doc <subcmd> --help") for focused help.'
  },
  {
    name: 'author',
    group: 'Markdown editor (doc)',
    args: '[<name>]',
    summary: 'Read or set the human author identity used for CriticMarkup attribution (insertions / deletions / comments). No arg prints state (JSON); a name persists + prints. Agents set their own via the DUO_AUTHOR env var.'
  },
  {
    name: 'json',
    group: 'Markdown editor (doc)',
    args: '<set|merge> <file> ...',
    summary:
      'Structured edits to a JSON / YAML file. json set <file> <dotpath> <value> sets a value (dotpath uses dots + [n] indices; "" or "." = root; value parsed as JSON if valid, else literal string). json merge <file> <patch.json> deep-merges an object. Echo-safe when the file is open; disk-direct when closed. YAML round-trips lose comments.'
  },
  {
    name: 'selection-format',
    group: 'Markdown editor (doc)',
    args: '[a|b|c]',
    summary: 'Read or set the Send → Duo payload format: a = quote + provenance (default), b = literal text only, c = opaque token. No arg prints current; an arg sets + persists.'
  },

  // ── HTML canvas ──
  {
    name: 'html',
    group: 'HTML canvas',
    args: '<subcmd> [args]',
    summary:
      'Create + drive an HTML canvas. html new <path.html> [--title] scaffolds + opens a file. Ops against the active canvas target by --id <duo-id> or --selector <css>: query, get, set (replace innerHTML, --content/stdin), replace (replace outerHTML, --html/stdin), append (--parent…), remove, attr (--set/--remove), click (fires data-duo-action verbs). comment / comments anchor + list threads in <file>.duo.json.'
  },

  // ── Working pane & layout ──
  {
    name: 'split',
    group: 'Working pane & layout',
    args: '<pct|preset>',
    summary:
      'Set the split-pane percentage (terminal column as % of the split container; numeric clamps to 20–80). Presets: even (50), terminal-heavy (67), canvas-heavy (33), terminal (80), canvas (20), 3way (outer 33/67 + inner aux 50/50). Mirrors View → Pane size and ⌘⌥1/2/3/4/0/9.'
  },
  {
    name: 'split-view',
    group: 'Working pane & layout',
    args: '<op> [args]',
    summary:
      'Split View aux pane. Sub-verbs: open <path> (file into aux), open-browser <id> (pin a browser tab from "duo tab" into aux), close, promote (move aux back to main + close split), resize <pct> (0.20–0.80), and state (or no sub-verb) prints a snapshot.'
  },
  {
    name: 'focus-pane',
    group: 'Working pane & layout',
    args: '<terminal|main|aux>',
    summary: 'Jump keyboard focus to the named pane (parity with ⌘⌥L / ⌘⌥; / ⌘⌥\'). aux is a no-op when split view is closed. Distinct from "focus", which targets a CSS selector in the browser pane.'
  },
  {
    name: 'layout',
    group: 'Working pane & layout',
    summary: 'JSON snapshot of working-pane / terminal / navigator state (active main tab kind+path, aux state, splitPct, focused column, navigator collapsed?). The third visibility verb alongside "duo nav state" and "duo dom".'
  },
  {
    name: 'status',
    group: 'Working pane & layout',
    summary:
      'High-level app snapshot: every open file + browser tab (with per-tab dirty / active / pinned), the active working tab, focused column, theme, terminal-tab count. The keystone orientation verb — run it first to see what the user is looking at. Coarser than "duo layout".'
  },
  {
    name: 'close-tab',
    group: 'Working pane & layout',
    summary: 'Close the focused working-pane tab (file editor / canvas / image viewer / browser-mode HTML). CLI parity for ⌘W. Pinned tabs still surface the confirm dialog before closing.'
  },
  {
    name: 'theme',
    group: 'Working pane & layout',
    args: '[system|light|dark]',
    summary: 'Print the current theme (mode + effective), or set it when a mode is given. Persists across relaunches.'
  },

  // ── Terminal ──
  {
    name: 'new-tab',
    group: 'Terminal',
    args: '[--shell|--claude] [--cwd <path>] [--cmd "<text>"]',
    summary:
      'Open a new terminal tab. --claude (the split-button default) auto-launches "claude" after the shell starts; --shell opens a vanilla shell; no flag follows the user\'s last manual choice. --cwd overrides the navigator\'s pending CWD; --cmd pre-types a payload (no trailing newline). Returns {id, kind, cwd, title}.'
  },
  {
    name: 'send',
    group: 'Terminal',
    args: '[--text "…"] [--enter]',
    summary: 'Write a payload into the active terminal\'s PTY. No Enter appended by default (user confirms); --enter submits on their behalf. Without --text, reads from stdin.'
  },
  {
    name: 'close-terminal-tab',
    group: 'Terminal',
    args: '[<n>]',
    summary: 'Close a terminal tab — no arg closes the focused one; <n> (1-indexed) closes that specific terminal tab.'
  },
  {
    name: 'term',
    group: 'Terminal',
    args: '<tabs|tab|close> [<id>] [--force]',
    summary: 'Manage terminal tabs. term tabs enumerates the window\'s terminal tabs ([{id, kind, cwd, title, active}]); term tab <id> activates the tab with that id; term close <id> [--force] closes it (kills its PTY — refused if a live claude is running there unless --force). Take ids from "term tabs" — NOT a bare index; "duo tab <n>" owns the browser number space. Honors --window N.'
  },
  {
    name: 'claude-return',
    group: 'Terminal',
    args: '[submit|newline]',
    summary: 'Toggle Claude-tab plain-Return behavior. Default submit (xterm passthrough; Claude submits). newline writes ESC+CR so Claude reads a multi-line newline (user types ⌘Return to submit). No arg prints state.'
  },
  {
    name: 'shift-return',
    group: 'Terminal',
    args: '[submit|newline]',
    summary: 'Toggle Claude-tab Shift+Return behavior. Default newline writes ESC+CR (matches Slack / Discord / claude.ai web). submit disables the override (xterm passthrough). No arg prints state.'
  },

  // ── Workspace & projects ──
  {
    name: 'workspace',
    group: 'Workspace & projects',
    args: '<save|open|list-recent|current|new> [args]',
    summary:
      'Workspace-as-file: round-trips open tabs + terminals + browser tabs to a .duo-workspace file. save [<path>] [--name] [--save-as] writes; open <path> loads + in-place resets; list-recent and current print JSON; new resets in-place to one fresh shell at the previously-frontmost terminal\'s CWD (pinned tabs survive).'
  },
  {
    name: 'workspace-pill-menu',
    group: 'Workspace & projects',
    args: '[on|off|toggle]',
    summary: 'Toggle the title-bar workspace pill\'s click-to-open-menu behavior. Default OFF: the pill is a passive label and workspace ops route through the File menu. Bare command reads current state.'
  },
  {
    name: 'project',
    group: 'Workspace & projects',
    args: '<list|focus|pin|unpin|close> [args]',
    summary:
      'Project rail parity (name resolution is case-insensitive; exact root paths always resolve). list prints a JSON snapshot (run it first to discover names); focus <name|root> sets the lens (focus --all releases it); pin / unpin manage the persistent pin set; close bulk-closes a project\'s terminals + working tabs (confirm dialog when a member terminal is a Claude session).'
  },
  {
    name: 'session',
    group: 'Workspace & projects',
    args: '<list|resume|open> [args]',
    summary: 'Claude session lifecycle. session list [--cwd <path>] lists prior "<uuid>.jsonl" sessions in the CWD ({uuid, title, source, messageCount, modifiedAt}); session resume <tabId> <uuid> spawns "claude --resume <uuid>" in the named tab\'s PTY; session open <uuid> [--cwd <path>] [--force] is the Home click contract — focuses the session\'s live tab if open, else spawns "claude --resume <uuid>" in a new tab in the primary window (--cwd required to resume; a session live OUTSIDE Duo is refused unless --force, which FORKS via --fork-session).'
  },
  {
    name: 'home',
    group: 'Workspace & projects',
    args: '[show|state|refresh] [--json]',
    summary: 'Home, the re-entry surface (slot 0). Bare "duo home" (or "home show") focuses/synthesizes Home in the target window; home state [--json] prints what the user sees (greeting + rolled-up projects with their sessions); home refresh forces a snapshot refetch. Honors --window N. No "home close" — Home is non-closable by design.'
  },

  // ── Repo & git ──
  {
    name: 'git-status',
    group: 'Repo & git',
    args: '[<path>]',
    summary: 'Git status snapshot for a directory (defaults to $HOME). Returns JSON { isRepo, branch, head, dirty, changedCount, ahead, behind, workTreeRoot } — powers the navigator root chip and lets agents check a checkout\'s state before proposing edits.'
  },
  {
    name: 'clone',
    group: 'Repo & git',
    args: '<url> [<dir>] [--json]',
    summary: 'Clone a GitHub repo via "gh repo clone" when gh is authenticated, falling back to "git clone". <url> accepts owner/repo shorthand with gh, else a full HTTPS/SSH URL. --json prints the structured result so agents can branch on errorKind (bad-url / auth-missing / clone-failed).'
  },
  {
    name: 'gh-auth',
    group: 'Repo & git',
    summary: 'Probe "gh auth status". Prints JSON { ghInstalled, authenticated, host, user, ghNotFound } so agents can decide whether "duo clone" will work on private repos before trying.'
  },
  {
    name: 'worktree',
    group: 'Repo & git',
    args: '[list] [<path>] | new "<desc>" [--from <ref>] [--window] | remove <path> [--force]',
    summary: 'List / create / remove the git worktrees of the repo at <path> (defaults to the cwd). `duo worktree [list] [<path>]` → JSON [{ path, branch, head, isMain, isCurrent, detached, prunable, colorIndex }], main checkout first, the cwd\'s worktree flagged isCurrent. `duo worktree new "<desc>" [--from <ref>] [--window]` → create a worktree off <ref> (default: the main branch) at <repo>/.claude/worktrees/<slug> on branch claude/<slug>, the description sanitized to a path/ref-safe slug (spaces→-, allow-list a–z 0–9 -); --window also opens it in a new Duo window. `duo worktree remove <path> [--force]` → git worktree remove (--force when the worktree is dirty). Reads/writes git directly (no running app needed, except --window). The CLI twin of the navigator Worktrees dropdown + its "+ New worktree" create (ENH-221).'
  },

  // ── Health & install ──
  {
    name: 'install',
    group: 'Health & install',
    args: '[--system]',
    summary: 'Symlink duo into a sandbox-safe location: ~/.claude/bin/duo by default (writable from a sandboxed PTY), with ~/.local/bin/duo as fallback. --system forces /usr/local/bin (needs sudo; not recommended for Claude Code use).'
  },
  {
    name: 'packs',
    group: 'Health & install',
    summary: 'List every discovered distro pack at ~/.claude/duo/packs/<name>/ as JSON. Each row carries the parsed PACK.json manifest (or null on parse failure) plus per-pack errors[]. The registry is cached at boot; restart Duo to refresh.'
  },
  {
    name: 'pack',
    group: 'Health & install',
    args: '<list|uninstall> [args]',
    summary: 'Distro pack management. pack list prints a JSON list of installed packs; pack uninstall <name> [--remove-folder] removes one.'
  },

  // ── Vault (ENH-208) ──
  // These verbs read the filesystem DIRECTLY (no socket / running app
  // needed) — see the import note. The vault = the nearest ancestor of the
  // cwd containing `.obsidian/`; pass `--vault <path>` to target another.
  {
    name: 'vault',
    group: 'Vault',
    args: '<init|list|schema|capture|stub|search|default|mv|relink|publish|promote> [args]',
    summary:
      'Work-notes vault. Two at-rest formats: OKF (standard markdown relative links, [Display](./rel.md)) and Obsidian (wikilinks, [[Display]]) — one graph model, two serializers. init <path> --format=okf|obsidian [--name "…"] [--no-default] [--force]: scaffold a vault; --format is REQUIRED on the CLI (the New Vault dialog defaults to OKF). OKF mode marks the root with an okf_version index.md + static listings; Obsidian writes the legacy .obsidian/ + bases/processing.base + README. The fresh vault becomes the default unless --no-default is passed (a throwaway scaffold can opt out of the global-default hijack; it still lands in the picker\'s known list). list: vaults detected from the cwd (JSON). schema [--vault p]: the live corpus — types/entities/aliases/props-per-type/observed-enums, a pure function over frontmatter (the vault IS the schema; never cached). capture [--template t] [--text "…"] [--title "…"] [--open]: drop a timestamped inbox note (untyped by default; --template stamps a type). stub <type> <name> [--open]: create a typed entity stub from its template, filed by the D19 rule (the CLI twin of the silent-stub [[New Name]]⇥ gesture; idempotent — never clobbers). search <query> [--vault p]: full-text hits (file, line, excerpt) — the CLI twin of ⌘⇧F. default [<path>|--clear]: read or set the default vault (Phase-2 D11; the CLI twin of the Settings field). mv <from> <to>: move a note (vault-relative) and rewrite every inbound markdown link to its new path, re-basing the moved note\'s own outbound links (D5 clean path). relink [--dry-run]: repair out-of-band moves (Finder/git) — re-resolve dangling markdown links by slug/basename first, using the stable frontmatter id: only to tiebreak when >1 note shares a slug, rewriting the unambiguous ones and reporting ambiguous + broken (D5; auto-runs on vault open). publish [--index-only|--log-only] [--dir] [--open]: (re)generate the OKF static listings from the corpus — root index.md (frontmatter byte-preserved) + log.md, --dir adds per-folder index.md (D8; OKF-mode only). --index-only / --log-only narrow the WRITE to just that file (the other is left byte-identical — no churn), not just the reported set. promote <note> --heading "<h>" --type <t>: split a ## section into its own typed entity, leaving a markdown link behind (a wikilink in Obsidian) — never an embed (D9). Verbs resolve --vault → the enclosing vault → the default → error, so a set default lets them run from outside any vault.'
  },
  {
    name: 'graph',
    group: 'Vault',
    args: '<backlinks <note>|orphans> [--vault p]',
    summary:
      'Vault graph queries. Both wikilinks ([[Display]], basename-resolved) AND standard markdown relative links ([Display](./rel.md)) are edges. Wikilinks survive file moves by basename; OKF markdown rel links do NOT (a move changes the path) — use `duo vault mv` (rewrites inbound links) or `duo vault relink` (repairs out-of-band moves). backlinks <note>: every note linking to <note>, with file + line (JSON). orphans: notes with no inbound and no outbound links — a processing work-list (JSON).'
  },
  {
    name: 'base',
    group: 'Vault',
    args: '<lint <file|--all>|render <file|note>> [--out p] [--open] [--vault p]',
    summary:
      'Obsidian Bases rollups. lint <file|--all> [--vault p]: validate a .base file (or a note\'s embedded ```base blocks, or every base with --all) against the live corpus — bad types / unresolved [[entities]] / off-enum values / unknown functions, each with a "did you mean" (JSON; warn-and-render, never blocks). render <file|note> [--out p] [--open]: evaluate filters/formulas over live frontmatter and emit a stamped Duo-owned HTML artifact (generated-at · source-hash · as-of). Default writes to the vault\'s out/; --out writes elsewhere; --open also opens it as a tab in the running app.'
  }
]

// Stage 18 Phase 18a (D4) — when running inside a Duo PTY, the
// DUO_SOCKET env var is exported by PtyManager and points at the live
// socket. Prefer it over the hard-coded path so that future install-
// path changes flow through one knob.
const SOCKET_PATH =
  process.env.DUO_SOCKET ??
  path.join(os.homedir(), 'Library', 'Application Support', 'duo', 'duo.sock')
// Stage 20 — TCP fallback published by the Electron app at startup.
// Format: { port: number, token: string }. Read by `send()` when the
// Unix socket fails to connect (sandboxed Claude Code). See
// docs/DECISIONS.md → *Sandbox-tolerant transport*.
const PORT_FILE =
  process.env.DUO_PORT_FILE ??
  path.join(os.homedir(), 'Library', 'Application Support', 'duo', 'duo.port')

// ENH-191 P5a (Tier-3/S4) — terminal-origin window addressing. DUO_WINDOW is
// the PTY env-stamp (core/pty-manager.ts) = the owning window's id; an explicit
// `--window N` (parsed + stripped in main()) overrides it. resolveWindowId()
// returns the id stamped into every request — SocketServer routes get(windowId)
// with a primary-window fallback. undefined ⇒ unstamped (non-Duo terminal / no
// override) ⇒ the primary window.
let windowOverride: number | undefined
function resolveWindowId(): number | undefined {
  if (windowOverride != null) return windowOverride
  const env = process.env.DUO_WINDOW
  if (env) {
    const n = parseInt(env, 10)
    if (Number.isInteger(n) && n > 0) return n
  }
  return undefined
}

const TIMEOUT_MS = 10_000
// Stage 13b — `doc write` can sit on the renderer for a long time when the
// buffer is dirty: the editor surfaces a <WriteWarningBanner> and waits
// for the human to accept or decline. The CLI must outlast that human-
// in-the-loop window or the agent gets a misleading "Timeout" error
// when the user is mid-decision. 5 minutes mirrors the renderer-side
// `dispatchDocWrite` budget in electron/main.ts.
const PER_CMD_TIMEOUT_MS: Record<string, number> = {
  'doc-write': 5 * 60 * 1000
}

// ── Socket transport ─────────────────────────────────────────────────────────

interface PortInfo { port: number; token: string }

function readPortFile(): PortInfo | null {
  try {
    const raw = fs.readFileSync(PORT_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<PortInfo>
    if (typeof parsed.port === 'number' && typeof parsed.token === 'string') {
      return { port: parsed.port, token: parsed.token }
    }
  } catch { /* missing or malformed — caller falls through */ }
  return null
}

type TransportFactory = () => { socket: net.Socket; preamble?: string }

/**
 * One round-trip over a freshly-opened socket. Promise resolves with
 * the response result, or rejects with an Error whose `code` field
 * distinguishes connect-time failures (`ETIMEDOUT_CONNECT`,
 * `EPERM`, `ECONNREFUSED`, `ENOENT`) from response-side failures.
 * Stage 20 uses the connect-time codes to decide whether to retry
 * against the TCP fallback.
 */
function sendOver(
  factory: TransportFactory,
  cmd: string,
  args: Record<string, unknown>,
  timeoutMs: number
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const { socket, preamble } = factory()
    const id = randomUUID()
    let buf = ''
    let done = false
    let connected = false

    socket.setTimeout(timeoutMs)

    socket.on('connect', () => {
      connected = true
      if (preamble) socket.write(preamble)
      const wid = resolveWindowId()
      const req: DuoRequest = { id, cmd: cmd as DuoRequest['cmd'], args, ...(wid !== undefined ? { windowId: wid } : {}) }
      socket.write(JSON.stringify(req) + '\n')
    })

    socket.on('data', (chunk) => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const res: DuoResponse = JSON.parse(line)
          if (res.id === id) {
            done = true
            socket.destroy()
            if (res.ok) resolve(res.result)
            else reject(new Error(res.error ?? 'Unknown error'))
          }
        } catch { /* partial line */ }
      }
    })

    socket.on('timeout', () => {
      if (done) return
      const err = new Error(`Timeout waiting for response to "${cmd}"`)
      ;(err as NodeJS.ErrnoException).code = connected ? 'ETIMEDOUT_RESPONSE' : 'ETIMEDOUT_CONNECT'
      socket.destroy()
      reject(err)
    })

    socket.on('error', (err) => {
      reject(err)
    })
  })
}

const FALLBACK_CONNECT_CODES = new Set([
  'EPERM',          // sandbox blocks Unix sockets
  'ECONNREFUSED',   // app down, or stale socket file
  'ENOENT',         // socket file vanished
  'EAGAIN',
  'ETIMEDOUT_CONNECT'
])

async function send(
  cmd: string,
  args: Record<string, unknown> = {},
  opts: { timeoutMs?: number } = {}
): Promise<unknown> {
  const timeoutMs = opts.timeoutMs ?? PER_CMD_TIMEOUT_MS[cmd] ?? TIMEOUT_MS

  // Try the Unix socket first. DUO_TCP_ONLY=1 forces TCP for testing.
  if (process.env.DUO_TCP_ONLY !== '1' && fs.existsSync(SOCKET_PATH)) {
    try {
      return await sendOver(
        () => ({ socket: net.createConnection(SOCKET_PATH) }),
        cmd, args, timeoutMs
      )
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (!code || !FALLBACK_CONNECT_CODES.has(code)) throw err
      // Fall through to TCP.
    }
  }

  // Stage 20 — TCP fallback. Read the port file the Electron app
  // published at startup, connect to 127.0.0.1, and send the auth
  // token as the first NDJSON line of the handshake.
  const portInfo = readPortFile()
  if (!portInfo) {
    if (!fs.existsSync(SOCKET_PATH)) {
      die('Cannot connect: Duo app is not running.\nLaunch Duo.app first.')
    }
    die('Cannot connect: Unix socket failed and no TCP fallback available.\nRun `duo doctor` for details.')
  }
  return await sendOver(
    () => {
      const socket = net.createConnection({ host: '127.0.0.1', port: portInfo.port })
      return { socket, preamble: JSON.stringify({ token: portInfo.token }) + '\n' }
    },
    cmd, args, timeoutMs
  )
}

/**
 * Stage 27 — streaming variant of `send()` for `duo events --follow`.
 * Same transport logic (Unix first, TCP fallback with auth). The
 * server protocol: first line back is `{id, ok:true, result:{...}}`
 * (the ack); each subsequent line is `{event: DuoEvent}` until the
 * socket closes. `onAck` fires once when the ack lands; `onEvent`
 * fires per streamed event. Returns a Promise that resolves on clean
 * socket close, rejects on unrecoverable error or non-ok ack.
 */
function sendStreamed(
  cmd: string,
  args: Record<string, unknown>,
  onAck: (result: unknown) => void,
  onEvent: (event: unknown) => void
): Promise<void> {
  const factory: TransportFactory = () => {
    if (process.env.DUO_TCP_ONLY !== '1' && fs.existsSync(SOCKET_PATH)) {
      return { socket: net.createConnection(SOCKET_PATH) }
    }
    const portInfo = readPortFile()
    if (!portInfo) {
      throw new Error('Cannot connect: Unix socket failed and no TCP fallback available.')
    }
    const socket = net.createConnection({ host: '127.0.0.1', port: portInfo.port })
    return { socket, preamble: JSON.stringify({ token: portInfo.token }) + '\n' }
  }

  return new Promise((resolve, reject) => {
    let socket: net.Socket
    let preamble: string | undefined
    try {
      const made = factory()
      socket = made.socket
      preamble = made.preamble
    } catch (err) {
      reject(err)
      return
    }
    const id = randomUUID()
    let buf = ''
    let acked = false

    socket.on('connect', () => {
      if (preamble) socket.write(preamble)
      const wid = resolveWindowId()
      const req: DuoRequest = { id, cmd: cmd as DuoRequest['cmd'], args, ...(wid !== undefined ? { windowId: wid } : {}) }
      socket.write(JSON.stringify(req) + '\n')
    })

    socket.on('data', (chunk) => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        let parsed: unknown
        try { parsed = JSON.parse(line) } catch { continue }
        // Streamed event line: { event: DuoEvent }.
        if (parsed && typeof parsed === 'object' && 'event' in parsed) {
          onEvent((parsed as { event: unknown }).event)
          continue
        }
        // Ack line: { id, ok, result }.
        if (parsed && typeof parsed === 'object' && 'id' in parsed) {
          const res = parsed as DuoResponse
          if (res.id !== id) continue
          if (!res.ok) {
            socket.destroy()
            reject(new Error(res.error ?? 'Unknown error'))
            return
          }
          acked = true
          onAck(res.result)
        }
      }
    })

    socket.on('close', () => {
      if (acked) resolve()
      else reject(new Error('Socket closed before ack'))
    })
    socket.on('error', (err) => {
      reject(err)
    })
  })
}

// ── Output helpers ────────────────────────────────────────────────────────────

// BUG-114 (Sprint 14 walk-1) — `duo dom | head -3` (and any other
// `duo <verb> | head/grep/awk`) crashed with `Error: write EPIPE`
// when the pipe consumer closed its stdin before the CLI finished
// writing. Standard Node fix: swallow EPIPE on stdout/stderr so the
// process exits cleanly. `head -3` is canonical agent-debugging
// usage; the crash made the CLI feel broken even when it had
// successfully delivered the requested bytes.
process.stdout.on('error', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') process.exit(0)
})
process.stderr.on('error', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') process.exit(0)
})

function out(value: unknown): void {
  if (typeof value === 'string') process.stdout.write(value + '\n')
  else console.log(JSON.stringify(value, null, 2))
}

function die(msg: string, code = 1): never {
  process.stderr.write(`duo: ${msg}\n`)
  process.exit(code)
}

/**
 * ENH-022 follow-up — module-scope `flagValue(args, name)` so subcommand
 * handlers across `case 'doc'`, `case 'html'`, etc. can share a single
 * argv-flag lookup. Returns the value following `--name` in `args`, or
 * `undefined` if the flag isn't present. Bug fixed: the original helper
 * lived inside `case 'html'` only, so `case 'doc'`'s `flagValue(...)`
 * calls hit `flagValue is not defined` at runtime.
 */
function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i !== -1 ? args[i + 1] : undefined
}

/**
 * Positional args with value-taking flags (and their values) and bare
 * flags removed. Without this, a `--vault <path>` *value* looks like a
 * positional to `args.find(a => !a.startsWith('--'))` — so
 * `duo base lint --all --vault X` would mis-read X as the lint target.
 * `valueFlags` are flags that consume the following token.
 */
function positionalArgs(args: string[], valueFlags: string[] = []): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (valueFlags.includes(a)) {
      i++ // skip the flag's value too
      continue
    }
    if (a.startsWith('--')) continue
    out.push(a)
  }
  return out
}

/**
 * BUG-005 fix — translate cross-platform navigation combos to Mac
 * equivalents. Used by `duo key` so agents reaching for Cmd+End /
 * Cmd+Home / Cmd+PageDown / Cmd+PageUp from cross-platform muscle
 * memory don't accidentally trigger the Electron application-menu
 * chrome on macOS.
 */
function translateNavKeysForMac(key: string, modifiers: string[]): { key: string; modifiers: string[] } {
  if (process.platform !== 'darwin') return { key, modifiers }
  const lowered = modifiers.map(m => m.toLowerCase())
  const hasCmd = lowered.includes('cmd') || lowered.includes('meta')
  if (!hasCmd) return { key, modifiers }
  const k = key.toLowerCase()
  if (k === 'end') return { key: 'ArrowDown', modifiers }
  if (k === 'home') return { key: 'ArrowUp', modifiers }
  if (k === 'pagedown' || k === 'pageup') {
    // Drop the Cmd modifier; PageDown / PageUp page-scroll natively
    // on macOS without it, and Cmd is what would trigger the menu
    // fall-through.
    return { key, modifiers: modifiers.filter(m => m.toLowerCase() !== 'cmd' && m.toLowerCase() !== 'meta') }
  }
  return { key, modifiers }
}

// ── Command dispatch ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const rawArgv = process.argv.slice(2)
  // ENH-191 P5a (Tier-3/S4) — strip a global `--window N` / `--window=N`
  // override from anywhere in argv BEFORE verb dispatch, so per-verb positional
  // parsing is unaffected. Sets windowOverride (consumed by resolveWindowId()),
  // which takes precedence over the terminal's DUO_WINDOW stamp.
  const argv: string[] = []
  for (let i = 0; i < rawArgv.length; i++) {
    const a = rawArgv[i]
    if (a === '--window') {
      const n = parseInt(rawArgv[i + 1] ?? '', 10)
      if (Number.isInteger(n) && n > 0) windowOverride = n
      i++
      continue
    }
    if (a.startsWith('--window=')) {
      const n = parseInt(a.slice('--window='.length), 10)
      if (Number.isInteger(n) && n > 0) windowOverride = n
      continue
    }
    argv.push(a)
  }

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printHelp()
    process.exit(0)
  }

  if (argv[0] === '--version' || argv[0] === '-v') {
    out(VERSION)
    process.exit(0)
  }

  const [cmd, ...rest] = argv

  try {
    switch (cmd) {
      case 'navigate': {
        // BUG-149 (Sprint 20 / v0.7.7) — `duo navigate` is a BROWSER-
        // PANE verb (URLs only). The verb name reads like a navigator-
        // pane move, so users + agents sometimes pass a path. Catch
        // that here with a helpful redirect — same message the socket
        // would emit, but the CLI catches it before a round-trip.
        const url = rest[0] ?? die('Usage: duo navigate <url>\n\nNote: \'duo navigate\' is a BROWSER-PANE verb (URLs only). To move the file navigator to a path, use \'duo reveal <path>\'. To open a local file, use \'duo open <path>\' or \'duo edit <path>\'.')
        if (url.startsWith('/') || url.startsWith('~') || url.startsWith('./') || url.startsWith('../')) {
          die(`'duo navigate' expects a URL (this is a BROWSER-PANE verb). To move the file navigator to '${url}', use 'duo reveal ${url}'. To open it as a file, use 'duo open ${url}' (browser-mode) or 'duo edit ${url}' (canvas-/editor-mode).`)
        }
        out(await send('navigate', { url }))
        break
      }
      case 'open': {
        // ENH-130 — `--reveal` expands the working pane (if collapsed)
        // and focuses main after the open lands. Use this when the
        // agent just created an artifact for the user to see.
        // ENH-159 — `duo open <html>` defaults to the browser pane
        // (interactive, scripts run). `--canvas` is an override that
        // forces canvas-mode mount (source-editable, scripts blocked).
        // For non-HTML files (.md, images, etc.), `mode` is ignored by
        // the renderer's natural router. The legacy `<meta name="duo-
        // open-in" content="browser">` declaration is no longer
        // consulted by this verb — verb name decides surface.
        const reveal = rest.includes('--reveal')
        const canvasOverride = rest.includes('--canvas')
        const positional = rest.find(a => !a.startsWith('--')) ?? die('Usage: duo open <path-or-url> [--canvas] [--reveal]')
        const resolved = resolveOpenTarget(positional)
        const payload: Record<string, unknown> = {
          url: resolved,
          mode: canvasOverride ? 'canvas' : 'browser'
        }
        if (reveal) payload['reveal'] = true
        out(await send('open', payload))
        break
      }
      case 'reload': {
        // Stage 20 — pair for `duo navigate` that doesn't require a
        // URL; reloads the active browser tab in place. Useful for
        // the Stage 8 iteration flow (agent emits HTML → user clicks
        // → agent edits → user runs `duo reload`).
        out(await send('reload'))
        break
      }
      case 'url':
        out(await send('url'))
        break
      case 'title':
        out(await send('title'))
        break
      case 'dom': {
        // ENH-122 — `duo dom <selector> [...]` queries the main renderer
        // (the React shell). Bare `duo dom` keeps the legacy browser-pane
        // HTML dump (CDP). Disambiguation key: any args at all → renderer.
        //
        //   duo dom                                 # browser-pane HTML (legacy)
        //   duo dom 'img'                           # outerHTML of first match
        //   duo dom '.ProseMirror' --attr class     # one attribute
        //   duo dom '.ProseMirror' --text           # textContent
        //   duo dom 'img' --computed width,height   # getComputedStyle props
        //   duo dom 'li' --all                      # array of outerHTMLs
        //   duo dom --js '1 + 1'                    # arbitrary expression
        if (rest.length === 0) {
          out(await send('dom'))
          break
        }
        const jsIdx = rest.indexOf('--js')
        const payload: Record<string, unknown> = {}
        if (jsIdx !== -1) {
          // --js consumes the rest of argv as a single expression so
          // shell-quoted blobs with spaces / parens / object literals
          // survive intact. Anything before --js is rejected (mixing
          // selector + js makes no sense).
          if (jsIdx !== 0) {
            die('Usage: duo dom --js "<expr>"  (no other positional args)')
          }
          const js = rest.slice(jsIdx + 1).join(' ')
          if (!js) die('Usage: duo dom --js "<expression>"')
          payload['js'] = js
        } else {
          // Selector path. First non-flag arg = selector; flags AFTER it
          // configure the projection (--attr / --text / --computed / --all).
          // Walk argv manually so flag VALUES (--attr <name>, --computed
          // <list>) don't get caught up in the positional scan.
          const flagsWithValue = new Set(['--attr', '--computed'])
          const skipNext = new Set<number>()
          for (let i = 0; i < rest.length; i++) {
            if (flagsWithValue.has(rest[i])) skipNext.add(i + 1)
          }
          const positionals = rest.filter((a, i) => !a.startsWith('--') && !skipNext.has(i))
          if (positionals.length === 0) {
            die('Usage: duo dom <selector> [--attr <n>] [--text] [--all] [--computed p1,p2]')
          }
          payload['selector'] = positionals[0]
          const attrIdx = rest.indexOf('--attr')
          if (attrIdx !== -1) {
            const v = rest[attrIdx + 1]
            if (!v) die('Usage: duo dom <selector> --attr <name>')
            payload['attr'] = v
          }
          if (rest.includes('--text')) payload['text'] = true
          const computedIdx = rest.indexOf('--computed')
          if (computedIdx !== -1) {
            const v = rest[computedIdx + 1]
            if (!v) die('Usage: duo dom <selector> --computed <prop1,prop2,...>')
            payload['computed'] = v.split(',').map(s => s.trim()).filter(Boolean)
          }
          if (rest.includes('--all')) payload['all'] = true
        }
        out(await send('dom', payload))
        break
      }
      case 'text': {
        const selectorIdx = rest.indexOf('--selector')
        const selector = selectorIdx !== -1 ? rest[selectorIdx + 1] : undefined
        out(await send('text', selector ? { selector } : {}))
        break
      }
      case 'ax': {
        const selectorIdx = rest.indexOf('--selector')
        const formatIdx = rest.indexOf('--format')
        const selector = selectorIdx !== -1 ? rest[selectorIdx + 1] : undefined
        const format = formatIdx !== -1 ? rest[formatIdx + 1] : 'md'
        if (format !== 'md' && format !== 'json') die('--format must be md or json')
        out(await send('ax', { selector, format }))
        break
      }
      case 'focus': {
        const selector = rest[0] ?? die('Usage: duo focus <selector>')
        out(await send('focus', { selector }))
        break
      }
      case 'type': {
        // Everything after `type` that isn't a flag is treated as the text.
        if (rest.length === 0) die('Usage: duo type <text>')
        const text = rest.join(' ')
        out(await send('type', { text }))
        break
      }
      case 'key': {
        const rawKey = rest[0] ?? die('Usage: duo key <keyname> [--modifiers cmd,shift,...]')
        const modIdx = rest.indexOf('--modifiers')
        const rawModifiers = modIdx !== -1
          ? (rest[modIdx + 1] ?? '').split(',').map(s => s.trim()).filter(Boolean)
          : []
        // BUG-005 fix (v0.3.1) — translate cross-platform navigation
        // combos to Mac-native equivalents on darwin. On macOS,
        // Cmd+End / Cmd+Home / Cmd+PageDown / Cmd+PageUp aren't bound
        // to caret navigation; they fall through to Electron's
        // application-menu chrome (Cmd+End in particular surfaces the
        // About panel). The Mac-native equivalents are:
        //   Cmd+End  → Cmd+Down  (caret to end of document)
        //   Cmd+Home → Cmd+Up    (caret to start of document)
        //   Cmd+PageDown / Cmd+PageUp → drop Cmd; PageDown/PageUp
        //                                page-scroll natively without it
        // Translation is silent: the agent gets the navigation it
        // expected, the user doesn't see disruptive UI, and the wire
        // format stays consistent for main.
        const { key, modifiers } = translateNavKeysForMac(rawKey, rawModifiers)
        out(await send('key', { key, modifiers }))
        break
      }
      case 'console': {
        const sinceIdx = rest.indexOf('--since')
        const levelIdx = rest.indexOf('--level')
        const limitIdx = rest.indexOf('--limit')
        const since = sinceIdx !== -1 ? parseInt(rest[sinceIdx + 1], 10) : undefined
        const level = levelIdx !== -1
          ? rest[levelIdx + 1].split(',').map(s => s.trim()).filter(Boolean)
          : undefined
        const limit = limitIdx !== -1 ? parseInt(rest[limitIdx + 1], 10) : undefined
        const entries = await send('console', { since, level, limit }) as unknown[]
        // NDJSON: one event per line (brief §9)
        for (const e of entries) process.stdout.write(JSON.stringify(e) + '\n')
        break
      }
      case 'errors': {
        const sinceIdx = rest.indexOf('--since')
        const limitIdx = rest.indexOf('--limit')
        const since = sinceIdx !== -1 ? parseInt(rest[sinceIdx + 1], 10) : undefined
        const limit = limitIdx !== -1 ? parseInt(rest[limitIdx + 1], 10) : undefined
        const entries = await send('errors', { since, limit }) as unknown[]
        for (const e of entries) process.stdout.write(JSON.stringify(e) + '\n')
        break
      }
      case 'network': {
        const sinceIdx = rest.indexOf('--since')
        const limitIdx = rest.indexOf('--limit')
        const filterIdx = rest.indexOf('--filter')
        const since = sinceIdx !== -1 ? parseInt(rest[sinceIdx + 1], 10) : undefined
        const limit = limitIdx !== -1 ? parseInt(rest[limitIdx + 1], 10) : undefined
        const filter = filterIdx !== -1 ? rest[filterIdx + 1] : undefined
        const entries = await send('network', { since, limit, filter }) as unknown[]
        for (const e of entries) process.stdout.write(JSON.stringify(e) + '\n')
        break
      }
      case 'click': {
        const selector = rest[0] ?? die('Usage: duo click <selector>')
        out(await send('click', { selector }))
        break
      }
      case 'fill': {
        const [selector, value] = rest
        if (!selector || !value) die('Usage: duo fill <selector> <value>')
        out(await send('fill', { selector, value }))
        break
      }
      case 'eval': {
        const js = rest.join(' ') || die('Usage: duo eval <js>')
        out(await send('eval', { js }))
        break
      }
      case 'screenshot': {
        const outIdx = rest.indexOf('--out')
        const selectorIdx = rest.indexOf('--selector')
        const outputPath = outIdx !== -1 ? rest[outIdx + 1] : undefined
        const selector = selectorIdx !== -1 ? rest[selectorIdx + 1] : undefined
        const b64 = await send('screenshot', { selector }) as string
        if (outputPath) {
          const abs = path.resolve(outputPath)
          fs.writeFileSync(abs, Buffer.from(b64, 'base64'))
          out(`Saved to ${abs}`)
        } else {
          out(b64)
        }
        break
      }
      case 'tabs':
        out(await send('tabs'))
        break
      case 'tab': {
        const n = parseInt(rest[0] ?? '', 10)
        if (isNaN(n)) die('Usage: duo tab <n>')
        out(await send('tab', { n }))
        break
      }
      case 'close': {
        const n = parseInt(rest[0] ?? '', 10)
        if (isNaN(n)) die('Usage: duo close <n>  (where <n> is a tab id from `duo tabs`)')
        out(await send('close', { n }))
        break
      }
      case 'window': {
        // ENH-191 P5a (S3c) — `duo window new` opens a second window (the same
        // action as the File → New Window menu item). Gated on the multiWindow
        // setting. ENH-191 P5a (Tier-4) — exit NON-ZERO when disabled so
        // scripts/agents see the failure (mirrors `duo clone`'s die-on-!ok),
        // not a clean exit with an {ok:false} body.
        const sub = rest[0]
        if (sub !== 'new') die('Usage: duo window new [--cwd <path>]')
        // ENH-210 (D1-part2) — `--cwd <path>` roots the new window's
        // navigator at a worktree (resolved client-side like other paths).
        const cwdIdx = rest.indexOf('--cwd')
        const cwd = cwdIdx >= 0 && rest[cwdIdx + 1]
          ? path.resolve(process.cwd(), rest[cwdIdx + 1])
          : undefined
        const r = (await send('window', cwd ? { action: 'new', cwd } : { action: 'new' })) as { ok?: boolean; error?: string }
        if (r && r.ok === false) die(r.error ?? 'duo window new failed (is "Allow Multiple Windows" enabled?)')
        out(r)
        break
      }
      case 'windows': {
        // ENH-191 P5a (Tier-3) — list open windows ({id, primary, focused,
        // activeWorkspace}). Backs cross-window addressing (`duo --window N …`)
        // + verification.
        out(await send('windows'))
        break
      }
      case 'view': {
        // ENH-097 — `--canvas` forces canvas-mode mount, overriding the
        // file's `<meta name="duo-open-in" content="browser">` if present.
        // Routing precedence: explicit flag > meta tag > kind default.
        // ENH-130 — `--reveal` auto-expands the working pane and
        // focuses main after the open. Use when creating artifacts.
        const canvasFlagIdx = rest.indexOf('--canvas')
        const target = rest.find(a => !a.startsWith('--')) ?? die('Usage: duo view <path> [--canvas] [--reveal]')
        const resolved = resolveFilePath(target)
        const payload: Record<string, unknown> = { path: resolved }
        if (canvasFlagIdx !== -1) payload['mode'] = 'canvas'
        if (rest.includes('--reveal')) payload['reveal'] = true
        out(await send('view', payload))
        break
      }
      case 'image': {
        // ENH-108 — `duo image insert <path>` saves the image alongside
        // the active markdown editor's doc + inserts at caret. v1
        // markdown only — canvas (PageTab) gets the same treatment in
        // a follow-up. Optional `--alt "…"`.
        const sub = rest[0]
        const subRest = rest.slice(1)
        if (sub === 'insert') {
          const target = subRest.find(a => !a.startsWith('--')) ?? die('Usage: duo image insert <path> [--alt "alt text"]')
          const resolved = resolveFilePath(target)
          const altIdx = subRest.indexOf('--alt')
          const alt = altIdx !== -1 ? subRest[altIdx + 1] : undefined
          out(await send('image-insert', alt !== undefined ? { path: resolved, alt } : { path: resolved }))
          break
        }
        die('Usage: duo image insert <path> [--alt "alt text"]')
        break
      }
      case 'edit': {
        // ENH-159 — `duo edit <html>` defaults to canvas mode (source-
        // editable, scripts blocked, buttons inert). `--browser`
        // forces browser mode (interactive) for symmetry with
        // `duo open --canvas`. For non-HTML files, `mode` is ignored
        // by the renderer's natural router (e.g. .md → TipTap
        // editor; image → viewer). The legacy `<meta name="duo-
        // open-in" content="browser">` is no longer consulted —
        // verb name decides surface.
        // `--canvas` is accepted as a deprecated no-op (it's the
        // default for HTML now) for backwards compat with pre-
        // ENH-159 scripts.
        // ENH-130 — `--reveal` auto-expands the working pane and
        // focuses main after the open. Use when creating artifacts.
        const browserOverride = rest.includes('--browser')
        const target = rest.find(a => !a.startsWith('--')) ?? die('Usage: duo edit <path> [--browser] [--reveal]')
        const resolved = resolveFilePath(target)
        const payload: Record<string, unknown> = { path: resolved, mode: browserOverride ? 'browser' : 'canvas' }
        if (rest.includes('--reveal')) payload['reveal'] = true
        out(await send('edit', payload))
        break
      }
      case 'selection': {
        const paneIdx = rest.indexOf('--pane')
        const pane = paneIdx !== -1 ? rest[paneIdx + 1] : 'auto'
        if (pane !== 'auto' && pane !== 'editor' && pane !== 'browser' && pane !== 'canvas') {
          die('Usage: duo selection [--pane auto|editor|browser|canvas]')
        }
        const sel = await send('selection', { pane }) as unknown
        if (sel === null || sel === undefined) {
          out('null')
        } else {
          out(sel)
        }
        break
      }
      case 'theme': {
        // `duo theme`          \u2192 print current state (JSON)
        // `duo theme <mode>`   \u2192 override (system|light|dark) and print new state
        const mode = rest[0]
        if (mode === undefined) {
          out(await send('theme'))
        } else {
          if (mode !== 'system' && mode !== 'light' && mode !== 'dark') {
            die('Usage: duo theme [system|light|dark]')
          }
          out(await send('theme', { mode }))
        }
        break
      }
      case 'author': {
        // BUG-138 Phase 2 \u2014 `duo author` reads the current author
        // identity; `duo author "<name>"` sets it (persisted in
        // renderer localStorage). Agents set their own attribution via
        // the DUO_AUTHOR env var on per-op verbs (Phase 3); this verb
        // is for the human user's identity only.
        const author = rest[0]
        if (author === undefined) {
          out(await send('author'))
        } else {
          if (author.length === 0) {
            die('Usage: duo author [<name>]')
          }
          out(await send('author', { author }))
        }
        break
      }
      case 'claude-return': {
        // Sprint 16 / v0.6.15 \u2014 `duo claude-return [submit|newline]`.
        // Toggles Claude-tab plain Return behavior. Default: 'submit'
        // (matches universal terminal expectation). 'newline' restores
        // ENH-127 v2 default (writes \x1b\r; Claude reads as multi-line
        // newline; user must use \u2318Return to submit).
        const mode = rest[0]
        if (mode === undefined) {
          out(await send('claude-return'))
        } else {
          if (mode !== 'submit' && mode !== 'newline') {
            die('Usage: duo claude-return [submit|newline]')
          }
          out(await send('claude-return', { mode }))
        }
        break
      }
      case 'shift-return': {
        // Sprint 16 / v0.6.15 \u2014 `duo shift-return [submit|newline]`.
        // Toggles Claude-tab Shift+Return behavior. Default: 'newline'
        // (matches Slack/Discord/claude.ai-web "shift+enter = newline
        // within composition" convention). 'submit' disables the
        // override.
        const mode = rest[0]
        if (mode === undefined) {
          out(await send('shift-return'))
        } else {
          if (mode !== 'submit' && mode !== 'newline') {
            die('Usage: duo shift-return [submit|newline]')
          }
          out(await send('shift-return', { mode }))
        }
        break
      }
      case 'hidden-files': {
        // ENH-172 (Sprint 20 / v0.7.7) \u2014 `duo hidden-files [show|hide|toggle]`.
        // Surfaces the navigator's showDotfiles flag for agent control.
        // Bare reads; arg writes. The View menu checkbox + \u2318\u21e7. chord
        // are the GUI counterparts. The `.claude` / `.obsidian` carve-outs
        // in FileTree's shouldShow() are NOT controlled by this flag.
        const mode = rest[0]
        if (mode === undefined) {
          out(await send('hidden-files'))
        } else {
          if (mode !== 'show' && mode !== 'hide' && mode !== 'toggle') {
            die('Usage: duo hidden-files [show|hide|toggle]')
          }
          out(await send('hidden-files', { mode }))
        }
        break
      }
      case 'browser-mode': {
        // ENH-178 (Sprint 20 / v0.7.7) — `duo browser-mode [unfiltered|filtered|local-only]`.
        // Bare reads current value; arg writes. `unfiltered` mode
        // (debug-only) requires explicit IT-warning confirmation via
        // an `--i-understand` flag — typing the literal string is the
        // gate so a casual or accidental invocation can't silently
        // turn off URL filtering.
        const mode = rest[0]
        if (mode === undefined) {
          out(await send('browser-mode'))
        } else if (mode !== 'unfiltered' && mode !== 'filtered' && mode !== 'local-only') {
          die("Usage: duo browser-mode [unfiltered|filtered|local-only]\n\nModes:\n  local-only  (default) — only file:// + localhost + 127.0.0.1 render in Duo; everything else opens in the system browser.\n  filtered    — Duo renders most URLs; hostnames in ~/.claude/duo/external-domains.json pop the system browser.\n  unfiltered  — DEBUG ONLY. All URLs render in Duo. Requires --i-understand.")
        } else if (mode === 'unfiltered' && !rest.includes('--i-understand')) {
          die(`⚠️  WARNING: 'unfiltered' mode lets Duo's embedded browser render any URL.\n\nSome IT departments disallow agent-driven browsing on the open internet.\nConsult your IT department before proceeding.\n\nTo confirm, re-run:\n  duo browser-mode unfiltered --i-understand`)
        } else {
          out(await send('browser-mode', { mode }))
        }
        break
      }
      case 'focus-pane': {
        // ENH-098 (Sprint 9) \u2014 CLI parity with the \u2318\u2325L/;/' chord set.
        // Distinct from `duo focus <selector>` (CDP focus on a CSS
        // selector inside the active browser pane).
        const target = rest[0]
        if (target !== 'terminal' && target !== 'main' && target !== 'aux') {
          die('Usage: duo focus-pane <terminal|main|aux>')
        }
        out(await send('focus-pane', { target }))
        break
      }
      case 'packs': {
        // Stage 18b \u2014 `duo packs` lists every discovered distro pack
        // as JSON. Pretty-prints by default (single-shot output, not
        // a stream). Pack registry is cached at boot; restart Duo
        // to refresh after installing a new pack.
        const result = await send('packs', {}) as {
          packs: Array<{ dirName: string; rootDir: string; manifest: unknown; errors: string[] }>
        }
        out(result)
        break
      }
      case 'events': {
        // Stage 27 \u2014 `duo events [--follow] [--since <cursor>] [--limit N]`
        // streams structured events from the bus. Pulls in issue #19.
        // Snapshot mode: prints one JSON line per event from the ring.
        // Follow mode: prints the snapshot first, then each new event
        // as it lands; runs until interrupted (^C).
        const follow = rest.includes('--follow')
        const since = flagValue(rest, '--since')
        const limitRaw = flagValue(rest, '--limit')
        let limit: number | undefined
        if (limitRaw !== undefined) {
          const parsed = Number(limitRaw)
          if (!Number.isFinite(parsed) || parsed < 1) {
            die('Usage: duo events [--follow] [--since <cursor>] [--limit N]')
          }
          limit = Math.floor(parsed)
        }
        const args: Record<string, unknown> = {}
        if (since !== undefined) args['since'] = since
        if (limit !== undefined) args['limit'] = limit
        const printEventLine = (event: unknown): void => {
          process.stdout.write(JSON.stringify(event) + '\n')
        }
        if (!follow) {
          // Snapshot \u2014 single response.
          const result = await send('events', args) as { events: unknown[] }
          for (const event of result.events ?? []) printEventLine(event)
        } else {
          // Follow \u2014 streaming. Server emits the replay (events with
          // cursor > since) BEFORE attaching the live subscriber, so
          // we print every line we receive in order.
          args['follow'] = true
          await sendStreamed('events', args,
            () => { /* ack \u2014 nothing to print */ },
            (event) => printEventLine(event)
          )
        }
        break
      }
      case 'split-view': {
        // ENH-041 / Sprint 3 \u2014 Split View aux pane. User-facing label
        // matches the right-click menu items ("Move to Split View",
        // "Open in Split View"). Sub-verbs:
        //   duo split-view open <path>            \u2014 open path in aux (file)
        //   duo split-view open-browser <id>      \u2014 pin browser tab id into aux
        //                                          (Sprint 7 Phase 3c)
        //   duo split-view close                   \u2014 close aux (file or browser)
        //   duo split-view promote                 \u2014 move aux's tab back to main
        //   duo split-view resize <pct>            \u2014 set splitPct (0.0\u20131.0)
        //   duo split-view                         \u2014 print current state
        const sub = rest[0]
        if (sub === undefined || sub === 'state') {
          out(await send('split-view', {}))
          break
        }
        if (sub === 'open') {
          const p = rest[1]
          if (!p) die('Usage: duo split-view open <path>')
          const resolved = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)
          out(await send('split-view', { op: 'open', path: resolved }))
          break
        }
        if (sub === 'open-browser') {
          // Phase 3c \u2014 pin a browser tab (numeric id from `duo tab`)
          // into the aux slot. Mirrors the right-click "Move to Split
          // View" gesture on a browser tab.
          const idArg = rest[1]
          if (idArg === undefined) die('Usage: duo split-view open-browser <browser-tab-id>')
          const browserTabId = Number(idArg)
          if (!Number.isInteger(browserTabId) || browserTabId < 1) {
            die('Usage: duo split-view open-browser <browser-tab-id>  (positive integer; from `duo tab` listing)')
          }
          out(await send('split-view', { op: 'open-browser', browserTabId }))
          break
        }
        if (sub === 'close') {
          out(await send('split-view', { op: 'close' }))
          break
        }
        if (sub === 'promote') {
          out(await send('split-view', { op: 'promote' }))
          break
        }
        if (sub === 'resize') {
          const pctArg = rest[1]
          if (pctArg === undefined) die('Usage: duo split-view resize <pct>')
          const parsed = Number(pctArg)
          if (!Number.isFinite(parsed)) die('Usage: duo split-view resize <pct>')
          out(await send('split-view', { op: 'resize', pct: parsed }))
          break
        }
        die(`Unknown split-view sub-verb: ${sub}. Expected: open|open-browser|close|promote|resize|state`)
      }
      case 'split': {
        // ENH-014 \u2014 `duo split <pct>` sets the split-pane percentage
        // (terminal column width as % of the split container). Clamps
        // to 20\u201380 server-side. Also accepts named presets to mirror
        // the View \u2192 Pane size menu shortcuts.
        // ENH-099 \u2014 `3way` preset is special: snaps to outer 33/67
        // PLUS inner aux 50/50 (when aux is open). Routes through the
        // dedicated `layout-3way-even` socket verb instead of `split`.
        const arg = rest[0]
        if (arg === undefined) {
          die('Usage: duo split <pct|even|terminal|canvas|terminal-heavy|canvas-heavy|3way>')
        }
        if (arg === '3way' || arg === '3-way' || arg === 'even-3way') {
          out(await send('layout-3way-even', {}))
          break
        }
        const presets: Record<string, number> = {
          even: 50,
          'terminal-heavy': 67,
          'canvas-heavy': 33,
          terminal: 80,
          canvas: 20
        }
        let pct: number
        if (arg in presets) {
          pct = presets[arg]
        } else {
          const parsed = Number(arg)
          if (!Number.isFinite(parsed)) {
            die('Usage: duo split <pct|even|terminal|canvas|terminal-heavy|canvas-heavy|3way>')
          }
          pct = parsed
        }
        out(await send('split', { pct }))
        break
      }
      case 'doc': {
        // `duo doc <subcmd>` for editor doc operations.
        const sub = rest[0]
        const subRest = rest.slice(1)
        // BUG-145 — focused per-verb help so the agent doesn't have to
        // page through the ~200-line global --help. `duo doc --help` or
        // `duo doc <subcmd> --help` returns just the doc-verb section.
        if (sub === '--help' || sub === '-h' || !sub) {
          if (!sub && rest.length === 0) {
            // Original behavior: bare `duo doc` falls through to the
            // usage error below. Preserve that.
          } else {
            printDocHelp(undefined)
            break
          }
        }
        if (subRest.includes('--help') || subRest.includes('-h')) {
          printDocHelp(sub)
          break
        }
        if (sub === 'write') {
          const replaceAll = subRest.includes('--replace-all')
          const textIdx = subRest.indexOf('--text')
          let text: string
          if (textIdx !== -1) {
            text = subRest.slice(textIdx + 1).join(' ')
          } else {
            text = await readStdin()
          }
          const mode = replaceAll ? 'replace-all' : 'replace-selection'
          out(await send('doc-write', { text, mode }))
        } else if (sub === 'read') {
          // Optional path arg: `duo doc read [path]`. Without a path, the
          // active editor responds. With a path, the active editor only
          // responds if it matches; otherwise an error.
          const target = subRest[0]
          const resolved = target ? resolveFilePath(target) : undefined
          const res = await send('doc-read', resolved ? { path: resolved } : {}) as {
            ok: boolean; text?: string; path?: string; dirty?: boolean; error?: string
          }
          if (!res.ok) die(res.error ?? 'doc read failed')
          // Print the live buffer text directly to stdout. Path + dirty
          // status go to stderr so the body remains pipe-friendly.
          if (res.path !== undefined) {
            process.stderr.write(`# ${res.path}${res.dirty ? ' (unsaved changes)' : ''}\n`)
          }
          process.stdout.write(res.text ?? '')
          if (res.text && !res.text.endsWith('\n')) process.stdout.write('\n')
        } else if (sub === 'goto') {
          // ENH-022 — `duo doc goto [<path>] --heading X | --line N | --anchor Y`.
          // Optional positional path; one of three flags required.
          const heading = flagValue(subRest, '--heading')
          const lineStr = flagValue(subRest, '--line')
          const anchor = flagValue(subRest, '--anchor')
          // First positional that isn't a flag value = path. Walk subRest
          // skipping --flag <value> pairs.
          let target: string | undefined
          for (let i = 0; i < subRest.length; i++) {
            const token = subRest[i]
            if (token === '--heading' || token === '--line' || token === '--anchor') {
              i += 1 // skip the value
              continue
            }
            if (token.startsWith('--')) continue
            target = token
            break
          }
          if (heading === undefined && lineStr === undefined && anchor === undefined) {
            die('Usage: duo doc goto [<path>] --heading "X" | --line N | --anchor "Y"')
          }
          const resolved = target ? resolveFilePath(target) : undefined
          const payload: Record<string, unknown> = {}
          if (resolved !== undefined) payload.path = resolved
          if (heading !== undefined) payload.heading = heading
          if (lineStr !== undefined) {
            const n = Number(lineStr)
            if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
              die('--line requires a positive integer')
            }
            payload.line = n
          }
          if (anchor !== undefined) payload.anchor = anchor
          out(await send('doc-goto', payload))
        } else if (sub === 'find') {
          // ENH-023 — `duo doc find <query> [<path>] [--case-sensitive]`.
          const caseSensitive = subRest.includes('--case-sensitive')
          const positionals = subRest.filter(t => !t.startsWith('--'))
          const query = positionals[0]
          if (!query) die('Usage: duo doc find <query> [<path>] [--case-sensitive]')
          const target = positionals[1]
          const resolved = target ? resolveFilePath(target) : undefined
          const payload: Record<string, unknown> = { query }
          if (resolved !== undefined) payload.path = resolved
          if (caseSensitive) payload['case-sensitive'] = true
          out(await send('doc-find', payload))
        } else if (sub === 'conflict-log') {
          // BUG-122 — print the last-recorded conflict diagnostic.
          // Read-only file dump; no IPC. The renderer's
          // writeConflictLog (renderer/utils/conflictDiagnostic.ts)
          // writes `~/.claude/duo/logs/last-conflict.log` on every
          // banner-surfacing event (watcher-dirty + save-pre-
          // reconcile). One-file, latest-only — new conflicts
          // overwrite the prior log.
          const logPath = path.join(os.homedir(), '.claude', 'duo', 'logs', 'last-conflict.log')
          try {
            const raw = fs.readFileSync(logPath, 'utf8')
            process.stdout.write(raw)
            if (!raw.endsWith('\n')) process.stdout.write('\n')
          } catch (err: any) {
            if (err?.code === 'ENOENT') {
              process.stderr.write(`No conflict log yet at ${logPath}\n`)
              process.stderr.write('(One will be written the next time the save-conflict banner surfaces.)\n')
              process.exit(0)
            }
            die(`Could not read ${logPath}: ${err?.message ?? err}`)
          }
        } else if (sub === 'edit') {
          // ENH-195 — `duo doc edit <file> --find "X" --replace "Y"
          // [--occurrence N | --all] [--at-line N]`. Surgical PLAIN-text
          // markdown replace (literal, non-CriticMarkup — a direct
          // accepted edit). Echo-safe when the file is open in the
          // editor (buffer-routed through the editor's save), disk-direct
          // when closed. Distinct from the CriticMarkup verbs above
          // (insert/delete/substitute), which wrap the change as a
          // tracked suggestion.
          const target = subRest.find(a => !a.startsWith('--')) ??
            die('Usage: duo doc edit <file> --find "X" --replace "Y" [--occurrence N | --all] [--at-line N]')
          const find = flagValue(subRest, '--find')
          const replace = flagValue(subRest, '--replace')
          if (find === undefined) die('duo doc edit requires --find "<text>"')
          if (replace === undefined) die('duo doc edit requires --replace "<text>" (may be empty to delete the match)')
          const all = subRest.includes('--all')
          const occStr = flagValue(subRest, '--occurrence')
          if (all && occStr !== undefined) {
            die('duo doc edit: pass --occurrence N OR --all, not both')
          }
          const resolved = resolveFilePath(target)
          const payload: Record<string, unknown> = { path: resolved, find, replace }
          if (all) payload.all = true
          if (occStr !== undefined) {
            const n = Number(occStr)
            if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
              die('--occurrence requires a positive integer')
            }
            payload.occurrence = n
          }
          const atLineStr = flagValue(subRest, '--at-line')
          if (atLineStr !== undefined) {
            const n = Number(atLineStr)
            if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
              die('--at-line requires a positive integer')
            }
            payload.atLine = n
          }
          out(await send('doc-edit-plain', payload))
        } else if (
          sub === 'insert' || sub === 'delete' || sub === 'substitute' ||
          sub === 'highlight' ||
          sub === 'comment' || sub === 'accept' || sub === 'reject'
        ) {
          // BUG-138 Phase 3 — agent CriticMarkup verbs. Each subcommand
          // parses its own flag set, then routes through the single
          // `doc-edit` socket command with a discriminated `op` arg.
          // The file path is the first positional that isn't a flag value.
          //
          // Author is passed via the DUO_AUTHOR env var (defaults to
          // 'agent' on the receiver side). The CLI doesn't read it
          // here — the socket-server resolves the value to keep all
          // attribution decisions in one place.
          const positionals: string[] = []
          for (let i = 0; i < subRest.length; i++) {
            const t = subRest[i]
            if (t === '--after' || t === '--before' || t === '--text' ||
                t === '--with' || t === '--anchor' || t === '--body' ||
                t === '--reply-to' || t === '--match' || t === '--id' ||
                t === '--occurrence' || t === '--at-line') {
              i += 1 // skip the value
              continue
            }
            if (t.startsWith('--')) continue
            positionals.push(t)
          }
          const target = positionals[0]
          if (!target) die(`Usage: duo doc ${sub} <file> [flags] — see duo --help`)
          const resolved = resolveFilePath(target)
          const payload: Record<string, unknown> = { path: resolved, op: sub }

          const dupAuthor = process.env.DUO_AUTHOR
          if (dupAuthor) payload.author = dupAuthor
          const occStr = flagValue(subRest, '--occurrence')
          if (occStr !== undefined) {
            const n = Number(occStr)
            if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
              die('--occurrence requires a positive integer')
            }
            payload.occurrence = n
          }

          if (sub === 'insert') {
            const after = flagValue(subRest, '--after')
            const before = flagValue(subRest, '--before')
            const atLine = flagValue(subRest, '--at-line')
            const text = flagValue(subRest, '--text')
            if (!text) die('Usage: duo doc insert <file> --text "…" (--after "X" | --before "X" | --at-line N)')
            if ([after, before, atLine].filter(v => v !== undefined).length !== 1) {
              die('duo doc insert requires exactly one of --after / --before / --at-line')
            }
            payload.text = text
            if (after !== undefined) payload.after = after
            if (before !== undefined) payload.before = before
            if (atLine !== undefined) {
              const n = Number(atLine)
              if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
                die('--at-line requires a positive integer')
              }
              payload.atLine = n
            }
          } else if (sub === 'delete') {
            const text = flagValue(subRest, '--text')
            if (!text) die('Usage: duo doc delete <file> --text "<target>"')
            payload.text = text
          } else if (sub === 'highlight') {
            // BUG-138 family — `{==X==}` highlight, CLI-parity sibling
            // to delete. Same flag shape.
            const text = flagValue(subRest, '--text')
            if (!text) die('Usage: duo doc highlight <file> --text "<target>"')
            payload.text = text
          } else if (sub === 'substitute') {
            const text = flagValue(subRest, '--text')
            const withText = flagValue(subRest, '--with')
            if (!text || withText === undefined) {
              die('Usage: duo doc substitute <file> --text "<old>" --with "<new>"')
            }
            payload.text = text
            payload.with = withText
          } else if (sub === 'comment') {
            const anchor = flagValue(subRest, '--anchor')
            const body = flagValue(subRest, '--body')
            const replyTo = flagValue(subRest, '--reply-to')
            // BUG-143 — --anchor is required for NEW comments only.
            // For replies (--reply-to <c-id>), --anchor is optional; the
            // server appends `↪ @author ts: body` to the parent token.
            if (!body) {
              die('Usage:\n  Add comment:  duo doc comment <file> --anchor "<text>" --body "<comment>"\n  Reply to:     duo doc comment <file> --reply-to <c-id> --body "<reply>"')
            }
            if (!anchor && !replyTo) {
              die('Usage:\n  Add comment:  duo doc comment <file> --anchor "<text>" --body "<comment>"\n  Reply to:     duo doc comment <file> --reply-to <c-id> --body "<reply>"')
            }
            if (anchor) payload.anchor = anchor
            payload.body = body
            if (replyTo !== undefined) payload.replyTo = replyTo
          } else if (sub === 'accept' || sub === 'reject') {
            const match = flagValue(subRest, '--match')
            const id = flagValue(subRest, '--id')
            if (!match && !id) {
              die(`Usage: duo doc ${sub} <file> (--id <c-id> | --match "<text>")`)
            }
            if (match) payload.match = match
            if (id) payload.id = id
          }

          out(await send('doc-edit', payload))
        } else {
          die('Usage: duo doc <write|read|goto|find|edit|conflict-log|insert|delete|substitute|highlight|comment|accept|reject> [...]')
        }
        break
      }
      case 'reveal': {
        const target = rest[0] ?? die('Usage: duo reveal <path>')
        const resolved = resolveFilePath(target)
        out(await send('reveal', { path: resolved }))
        break
      }
      case 'ls': {
        const target = rest[0]
        const resolved = target ? resolveFilePath(target) : undefined
        out(await send('ls', resolved ? { path: resolved } : {}))
        break
      }
      case 'nav-state': {
        out(await send('nav-state'))
        break
      }
      case 'nav': {
        // Stage 26 PR 2 (ENH-010) — `duo nav state | pin | unpin | pins`.
        // 'state' echoes the navigator snapshot (cwd, selected, expanded).
        // 'pin' / 'unpin' / 'pins' manage the navigator pin list at
        // ~/.claude/duo/nav-pins.json (separate from Stage 24's tab pins).
        const sub = rest[0]
        if (!sub || sub === 'state') {
          out(await send('nav-state'))
        } else if (sub === 'pin' || sub === 'unpin') {
          const pathArg = rest[1] ?? die(`Usage: duo nav ${sub} <path>`)
          const resolved = resolveFilePath(pathArg)
          // Stat the resolved path so we can record the right kind.
          // resolveFilePath already exists checks; if the path doesn't
          // exist, the agent gets a clear error from the renderer.
          let kind: 'file' | 'folder' = 'file'
          try {
            const st = await import('fs').then(m => m.promises.stat(resolved))
            kind = st.isDirectory() ? 'folder' : 'file'
          } catch {
            // Pin a non-existent path? Default to 'file'; the renderer
            // surfaces the missing file in the section with a faint
            // "missing" treatment.
          }
          out(await send('nav-pin', { op: sub, path: resolved, kind }))
        } else if (sub === 'pins') {
          out(await send('nav-pin', { op: 'list' }))
        } else {
          die('Usage: duo nav <state|pin|unpin|pins> ...')
        }
        break
      }
      case 'wait': {
        const selector = rest[0] ?? die('Usage: duo wait <selector> [--timeout ms]')
        const timeoutIdx = rest.indexOf('--timeout')
        const timeout = timeoutIdx !== -1 ? parseInt(rest[timeoutIdx + 1], 10) : undefined
        // Stage 20 — keep the socket alive past the agent-requested wait
        // timeout, otherwise `duo wait --timeout 30000` hits the default
        // 10s socket cap and rejects with "Timeout" while the renderer
        // is still waiting. 5s buffer covers serialization + RTT.
        const socketTimeoutMs = timeout
          ? Math.max(timeout + 5_000, TIMEOUT_MS)
          : undefined
        out(await send('wait', { selector, timeout }, { timeoutMs: socketTimeoutMs }))
        break
      }
      case 'external': {
        const url = rest[0] ?? die('Usage: duo external <url>')
        out(await send('external', { url }))
        break
      }
      case 'selection-format': {
        // `duo selection-format`           → print current state (JSON)
        // `duo selection-format <a|b|c>`   → set + print new state
        const format = rest[0]
        if (format === undefined) {
          out(await send('selection-format'))
        } else {
          if (format !== 'a' && format !== 'b' && format !== 'c') {
            die('Usage: duo selection-format [a|b|c]')
          }
          out(await send('selection-format', { format }))
        }
        break
      }
      case 'send': {
        // `duo send --text "…"`            → write the literal arg
        // `cat foo | duo send`             → write stdin
        // No Enter appended by default (Stage 15 G11 — user confirms).
        // Stage 23b — `--enter` appends a newline so the agent (or a
        // canvas action) can submit a command without two round-trips.
        // Strip --enter from rest BEFORE we slurp the rest into the
        // text payload so it isn't accidentally written to the PTY.
        const enterIdx = rest.indexOf('--enter')
        const enter = enterIdx !== -1
        const argv = enter ? [...rest.slice(0, enterIdx), ...rest.slice(enterIdx + 1)] : rest
        const textIdx = argv.indexOf('--text')
        let text: string
        if (textIdx !== -1) {
          text = argv.slice(textIdx + 1).join(' ')
        } else {
          text = await readStdin()
        }
        if (text === '') die('Usage: duo send [--enter] --text "…"  |  echo … | duo send [--enter]')
        if (enter) text = `${text}\n`
        out(await send('send', { text }))
        break
      }
      case 'html': {
        // Stage 17a — `duo html <subcmd>`. `new` ships in 17a;
        // query / get / set / replace / append / remove / attr ship in
        // 17b Phase C. `comment` / `changes` / `allow-scripts` land in
        // 17d/e per the Stage 17 PRD § 7.
        const sub = rest[0]
        const subRest = rest.slice(1)
        if (sub === 'new') {
          const target = subRest[0] ?? die('Usage: duo html new <path.html> [--title "…"]')
          if (!/\.html?$/i.test(target)) {
            die('duo html new: path must end in .html or .htm')
          }
          const titleIdx = subRest.indexOf('--title')
          const title = titleIdx !== -1 ? subRest.slice(titleIdx + 1).join(' ') : undefined
          const resolved = resolveFilePath(target)
          out(await send('html-new', title ? { path: resolved, title } : { path: resolved }))
          break
        }

        // Stage 17b Phase C — agent ops against the active canvas.
        // Common flag parsing. Local one-arg shim wraps the module-scope
        // two-arg `flagValue` so the dense html-op handlers stay legible
        // without re-passing `subRest` on every call.
        const flag = (name: string): string | undefined => flagValue(subRest, name)
        const collectAttrs = (): { set?: Record<string, string>; remove?: string[] } => {
          // --set k=v can repeat; --remove k can repeat.
          const set: Record<string, string> = {}
          const remove: string[] = []
          for (let i = 0; i < subRest.length; i++) {
            if (subRest[i] === '--set') {
              const kv = subRest[i + 1] ?? ''
              const eq = kv.indexOf('=')
              if (eq === -1) die(`duo html attr: --set expects key=value (got "${kv}")`)
              set[kv.slice(0, eq)] = kv.slice(eq + 1)
              i++
            } else if (subRest[i] === '--remove') {
              if (!subRest[i + 1]) die('duo html attr: --remove expects an attribute name')
              remove.push(subRest[i + 1])
              i++
            }
          }
          const out: { set?: Record<string, string>; remove?: string[] } = {}
          if (Object.keys(set).length > 0) out.set = set
          if (remove.length > 0) out.remove = remove
          return out
        }

        if (sub === 'query') {
          const selector = subRest[0]
          if (!selector) die('Usage: duo html query <css-selector>')
          out(await send('html-op', { op: 'query', selector }))
        } else if (sub === 'get') {
          const id = flag('--id')
          const selector = flag('--selector')
          if (!id && !selector) die('Usage: duo html get --id <duo-id> | --selector <css>')
          out(await send('html-op', { op: 'get', id, selector }))
        } else if (sub === 'set') {
          const id = flag('--id')
          const selector = flag('--selector')
          if (!id && !selector) die('Usage: duo html set --id <duo-id> --content "…"')
          let html = flag('--content') ?? flag('--html')
          if (html === undefined) html = await readStdin()
          if (html === '') die('duo html set: content required (use --content "…" or pipe via stdin)')
          out(await send('html-op', { op: 'set', id, selector, html }))
        } else if (sub === 'replace') {
          const id = flag('--id')
          const selector = flag('--selector')
          if (!id && !selector) die('Usage: duo html replace --id <duo-id> --html "…"')
          let html = flag('--html')
          if (html === undefined) html = await readStdin()
          if (html === '') die('duo html replace: html required (use --html "…" or pipe via stdin)')
          out(await send('html-op', { op: 'replace', id, selector, html }))
        } else if (sub === 'append') {
          const parentId = flag('--parent') ?? flag('--parent-id')
          const parentSelector = flag('--parent-selector')
          if (!parentId && !parentSelector) die('Usage: duo html append --parent <duo-id> --html "…"')
          let html = flag('--html')
          if (html === undefined) html = await readStdin()
          if (html === '') die('duo html append: html required (use --html "…" or pipe via stdin)')
          out(await send('html-op', { op: 'append', parentId, parentSelector, html }))
        } else if (sub === 'remove') {
          const id = flag('--id')
          const selector = flag('--selector')
          if (!id && !selector) die('Usage: duo html remove --id <duo-id> | --selector <css>')
          out(await send('html-op', { op: 'remove', id, selector }))
        } else if (sub === 'attr') {
          const id = flag('--id')
          const selector = flag('--selector')
          if (!id && !selector) die('Usage: duo html attr --id <duo-id> [--set k=v ...] [--remove k ...]')
          const ops = collectAttrs()
          if (!ops.set && !ops.remove) die('duo html attr: at least one --set k=v or --remove k required')
          out(await send('html-op', { op: 'attr', id, selector, ...ops }))
        } else if (sub === 'click') {
          // ENH-055 — programmatic click. Resolves the target via
          // --id (preferred) or --selector, calls element.click().
          // Triggers the canvas-action delegated dispatcher just
          // like a real user click — `data-duo-action` verbs fire,
          // events emit, etc. Used by lesson fly-through harnesses.
          const id = flag('--id')
          const selector = flag('--selector')
          if (!id && !selector) die('Usage: duo html click --id <duo-id> | --selector <css>')
          out(await send('html-op', { op: 'click', id, selector }))
        } else if (sub === 'comment') {
          // Stage 17d — `duo html comment`. Anchor via --id, --selector,
          // or --text; --body is required (or via stdin).
          const id = flag('--id')
          const selector = flag('--selector')
          const text = flag('--text')
          if (!id && !selector && !text) {
            die('Usage: duo html comment --id <duo-id> | --selector <css> | --text "<substring>" --body "…"')
          }
          let body = flag('--body')
          if (body === undefined) body = await readStdin()
          if (!body || body.trim() === '') {
            die('duo html comment: --body required (use --body "…" or pipe via stdin)')
          }
          out(await send('html-comment', { id, selector, text, body }))
        } else if (sub === 'comments') {
          // Stage 17d — `duo html comments` lists threads on the active
          // canvas. Optional --filter all|open|resolved (default 'all').
          const filterRaw = flag('--filter')
          const filter = filterRaw ?? 'all'
          if (filter !== 'all' && filter !== 'open' && filter !== 'resolved') {
            die("duo html comments: --filter must be 'all', 'open', or 'resolved'")
          }
          out(await send('html-comments', { filter }))
        } else {
          die('Usage: duo html <new|query|get|set|replace|append|remove|attr|comment|comments> [...]')
        }
        break
      }
      case 'file': {
        // Stage 26 item 6 — file-mutation actions matching the navigator's
        // right-click menu. Recoverable trash + same-fs rename:
        //   duo file rename <old> <new>     → fs.rename
        //   duo file trash <path>           → shell.trashItem (macOS Trash)
        const sub = rest[0]
        if (sub === 'rename') {
          const oldArg = rest[1] ?? die('Usage: duo file rename <old> <new>')
          const newArg = rest[2] ?? die('Usage: duo file rename <old> <new>')
          const oldPath = resolveFilePath(oldArg)
          const newPath = resolveFilePath(newArg)
          out(await send('file', { op: 'rename', oldPath, newPath }))
        } else if (sub === 'trash') {
          const pathArg = rest[1] ?? die('Usage: duo file trash <path>')
          const resolved = resolveFilePath(pathArg)
          out(await send('file', { op: 'trash', path: resolved }))
        } else {
          die('Usage: duo file <rename|trash> ...')
        }
        break
      }
      case 'new-tab': {
        // Stage 19c D27 — open a new terminal tab.
        //   duo new-tab                        → persisted last-kind, navigator pending CWD
        //   duo new-tab --shell                → vanilla shell
        //   duo new-tab --claude               → auto-launches `claude`
        //   duo new-tab --cwd <path>           → explicit CWD (overrides navigator)
        //   duo new-tab --cmd "<text>"         → pre-typed payload (no trailing newline)
        // Returns {id, kind, cwd, title}.
        const args: { kind?: 'shell' | 'claude'; cwd?: string; cmd?: string } = {}
        if (rest.includes('--shell') && rest.includes('--claude')) {
          die('Usage: duo new-tab [--shell|--claude] — pick at most one')
        }
        if (rest.includes('--shell')) args.kind = 'shell'
        if (rest.includes('--claude')) args.kind = 'claude'
        const cwdIdx = rest.indexOf('--cwd')
        if (cwdIdx !== -1) {
          const v = rest[cwdIdx + 1]
          if (!v) die('Usage: duo new-tab --cwd <path>')
          args.cwd = resolveFilePath(v)
        }
        const cmdIdx = rest.indexOf('--cmd')
        if (cmdIdx !== -1) {
          const v = rest[cmdIdx + 1]
          if (v === undefined) die('Usage: duo new-tab --cmd "<text>"')
          args.cmd = v
        }
        out(await send('new-tab', args as Record<string, unknown>))
        break
      }
      case 'devtools': {
        // ENH-123 — open DevTools on the main renderer (default) or
        // the active browser pane. --close closes any open instance
        // for the chosen target.
        //
        //   duo devtools                    # main renderer DevTools
        //   duo devtools --browser-pane     # active browser tab DevTools
        //   duo devtools --close            # close renderer DevTools
        //   duo devtools --browser-pane --close  # close browser DevTools
        const target = rest.includes('--browser-pane') ? 'browser-pane' : 'renderer'
        const close = rest.includes('--close')
        out(await send('devtools', { target, close }))
        break
      }
      case 'layout': {
        // ENH-124 — JSON snapshot of WorkingPane / terminal /
        // navigator state. Pairs with `duo nav-state` (file tree) and
        // `duo dom` (renderer DOM) as the third visibility verb.
        out(await send('layout', {}))
        break
      }
      case 'status': {
        // ENH-195 — high-level app snapshot: open file/browser tabs
        // (with per-tab dirty / active / pinned), the active working
        // tab, focused column, theme, terminal-tab count. The keystone
        // orientation verb — run it first to see what the user is
        // looking at. Read live from the renderer (no cache).
        out(await send('status', {}))
        break
      }
      case 'json': {
        // ENH-195 — structured edits to a JSON / YAML file.
        //   duo json set <file> <dotpath> <value>   # set value at path
        //   duo json merge <file> <patch.json>      # deep-merge object
        // Echo-safe when the file is open in the JSON viewer (buffer-
        // routed through its save); disk-direct (JSON.parse / js-yaml)
        // when closed. <value> is parsed as JSON if it parses, else
        // treated as a literal string. <dotpath> is dotted with `[n]`
        // array indices; empty string or '.' targets the root. YAML
        // round-trips lose comments (noted in the reply reason).
        const sub = rest[0]
        const subRest = rest.slice(1)
        if (sub === 'set') {
          const file = subRest[0]
          const pointer = subRest[1]
          // Everything after the pointer is the value (so unquoted
          // multi-word strings survive); pointer may be '' or '.'.
          if (file === undefined || pointer === undefined || subRest.length < 3) {
            die('Usage: duo json set <file> <dotpath> <value>\n  <dotpath>: dotted with [n] indices; "" or "." = root.\n  <value>: parsed as JSON if valid, else treated as a literal string.')
          }
          const rawValue = subRest.slice(2).join(' ')
          // Try to parse as JSON (number / bool / null / object / array /
          // quoted string); on failure, treat it as a literal string and
          // JSON-encode that so the wire payload is always valid JSON.
          let valueJson: string
          try {
            JSON.parse(rawValue)
            valueJson = rawValue
          } catch {
            valueJson = JSON.stringify(rawValue)
          }
          const resolved = resolveFilePath(file)
          out(await send('json-op', { path: resolved, op: 'set', pointer, valueJson }))
        } else if (sub === 'merge') {
          const file = subRest[0]
          const patchPath = subRest[1]
          if (file === undefined || patchPath === undefined) {
            die('Usage: duo json merge <file> <patch.json>')
          }
          const resolvedPatch = resolveFilePath(patchPath)
          let mergeJson: string
          try {
            mergeJson = fs.readFileSync(resolvedPatch, 'utf8')
          } catch (err: any) {
            die(`Could not read patch file ${resolvedPatch}: ${err?.message ?? err}`)
          }
          // Validate it parses as JSON before sending (friendlier than a
          // server-side parse error).
          try {
            JSON.parse(mergeJson)
          } catch (e) {
            die(`Patch file ${resolvedPatch} is not valid JSON: ${(e as Error).message}`)
          }
          const resolved = resolveFilePath(file)
          out(await send('json-op', { path: resolved, op: 'merge', mergeJson }))
        } else {
          die('Usage:\n  duo json set <file> <dotpath> <value>\n  duo json merge <file> <patch.json>')
        }
        break
      }
      case 'inspect': {
        // ENH-159b — toggle element-inspect mode in the active
        // browser pane. No arg → toggle; --on / --off force a state.
        // Mirrors Chrome devtools' Inspect Element (⌘⇧C inside Duo
        // also fires this from the WCV via the keystroke forwarder).
        //
        //   duo inspect              # toggle
        //   duo inspect --on         # force on
        //   duo inspect --off        # force off
        //
        // While active, hover an element to outline it; click to ship
        // its tag + selector + heading trail + innerText + key attrs
        // to the active terminal as a structured paste. ESC exits
        // without picking.
        const on = rest.includes('--on')
        const off = rest.includes('--off')
        if (on && off) die('Usage: duo inspect [--on|--off]')
        out(await send('inspect', { on, off }))
        break
      }
      case 'doctor':
        await runDoctor()
        break
      case 'install': {
        const system = rest.includes('--system')
        runInstall({ system })
        break
      }
      case 'pack': {
        // Stage 21d-iii — distro pack management.
        //   duo pack list                — JSON list of installed packs
        //   duo pack uninstall <name>    — remove a pack
        // Future: duo pack install <url> (FOLLOWUP-010)
        const sub = rest[0]
        if (sub === 'list') {
          out(await send('pack-list', {}))
          break
        }
        if (sub === 'uninstall') {
          const name = rest[1]
          if (!name) die('Usage: duo pack uninstall <distro-name>')
          const removeFolder = rest.includes('--remove-folder')
          out(await send('pack-uninstall', { name, removeFolder }))
          break
        }
        die('Usage: duo pack list  |  duo pack uninstall <name> [--remove-folder]')
      }
      case 'git-status': {
        // ENH-152a — git status probe for the Navigator root chip.
        //   duo git-status [<path>]   — defaults to $HOME.
        // Returns the full GitStatusSnapshot JSON; the renderer
        // filters down to the chip via formatGitStatusChip.
        const cwd = rest[0]
        out(await send('git-status', cwd ? { cwd } : {}))
        break
      }
      case 'clone': {
        // ENH-151 — `gh repo clone` (preferred) / `git clone` fallback.
        //   duo clone <url> [<target-dir>]
        // Probes `gh auth status` first; falls back to git for public
        // repos. Non-zero exit on failure; --json outputs the structured
        // result so agents can branch on errorKind (bad-url / auth-missing
        // / clone-failed).
        const url = rest[0]
        if (!url) die('Usage: duo clone <url> [<target-dir>]')
        const targetDir = rest[1] && !rest[1].startsWith('--') ? rest[1] : undefined
        const result = (await send('clone', { url, targetDir })) as {
          ok: boolean
          clonedTo?: string
          errorKind?: string
          error?: string
          via?: string
        }
        if (rest.includes('--json')) {
          out(JSON.stringify(result, null, 2))
        } else if (result.ok) {
          out(`Cloned via ${result.via} → ${result.clonedTo}`)
        } else {
          die(`clone failed (${result.errorKind ?? 'unknown'}): ${result.error ?? 'no detail'}`)
        }
        break
      }
      case 'gh-auth': {
        // ENH-151 — `gh auth status` probe. JSON-only output; used by
        // the Clone modal + future Doctor panel.
        //   duo gh-auth
        out(await send('gh-auth', {}))
        break
      }
      case 'worktree': {
        // ENH-210 (list) + ENH-221 (new/remove) — list / create / remove
        // git worktrees. Reads AND writes git DIRECTLY (like the vault
        // verbs) — no socket / running app needed, so it works from any
        // terminal and inside a sandbox. The exception is `new --window`,
        // which additionally asks the app to open the worktree in a window.
        const sub = rest[0]

        if (sub === 'new') {
          // duo worktree new "<desc>" [--from <ref>] [--window]
          const subRest = rest.slice(1)
          const desc = positionalArgs(subRest, ['--from'])[0]
          if (!desc) die('Usage: duo worktree new "<description>" [--from <ref>] [--window]')
          const fromRef = flagValue(subRest, '--from')
          const res = await createWorktree(process.cwd(), { name: desc, fromRef })
          if (!res.ok) die(res.error ?? 'duo worktree new failed')
          // --window: also open the new worktree in a fresh Duo window
          // (needs the running app). The worktree already exists either
          // way, so a window failure is reported, not fatal.
          if (subRest.includes('--window') && res.path) {
            const wr = (await send('window', { action: 'new', cwd: res.path })) as { ok?: boolean; error?: string }
            if (wr && wr.ok === false) {
              out({ ...res, window: { ok: false, error: wr.error ?? 'could not open window (is "Allow Multiple Windows" enabled?)' } })
              break
            }
          }
          out(res)
          break
        }

        if (sub === 'remove') {
          // duo worktree remove <path> [--force]
          const subRest = rest.slice(1)
          const targetArg = positionalArgs(subRest)[0]
          if (!targetArg) die('Usage: duo worktree remove <path> [--force]')
          const targetPath = path.resolve(process.cwd(), targetArg)
          const res = await removeWorktree(targetPath, { force: subRest.includes('--force') })
          if (!res.ok) die(res.error ?? 'duo worktree remove failed')
          out({ ok: true, removed: targetPath })
          break
        }

        // Default: list. `duo worktree [list] [<path>]` — defaults to cwd.
        const args2 = sub === 'list' ? rest.slice(1) : rest
        const target = args2[0]
          ? path.resolve(process.cwd(), args2[0])
          : process.cwd()
        out(await listWorktrees(target))
        break
      }
      case 'close-tab': {
        // FOLLOWUP-020 — close the focused working-pane file/canvas/
        // viewer tab. CLI parity for the ⌘W chord on the working strip.
        // Pinned-tab gating is the renderer's job (dialog.confirm); a
        // CLI close of a pinned tab still surfaces the confirmation.
        out(await send('close-tab', {}))
        break
      }
      case 'close-terminal-tab': {
        // FOLLOWUP-020 — close a terminal tab.
        //   duo close-terminal-tab       → close the focused terminal tab
        //   duo close-terminal-tab <n>   → close the Nth terminal tab (1-indexed)
        const arg = rest[0]
        const n = arg ? Number.parseInt(arg, 10) : undefined
        if (arg && (Number.isNaN(n) || n! < 1)) {
          die('Usage: duo close-terminal-tab [<n>]   (n is 1-indexed)')
        }
        out(await send('close-terminal-tab', n !== undefined ? { n } : {}))
        break
      }
      case 'workspace': {
        // ENH-167 — workspace-as-file.
        //   duo workspace save [<path>] [--name <name>] [--save-as]
        //   duo workspace open <path>
        //   duo workspace list-recent [--json]
        //   duo workspace current [--json]
        //   duo workspace new
        const sub = rest[0]
        if (!sub) {
          die('Usage: duo workspace <save|open|list-recent|current|new> [args]')
        }
        if (sub === 'save') {
          const subRest = rest.slice(1)
          // First non-flag positional = path (optional).
          const path = subRest.find(a => !a.startsWith('-'))
          const name = flagValue(subRest, '--name')
          const saveAs = subRest.includes('--save-as')
          const payload: Record<string, unknown> = { op: 'save' }
          if (path) payload.path = path
          if (name) payload.name = name
          if (saveAs) payload['save-as'] = true
          out(await send('workspace', payload))
        } else if (sub === 'open') {
          const path = rest[1]
          if (!path) die('Usage: duo workspace open <path>')
          out(await send('workspace', { op: 'open', path }))
        } else if (sub === 'list-recent') {
          out(await send('workspace', { op: 'list-recent' }))
        } else if (sub === 'current') {
          out(await send('workspace', { op: 'current' }))
        } else if (sub === 'new') {
          out(await send('workspace', { op: 'new' }))
        } else {
          die(`Unknown workspace sub-op: ${sub}. Expected save|open|list-recent|current|new.`)
        }
        break
      }
      case 'session': {
        // ENH-183 pared 2026-05-25 (Option A) — rename + hydrate dropped.
        //   duo session list [--cwd <path>]
        //   duo session resume <tabId> <uuid>
        const sub = rest[0]
        if (!sub) {
          die('Usage: duo session <list|resume|open> [args]')
        }
        if (sub === 'list') {
          const cwd = flagValue(rest, '--cwd')
          const payload: Record<string, unknown> = { op: 'list' }
          if (cwd) payload.cwd = cwd
          out(await send('session', payload))
        } else if (sub === 'resume') {
          const tabId = rest[1]
          const uuid = rest[2]
          if (!tabId || !uuid) die('Usage: duo session resume <tabId> <uuid>')
          out(await send('session', { op: 'resume', tabId, uuid }))
        } else if (sub === 'open') {
          // ENH-212 — the Home click contract: focus-if-open, else resume
          // (in the primary window — D15). --cwd required to resume. --force
          // FORKS (claude --resume --fork-session, a new branched session id)
          // when the session is live outside Duo (otherwise refused; parity
          // with the UI's Fork dialog) so the running copy isn't clobbered.
          const uuid = rest[1]
          if (!uuid) die('Usage: duo session open <uuid> [--cwd <path>] [--force]')
          const cwd = flagValue(rest, '--cwd')
          const force = rest.includes('--force')
          const payload: Record<string, unknown> = { op: 'open', uuid }
          if (cwd) payload.cwd = cwd
          if (force) payload.force = true
          out(await send('session', payload))
        } else {
          die(`Unknown session sub-op: ${sub}. Expected list|resume|open.`)
        }
        break
      }

      case 'home': {
        // ENH-212 — Home re-entry surface CLI parity. Bare "duo home" maps
        // to show. show/refresh push HOME_SHOW (refresh refetches when Home
        // is active); state [--json] pulls __duoGetHomeState. --window N is
        // applied by send()'s envelope (DUO_WINDOW stamp), like every verb.
        const sub = rest[0] ?? 'show'
        if (sub === 'show' || sub === 'refresh') {
          out(await send('home', { op: sub }))
        } else if (sub === 'state') {
          // Output is already JSON; --json is accepted for symmetry (no-op).
          out(await send('home', { op: 'state' }))
        } else {
          die(`Unknown home sub-op: ${sub}. Expected show|state|refresh.`)
        }
        break
      }

      case 'term': {
        // ENH-212 — terminal-tab management. term tabs enumerates the
        // window's terminal tabs; term tab <id> activates one by its id;
        // term close <id> [--force] closes one (refused if it's running a
        // live claude unless --force). ids come from "term tabs" — NOT a bare
        // index. Honors --window N.
        const sub = rest[0]
        if (!sub) {
          die('Usage: duo term <tabs|tab|close> [<id>] [--force]')
        }
        if (sub === 'tabs') {
          out(await send('term', { op: 'tabs' }))
        } else if (sub === 'tab') {
          const tabId = rest[1]
          if (!tabId) die('Usage: duo term tab <id>   (id from "duo term tabs")')
          out(await send('term', { op: 'tab', tabId }))
        } else if (sub === 'close') {
          const tabId = rest[1]
          if (!tabId) die('Usage: duo term close <id> [--force]   (id from "duo term tabs")')
          const payload: Record<string, unknown> = { op: 'close', tabId }
          if (rest.includes('--force')) payload.force = true
          out(await send('term', payload))
        } else {
          die(`Unknown term sub-op: ${sub}. Expected tabs|tab|close.`)
        }
        break
      }

      case 'workspace-pill-menu': {
        // ENH-184 (Sprint 23 / v0.8.0) — toggle the workspace-pill
        // click-to-open-menu localStorage flag (default OFF). Bare
        // command reads cached state; arg writes.
        const mode = rest[0]
        if (mode === undefined) {
          out(await send('workspace-pill-menu'))
        } else {
          if (mode !== 'on' && mode !== 'off' && mode !== 'toggle') {
            die('Usage: duo workspace-pill-menu [on|off|toggle]')
          }
          out(await send('workspace-pill-menu', { mode }))
        }
        break
      }

      case 'project': {
        // ENH-182 Phase 4 (Sprint 23 / v0.8.0) — project rail CLI parity.
        //   duo project list
        //   duo project focus <name|root>
        //   duo project focus --all
        //   duo project pin <name|root>
        //   duo project unpin <name|root>
        //   duo project close <name|root>
        // Name resolution is case-insensitive against the cached rail
        // snapshot (renderer pushes via PROJECTS_STATE_PUSH); exact root
        // path match wins, then unique name match.
        const sub = rest[0]
        if (!sub) {
          die('Usage: duo project <list|focus|pin|unpin|close> [args]')
        }
        if (sub === 'list') {
          out(await send('project', { op: 'list' }))
        } else if (sub === 'focus' || sub === 'pin' || sub === 'unpin' || sub === 'close') {
          const ref = rest[1]
          if (!ref) {
            if (sub === 'focus') die('Usage: duo project focus <name|root> | --all')
            die(`Usage: duo project ${sub} <name|root>`)
          }
          out(await send('project', { op: sub, ref }))
        } else {
          die(`Unknown project sub-op: ${sub}. Expected list|focus|pin|unpin|close.`)
        }
        break
      }

      // ── Vault (ENH-208) — pure-local fs verbs (no socket) ──
      // Subcommands use `sub === '…'` ladders (not nested `case`) — the
      // currency checker reads every indented `case 'x':` as a top-level
      // verb, so subcommand verbs must avoid nested switch/case.
      case 'vault': {
        const sub = rest[0]
        const subRest = rest.slice(1)
        const vaultFlag = flagValue(subRest, '--vault')
        if (sub === 'init') {
          const folder = positionalArgs(subRest, ['--format', '--name'])[0]
          if (!folder) die('Usage: duo vault init <path> --format=okf|obsidian [--name "…"] [--no-default] [--force]')
          // ENH-216 D2 — `--format` is REQUIRED on the CLI (deliberate
          // asymmetry with the New Vault dialog, which defaults to OKF). Accept
          // both `--format=okf` and `--format okf` spellings.
          const formatRaw =
            subRest.find((a) => a.startsWith('--format='))?.slice('--format='.length) ??
            flagValue(subRest, '--format')
          if (!formatRaw) {
            die('Usage: duo vault init <path> --format=okf|obsidian [--name "…"] [--no-default] [--force]\n  --format is required (okf = standard markdown rel links; obsidian = wikilinks)')
          }
          if (formatRaw !== 'okf' && formatRaw !== 'obsidian') {
            die(`unknown --format "${formatRaw}" (expected okf or obsidian)`)
          }
          const name =
            subRest.find((a) => a.startsWith('--name='))?.slice('--name='.length) ??
            flagValue(subRest, '--name')
          const result = vault.initVault(path.resolve(process.cwd(), folder), {
            force: subRest.includes('--force'),
            format: formatRaw,
            name,
          })
          // ENH-208 — register the freshly-scaffolded vault so the Settings →
          // Default Vault picker offers it (window-independent known list)
          // before it's ever been set as the default. ENH-216 — a fresh vault
          // becomes the default by default (CLI twin of the New Vault dialog
          // flow); --no-default opts out (PR#98 review C1) so a throwaway
          // scaffold doesn't silently hijack the global default — it still
          // lands in `knownVaults` via rememberVault, so the picker offers it,
          // it just isn't auto-activated.
          const noDefault = subRest.includes('--no-default')
          vault.rememberVault(result.root)
          if (!noDefault) vault.setDefaultVault(result.root)
          for (const w of result.warnings) process.stderr.write(`duo: warning — ${w}\n`)
          out({ ...result, madeDefault: !noDefault })
        } else if (sub === 'list') {
          // Vaults detected from the cwd (enclosing + nested).
          out(vault.listVaults(process.cwd()))
        } else if (sub === 'default') {
          // `duo vault default`        → print the current default (JSON)
          // `duo vault default <path>` → set it (validates it's a vault)
          // `duo vault default --clear` → unset it
          // Every shape echoes `knownVaults` too (the self-healed list the
          // Settings picker offers): setting records the vault there, and
          // --clear preserves the list — the echo makes both visible.
          if (subRest.includes('--clear')) {
            vault.clearDefaultVault()
            out({ defaultVault: null, knownVaults: vault.listKnownVaults() })
          } else {
            const target = positionalArgs(subRest, [])[0]
            if (target) {
              out({ defaultVault: vault.setDefaultVault(target), knownVaults: vault.listKnownVaults() })
            } else {
              out({ defaultVault: vault.readDefaultVault(), knownVaults: vault.listKnownVaults() })
            }
          }
        } else if (sub === 'schema') {
          out(vault.buildCorpus(vault.resolveVaultOrDefault(process.cwd(), vaultFlag)))
        } else if (sub === 'capture') {
          const root = vault.resolveVaultOrDefault(process.cwd(), vaultFlag)
          const result = vault.captureNote(root, {
            template: flagValue(subRest, '--template'),
            text: flagValue(subRest, '--text'),
            title: flagValue(subRest, '--title'),
          })
          let opened: unknown = null
          if (subRest.includes('--open')) {
            // Mirror the `view` verb — opens the .md in the working pane.
            try {
              opened = await send('view', { path: result.absPath })
            } catch (e) {
              opened = { error: e instanceof Error ? e.message : String(e) }
              process.stderr.write(`duo: captured ${result.path} but --open failed: ${(opened as { error: unknown }).error}\n`)
            }
          }
          out(subRest.includes('--open') ? { ...result, opened } : result)
        } else if (sub === 'stub') {
          // Create an entity stub from its template, filed by the D19 rule
          // (the CLI twin of the silent-stub `[[New Name]]`⇥ gesture). v1
          // way for the agent to make a typed stub instead of hand-writing.
          const root = vault.resolveVaultOrDefault(process.cwd(), vaultFlag)
          const posn = positionalArgs(subRest, ['--vault'])
          const type = posn[0]
          const name = posn.slice(1).join(' ')
          if (!type || !name) die('Usage: duo vault stub <type> <name> [--open] [--vault <path>]')
          const result = vault.createEntityStub(root, type, name)
          let opened: unknown = null
          if (subRest.includes('--open')) {
            try {
              opened = await send('view', { path: result.absPath })
            } catch (e) {
              opened = { error: e instanceof Error ? e.message : String(e) }
              process.stderr.write(`duo: stubbed ${result.path} but --open failed: ${(opened as { error: unknown }).error}\n`)
            }
          }
          out(subRest.includes('--open') ? { ...result, opened } : result)
        } else if (sub === 'search') {
          const query = positionalArgs(subRest, ['--vault'])[0]
          if (!query) die('Usage: duo vault search <query> [--vault <path>]')
          out(vault.search(vault.resolveVaultOrDefault(process.cwd(), vaultFlag), query))
        } else if (sub === 'mv') {
          // ENH-216 D5 (clean path) — move a note and rewrite every inbound
          // markdown link to point at its new home, re-basing the moved note's
          // own outbound links too. <from>/<to> are vault-relative.
          const posn = positionalArgs(subRest, ['--vault'])
          const from = posn[0]
          const to = posn[1]
          if (!from || !to) die('Usage: duo vault mv <from> <to> [--vault <path>]')
          const root = vault.resolveVaultOrDefault(process.cwd(), vaultFlag)
          out(vault.moveNote(root, from, to))
        } else if (sub === 'relink') {
          // ENH-216 D5 (out-of-band repair) — re-resolve dangling markdown
          // links by slug/basename first; the stable `id:` only tiebreaks when
          // >1 note shares a slug. Rewrite the ones that resolve unambiguously,
          // REPORT ambiguous + broken (warn-don't-block). `--dry-run` reports
          // without writing.
          const root = vault.resolveVaultOrDefault(process.cwd(), vaultFlag)
          out(vault.relinkVault(root, { dryRun: subRest.includes('--dry-run') }))
        } else if (sub === 'publish') {
          // ENH-216 D8 — (re)generate the OKF static listings from the corpus:
          // root index.md (frontmatter byte-preserved) + log.md, and per-dir
          // index.md with --dir. --index-only / --log-only restrict the write.
          // --open surfaces index.md as a tab. OKF-mode-gated (throws in
          // Obsidian mode — Obsidian stays byte-identical).
          const root = vault.resolveVaultOrDefault(process.cwd(), vaultFlag)
          // --index-only / --log-only narrow the WRITE, not just the echo:
          // writeListings leaves the out-of-scope file byte-identical (no fresh
          // stamp → no git churn). Mutually exclusive; --index-only wins if both
          // are somehow passed. (PR#98 review cluster B.) `result.written` then
          // reflects exactly what was written, so the echo is truthful for free.
          const scope: 'index' | 'log' | 'both' = subRest.includes('--index-only')
            ? 'index'
            : subRest.includes('--log-only')
              ? 'log'
              : 'both'
          const result = vault.writeListings(root, { perDir: subRest.includes('--dir'), scope })
          let opened: unknown = null
          if (subRest.includes('--open')) {
            const indexAbs = path.join(root, 'index.md')
            try {
              opened = await send('open', { url: resolveOpenTarget(indexAbs), mode: 'browser', reveal: true })
            } catch (e) {
              opened = { error: e instanceof Error ? e.message : String(e) }
              process.stderr.write(`duo: published listings but --open failed: ${(opened as { error: unknown }).error}\n`)
            }
          }
          out({ ...result, ...(subRest.includes('--open') ? { opened } : {}) })
        } else if (sub === 'promote') {
          // ENH-216 D9 — split a `## heading` section of a note into its own
          // typed entity, leaving a markdown LINK behind (a wikilink in
          // Obsidian) — NEVER an embed-transclusion.
          const note = positionalArgs(subRest, ['--vault', '--heading', '--type'])[0]
          const heading = flagValue(subRest, '--heading')
          const type = flagValue(subRest, '--type')
          if (!note || !heading || !type) {
            die('Usage: duo vault promote <note> --heading "<h>" --type <t> [--vault <path>]')
          }
          const root = vault.resolveVaultOrDefault(process.cwd(), vaultFlag)
          out(vault.promoteSection(root, note, heading, type))
        } else {
          die(
            'Usage: duo vault <init|list|schema|capture|stub|search|default|mv|relink|publish|promote> [args]\n' +
              '  init <path> --format=okf|obsidian [--name "…"] [--no-default] [--force]   scaffold a new vault (becomes active unless --no-default)\n' +
              '  list                      vaults detected from the cwd (JSON)\n' +
              '  schema [--vault p]        the L0 corpus (JSON)\n' +
              '  capture [--template t] [--text "…"] [--title "…"] [--open]   new inbox note\n' +
              '  stub <type> <name> [--open]   create a typed entity stub (D19-filed)\n' +
              '  search <query>            full-text hits (JSON)\n' +
              '  default [<path>|--clear]  read / set the default vault\n' +
              '  mv <from> <to>            move a note + rewrite inbound md links (D5 clean path)\n' +
              '  relink [--dry-run]        repair out-of-band moves (slug-first; id tiebreaks same-slug; D5)\n' +
              '  publish [--index-only|--log-only] [--dir] [--open]   (re)generate OKF listings (D8)\n' +
              '  promote <note> --heading "<h>" --type <t>   split a section into its own entity (D9)',
          )
        }
        break
      }
      case 'graph': {
        const sub = rest[0]
        const subRest = rest.slice(1)
        const vaultFlag = flagValue(subRest, '--vault')
        if (sub === 'backlinks') {
          const note = positionalArgs(subRest, ['--vault'])[0]
          if (!note) die('Usage: duo graph backlinks <note> [--vault <path>]')
          out(vault.backlinks(vault.resolveVaultOrDefault(process.cwd(), vaultFlag), note))
        } else if (sub === 'orphans') {
          out(vault.orphans(vault.resolveVaultOrDefault(process.cwd(), vaultFlag)))
        } else {
          die('Usage: duo graph <backlinks <note>|orphans> [--vault <path>]')
        }
        break
      }
      case 'base': {
        const sub = rest[0]
        const subRest = rest.slice(1)
        const vaultFlag = flagValue(subRest, '--vault')
        if (sub === 'lint') {
          const target = positionalArgs(subRest, ['--vault'])[0] ?? (subRest.includes('--all') ? '--all' : undefined)
          if (!target) die('Usage: duo base lint <file|--all> [--vault <path>]')
          const root = vault.resolveVaultOrDefault(process.cwd(), vaultFlag)
          out(vault.lintVault(root, target))
        } else if (sub === 'render') {
          const target = positionalArgs(subRest, ['--vault', '--out'])[0]
          if (!target) die('Usage: duo base render <file|note> [--out <path>] [--open] [--vault <path>]')
          const root = vault.resolveVaultOrDefault(process.cwd(), vaultFlag)
          const result = vault.renderTarget(root, target)
          const outFlag = flagValue(subRest, '--out')
          const open = subRest.includes('--open')
          const stem = path.basename(target).replace(/\.(base|md)$/i, '') || 'rollup'
          let outPath: string
          if (outFlag) outPath = path.resolve(process.cwd(), outFlag)
          else if (open) outPath = path.join(os.tmpdir(), `duo-rollup-${stem}-${Date.now()}.html`)
          else outPath = path.join(root, 'out', `${stem}.html`)
          fs.mkdirSync(path.dirname(outPath), { recursive: true })
          fs.writeFileSync(outPath, result.html)
          // `--open` is the one vault verb that reaches the running app
          // (to surface the artifact as a tab). It fails gracefully when
          // Duo isn't running — the file is already written either way.
          // Payload MUST mirror the `open` verb (case 'open'): the IPC
          // handler keys on `url` (a file:// URL via resolveOpenTarget),
          // NOT `path`. `reveal` expands + focuses the pane so the user
          // actually sees the rollup. Keep these two call sites in sync.
          let opened: unknown = null
          if (open) {
            try {
              opened = await send('open', { url: resolveOpenTarget(outPath), mode: 'browser', reveal: true })
            } catch (e) {
              opened = { error: e instanceof Error ? e.message : String(e) }
            }
            // Surface an open failure on stderr too (the artifact write
            // still succeeded, so exit stays 0) — don't let it hide in
            // the JSON `opened.error` field where an agent would miss it.
            if (opened && typeof opened === 'object' && 'error' in opened) {
              process.stderr.write(`duo: base render wrote ${outPath} but --open failed: ${(opened as { error: unknown }).error}\n`)
            }
          }
          out({
            path: outPath,
            sourceHash: result.sourceHash,
            generatedAt: result.generatedAt,
            asOf: result.asOfLabel,
            bases: result.bases.map((b) => ({
              label: b.label,
              views: b.evaluated.views.map((v) => ({ name: v.name, type: v.type, rows: v.rows.length })),
            })),
            ...(open ? { opened } : {}),
          })
        } else {
          die('Usage: duo base <lint <file|--all>|render <file|note>> [--out <path>] [--open] [--vault <path>]')
        }
        break
      }

      default:
        die(`Unknown command: ${cmd}\nRun duo --help for usage`)
    }
  } catch (err) {
    die(err instanceof Error ? err.message : String(err))
  }
}

// Read all stdin into a string. Used by `duo doc write` so agents can pipe
// content via shell heredocs / process substitution.
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      // No pipe — return empty rather than blocking forever on a terminal.
      resolve('')
      return
    }
    const chunks: Buffer[] = []
    process.stdin.on('data', (c) => chunks.push(Buffer.from(c)))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    process.stdin.on('error', reject)
  })
}

// Resolves a filesystem path arg to an absolute path (no `file://` prefix),
// expanding `~` and making relative paths absolute against the CLI's CWD.
// Used by `duo view` / `duo reveal` / `duo ls` (they talk in raw paths;
// it's the working pane that translates to `file://` when needed).
function resolveFilePath(input: string): string {
  if (input.startsWith('~/') || input === '~') {
    return path.resolve(input.replace(/^~/, os.homedir()))
  }
  if (path.isAbsolute(input)) return input
  return path.resolve(process.cwd(), input)
}

// Resolves a `duo open` argument to a URL the browser can load:
//   - Anything with a URL scheme (http, https, file, about, chrome, data, duo-file)
//     passes through unchanged.
//   - `~/foo`, absolute paths, and relative paths all resolve to absolute
//     file paths, then become `file://` URLs with proper encoding.
function resolveOpenTarget(target: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return target   // already a URL
  let absolute: string
  if (target.startsWith('~/') || target === '~') {
    absolute = path.resolve(target.replace(/^~/, os.homedir()))
  } else {
    absolute = path.resolve(process.cwd(), target)
  }
  // Use pathToFileURL via URL constructor pattern to get correct encoding
  // (spaces, utf-8, etc). Node's url.pathToFileURL would be cleaner, but
  // the bundled CLI avoids importing extra modules for portability.
  const encoded = absolute
    .split('/')
    .map(seg => encodeURIComponent(seg).replace(/%2F/g, '/'))
    .join('/')
  return 'file://' + encoded
}

// Symlinks this binary to a sandbox-safe location.
//
// ENH-141 — install path order is now PTY-PATH-aware:
//   1. ~/.claude/duo/bin/duo  (default; this dir is prepended to PATH
//                              inside every Duo PTY by PtyManager, so
//                              the binary is immediately reachable by
//                              name without touching the user's shell
//                              rc. Critical for Claude Code sandboxes
//                              where modifying ~/.zshrc is blocked.)
//   2. ~/.local/bin/duo       (common community alt; needs ~/.local/bin
//                              on PATH — typically wired by the
//                              FirstLaunchBanner's install action which
//                              auto-appends a fenced block to ~/.zshrc.)
//   3. /usr/local/bin/duo     (only with --system; needs sudo + outside
//                              the sandbox; not recommended.)
//
// The previous tier-1 target `~/.claude/bin/duo` was retired in
// ENH-141: that dir was sandbox-writable but never on $PATH for Duo
// PTYs or external shells, so the symlink existed but `duo` was still
// "command not found." Reported by an enterprise user running
// Duo v0.6.13 inside a managed Claude Code install. See
// docs/DECISIONS.md → *Sandbox-tolerant transport and install paths*.
function runInstall(opts: { system?: boolean } = {}): void {
  // process.argv[1] is the script that was invoked (cli/duo), not the Node
  // binary at process.execPath. fs.realpathSync resolves any already-existing
  // symlinks so we always point at the real file.
  const self = fs.realpathSync(process.argv[1])
  const targets: string[] = []
  if (opts.system) {
    targets.push('/usr/local/bin/duo')
  } else {
    targets.push(path.join(os.homedir(), '.claude', 'duo', 'bin', 'duo'))
    targets.push(path.join(os.homedir(), '.local', 'bin', 'duo'))
  }

  for (const target of targets) {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      try { fs.unlinkSync(target) } catch { /* doesn't exist */ }
      fs.symlinkSync(self, target)
      out(`Installed: ${target} → ${self}`)
      const dir = path.dirname(target)
      // The SHIM_DIR target (~/.claude/duo/bin) is on PATH only inside
      // Duo PTYs (PtyManager prepends it at spawn time). For external
      // shells, surface the same shell-rc hint the secondary
      // ~/.local/bin path would. Users running `duo install` from
      // Terminal/iTerm need to either add the dir to their rc OR run
      // Duo's banner-driven [Install] which auto-wires ~/.local/bin.
      const userPath = (process.env.PATH ?? '').split(':')
      if (!userPath.includes(dir)) {
        out('')
        out('Inside Duo PTYs this dir is already on PATH (no action needed).')
        out('For external terminals (Terminal/iTerm), add to your shell rc:')
        out(`  export PATH="${dir}:$PATH"`)
      }
      return
    } catch {
      // Try next target (e.g. mkdir /usr/local/bin without sudo)
    }
  }
  if (opts.system) {
    die('Could not install duo. Try: sudo ln -sf ' + self + ' /usr/local/bin/duo')
  }
  die('Could not install duo. Try: ln -sf ' + self + ' ~/.claude/duo/bin/duo')
}

// Stage 20 — `duo doctor`. CLI-side health check that names the
// failure mode when one transport works and the other doesn't, so a
// sandboxed Claude Code session no longer fails silently. Reports:
//   - Unix socket reachable? TCP fallback reachable?
//   - Running app version (via `ping`) vs. CLI version
//   - $DUO_SESSION presence (Stage 19 — running inside a Duo PTY)
//   - Install path: which `duo` binaries exist on disk
//   - Skill / agent file presence under ~/.claude/
async function runDoctor(): Promise<void> {
  const lines: string[] = []
  const probe = async (factory: TransportFactory) => {
    return await sendOver(factory, 'ping', {}, 3_000)
  }

  let unixOk = false
  let unixErr: string | null = null
  let appVersion: string | null = null
  let windowCount: number | null = null
  if (fs.existsSync(SOCKET_PATH)) {
    try {
      const res = await probe(() => ({ socket: net.createConnection(SOCKET_PATH) }))
      unixOk = true
      appVersion = (res as { version?: string })?.version ?? null
      windowCount = (res as { windows?: number })?.windows ?? null
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      unixErr = e.code ?? e.message ?? String(err)
    }
  } else {
    unixErr = 'socket file missing'
  }

  let tcpOk = false
  let tcpErr: string | null = null
  const portInfo = readPortFile()
  if (portInfo) {
    try {
      const res = await probe(() => {
        const socket = net.createConnection({ host: '127.0.0.1', port: portInfo.port })
        return { socket, preamble: JSON.stringify({ token: portInfo.token }) + '\n' }
      })
      tcpOk = true
      if (!appVersion) appVersion = (res as { version?: string })?.version ?? null
      if (windowCount == null) windowCount = (res as { windows?: number })?.windows ?? null
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      tcpErr = e.code ?? e.message ?? String(err)
    }
  }

  lines.push(`duo CLI version: ${VERSION}`)
  if (appVersion) {
    const match = appVersion === VERSION ? ' (matches)' : ' (⚠ mismatch — relink the binary)'
    lines.push(`Duo app version: ${appVersion}${match}`)
  } else {
    lines.push('Duo app version: unknown — could not reach app via either transport')
  }
  // ENH-191 P5a (Tier-3 / NFR-4.4) — live window count from the ping response.
  if (windowCount != null) lines.push(`Windows: ${windowCount}`)
  lines.push('')

  lines.push('Transport')
  lines.push(`  ${unixOk ? '✓' : '✗'} Unix socket — ${SOCKET_PATH}${unixErr ? `  (${unixErr})` : ''}`)
  if (portInfo) {
    lines.push(`  ${tcpOk ? '✓' : '✗'} TCP fallback — 127.0.0.1:${portInfo.port}${tcpErr ? `  (${tcpErr})` : ''}`)
  } else {
    lines.push(`  ✗ TCP fallback — no port file at ${PORT_FILE}`)
  }
  if (!unixOk && tcpOk) {
    lines.push('')
    lines.push('  → Claude Code sandbox detected (Unix socket blocked) — using TCP fallback.')
    lines.push("  → To enable the faster Unix-socket path, add this to .claude/settings.local.json:")
    lines.push('      { "permissions": { "allow": ["allowUnixSockets"] } }')
  } else if (!unixOk && !tcpOk) {
    lines.push('')
    lines.push('  → Both transports failed. Is Duo.app running?')
  }
  lines.push('')

  lines.push('Sandbox')
  if (process.env.DUO_SESSION) {
    lines.push(`  ✓ $DUO_SESSION = ${process.env.DUO_SESSION}  (running inside a Duo PTY)`)
  } else {
    lines.push('  · $DUO_SESSION not set  (not in a Duo PTY — fine outside Duo)')
  }
  lines.push('')

  lines.push('Install')
  const cliPath = process.argv[1]
  let cliReal: string | null = null
  try { cliReal = fs.realpathSync(cliPath) } catch { /* */ }
  lines.push(`  CLI invoked as: ${cliPath}${cliReal && cliReal !== cliPath ? ` → ${cliReal}` : ''}`)
  const knownInstallTargets = [
    // ENH-141 — SHIM_DIR (auto-prepended to PTY $PATH; primary target).
    path.join(os.homedir(), '.claude', 'duo', 'bin', 'duo'),
    // Pre-ENH-141 sandbox-writable target (still listed for diagnosing
    // stale installs — the dir was never on PATH so the symlink was
    // effectively dead).
    path.join(os.homedir(), '.claude', 'bin', 'duo'),
    path.join(os.homedir(), '.local', 'bin', 'duo'),
    '/usr/local/bin/duo'
  ]
  for (const t of knownInstallTargets) {
    if (!fs.existsSync(t)) continue
    let real: string | null = null
    try { real = fs.realpathSync(t) } catch { /* */ }
    const matches = real && cliReal && real === cliReal
    lines.push(`  ${matches ? '✓' : '·'} ${t}${real && real !== t ? ` → ${real}` : ''}`)
  }
  lines.push('')

  lines.push('Skill')
  const skillFile = path.join(os.homedir(), '.claude', 'skills', 'duo', 'SKILL.md')
  const agentFile = path.join(os.homedir(), '.claude', 'agents', 'duo.md')
  lines.push(`  ${fs.existsSync(skillFile) ? '✓' : '✗'} ${skillFile}`)
  lines.push(`  ${fs.existsSync(agentFile) ? '✓' : '✗'} ${agentFile}`)
  lines.push('')

  // ENH-032 — terminal locale check. Multi-byte UTF-8 paste into the
  // terminal renders as raw bytes when LC_ALL/LC_CTYPE/LANG aren't
  // UTF-8. Most common cause: conda's `(base)` activator setting
  // LC_ALL=C. Diagnostic-only (we can't fix the user's shell rc); the
  // warning emits the fix inline so users have everything they need.
  lines.push('Locale')
  const localeVars = ['LC_ALL', 'LC_CTYPE', 'LANG'] as const
  const looksUtf8 = (v: string | undefined): boolean => {
    if (!v) return false
    return /utf-?8/i.test(v)
  }
  let utf8Found = false
  for (const v of localeVars) {
    const value = process.env[v]
    if (!value) {
      lines.push(`  · $${v} not set`)
      continue
    }
    if (looksUtf8(value)) {
      lines.push(`  ✓ $${v} = ${value}`)
      utf8Found = true
    } else {
      lines.push(`  ⚠ $${v} = ${value}  (not UTF-8 — multi-byte paste will render as raw bytes)`)
    }
  }
  if (!utf8Found) {
    lines.push('')
    lines.push('  → Pasting characters like em-dash, emoji, or accented letters')
    lines.push('    into this terminal will produce garbled output.')
    lines.push('    Fix: add to your ~/.zshrc (after any conda init block):')
    lines.push('      export LANG=en_US.UTF-8')
    lines.push('      export LC_ALL=en_US.UTF-8')
    lines.push('    Then open a fresh terminal.')
  }

  process.stdout.write(lines.join('\n') + '\n')
  // Exit non-zero only when neither transport works; surface to scripts.
  process.exit(unixOk || tcpOk ? 0 : 1)
}

// BUG-145 — focused help for the `doc` verb cluster. The global
// printHelp() lists every verb (~200 lines); on first encounter an
// agent had to page that to find `doc comment` ergonomics. This
// returns just the doc-subcommand section (or one specific subcommand
// when `sub` is set).
function printDocHelp(sub?: string): void {
  const sections: Record<string, string> = {
    read: `duo doc read [<file>]
  Read the markdown editor's current buffer (no <file> = active editor;
  <file> = match by path against any open editor tab).
  Output is the full file body including CriticMarkup tokens.`,
    write: `duo doc write [--text "X" | --replace-all] [--text "X"]
  Replace the editor's current selection (default) or its full body
  (--replace-all). Without --text the body is read from stdin.`,
    goto: `duo doc goto [<file>] (--heading "X" | --line N | --anchor "X")
  Scroll + place caret at the target. Buffer-staleness defense reads
  disk first when the editor's clean.`,
    find: `duo doc find [<file>] --query "X" [--case-sensitive]
  Count + locate matches in the editor's serialized body.`,
    edit: `duo doc edit <file> --find "X" --replace "Y" [--occurrence N | --all] [--at-line N]
  ENH-195 — surgical PLAIN-text markdown replace (literal, NOT CriticMarkup —
  a direct accepted edit). Echo-safe when the file is open in the editor;
  disk-direct when closed. --replace may be empty (= delete the match).
  Ambiguous multi-match without --occurrence / --all is refused. Use the
  CriticMarkup verbs (insert/delete/substitute) instead when you want the
  change to land as a tracked suggestion.`,
    insert: `duo doc insert <file> --text "X" (--after "Y" | --before "Y" | --at-line N) [--occurrence N]
  Wrap NEW text as a CriticMarkup insertion ({++X++}) at the chosen anchor.`,
    delete: `duo doc delete <file> --text "X" [--occurrence N]
  Wrap existing text as a CriticMarkup deletion ({--X--}).`,
    substitute: `duo doc substitute <file> --text "X" --with "Y" [--occurrence N]
  Wrap "X→Y" as a substitution ({~~X~>Y~~}). --with may be empty (= delete).`,
    highlight: `duo doc highlight <file> --text "X" [--occurrence N]
  Wrap "X" as a highlight ({==X==}). Refuses if target overlaps an existing
  CriticMarkup token.`,
    comment: `duo doc comment <file> --anchor "X" --body "B"           # add NEW comment
duo doc comment <file> --reply-to <c-id> --body "B"      # REPLY (BUG-143)
  Author = $DUO_AUTHOR ?? 'agent'. For replies, omit --anchor — the server
  appends '↪ @author ts: B' inside the parent token's body. The editor's
  chokidar watcher then refreshes the live buffer automatically.`,
    accept: `duo doc accept <file> (--id <c-id> | --match "X") [--occurrence N]
  Accept a CM op: insertion = keep text; deletion = drop text;
  substitution = keep new; comment = keep anchor.`,
    reject: `duo doc reject <file> (--id <c-id> | --match "X") [--occurrence N]
  Reject a CM op: insertion = drop; deletion = keep; substitution = keep
  old; comment = drop anchor wrapper (body untouched).`,
    'conflict-log': `duo doc conflict-log
  BUG-122 — print the latest save-conflict diagnostic
  (~/.claude/duo/logs/last-conflict.log).`
  }
  const lines: string[] = []
  if (sub && sections[sub]) {
    lines.push(sections[sub])
  } else {
    lines.push('duo doc <subcmd> — markdown editor doc operations.')
    lines.push('Track-changes / suggestions: use insert / delete / substitute /')
    lines.push('highlight (CriticMarkup) — never write literal <ins>/<del> HTML.')
    lines.push('')
    lines.push('Subcommands:')
    for (const key of Object.keys(sections)) {
      const firstLine = sections[key].split('\n')[0]
      lines.push('  ' + firstLine.replace(/^duo /, ''))
    }
    lines.push('')
    lines.push('Use `duo doc <subcmd> --help` for the focused help on one subcommand.')
  }
  process.stdout.write(lines.join('\n') + '\n')
}

// Render the COMMANDS block of the global help from the VERBS inventory.
// Groups are emitted in GROUP_ORDER; within each group, verbs keep their
// array order. Each row is "<name> <args>" left-padded to a fixed gutter,
// with the summary wrapped + hanging-indented to the same gutter. Verbs
// flagged `aliasOf` are skipped here (their canonical form is rendered).
function renderCommandsBlock(): string {
  const GROUP_ORDER = [
    'Browser & tabs',
    'Read & inspect',
    'Interact',
    'Diagnostics',
    'Files & navigator',
    'Markdown editor (doc)',
    'HTML canvas',
    'Working pane & layout',
    'Terminal',
    'Workspace & projects',
    'Repo & git',
    // ENH-208 vault / graph / base verbs (extended by ENH-216 OKF mode).
    // Long absent from --help: GROUP_ORDER omitted 'Vault', so printHelp
    // silently skipped the whole family despite their VERBS entries.
    'Vault',
    'Health & install'
  ]
  const GUTTER = 34 // column where summaries begin
  const WIDTH = 78 // soft wrap target for the summary column
  const wrap = (text: string, width: number): string[] => {
    const words = text.split(/\s+/).filter(Boolean)
    const lines: string[] = []
    let line = ''
    for (const w of words) {
      if (line && line.length + 1 + w.length > width) {
        lines.push(line)
        line = w
      } else {
        line = line ? `${line} ${w}` : w
      }
    }
    if (line) lines.push(line)
    return lines.length ? lines : ['']
  }
  const visible = VERBS.filter(v => !v.aliasOf)
  const byGroup = new Map<string, VerbSpec[]>()
  for (const v of visible) {
    const arr = byGroup.get(v.group) ?? []
    arr.push(v)
    byGroup.set(v.group, arr)
  }
  const out: string[] = []
  for (const group of GROUP_ORDER) {
    const verbs = byGroup.get(group)
    if (!verbs || verbs.length === 0) continue
    out.push(`${group}`)
    for (const v of verbs) {
      const head = v.args ? `${v.name} ${v.args}` : v.name
      const summaryLines = wrap(v.summary, WIDTH - GUTTER)
      // First line: head + (padding to gutter) + first summary line. If the
      // head overflows the gutter, the summary drops to the next line.
      if (head.length + 2 <= GUTTER) {
        out.push(`  ${head.padEnd(GUTTER - 2)}${summaryLines[0]}`)
      } else {
        out.push(`  ${head}`)
        out.push(`${' '.repeat(GUTTER)}${summaryLines[0]}`)
      }
      for (const extra of summaryLines.slice(1)) {
        out.push(`${' '.repeat(GUTTER)}${extra}`)
      }
    }
    out.push('')
  }
  // Drop the trailing blank line.
  while (out.length && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}

function printHelp(): void {
  console.log(`
duo ${VERSION} — CLI bridge to the Duo desktop app

USAGE
  duo <command> [options]

COMMANDS
${renderCommandsBlock()}

FLAGS
  --version, -v    Print version
  --help, -h       Print this help

EXIT CODES
  0   Success
  1   Error (human-readable message on stderr)
`.trim())
}

main().catch((err) => {
  process.stderr.write(`duo: unhandled error: ${err}\n`)
  process.exit(1)
})
