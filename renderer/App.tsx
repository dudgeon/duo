import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { buildWikilinkCreatePath } from './wikilinkCreate'
import { TabBar } from './components/TabBar'
import { TerminalPane } from './components/TerminalPane'
import { WorkingPane } from './components/WorkingPane'
import { TabSearchPalette, type TabSearchEntry } from './components/TabSearchPalette'
import { VaultQuickSwitcher } from './components/VaultQuickSwitcher'
import { useVaultIndex } from './components/editor/vaultIndex'
import { ErrorBoundary } from './components/ErrorBoundary'
import { FirstLaunchBanner } from './components/FirstLaunchBanner'
import { UpdateAvailableBanner } from './components/UpdateAvailableBanner'
import { ExternalRedirectedBanner } from './components/ExternalRedirectedBanner'
import { CloneModal } from './components/CloneModal'
import { LinkPromptModal } from './components/editor/LinkPromptModal'
import { WorkspaceSwitcherDropdown } from './components/WorkspaceSwitcherDropdown'
import type { FileTab, ActiveWorking } from './components/WorkingPane'
import { classifyFile } from './components/fileClassifier'
import { FilesPane, type FilesPaneHandle } from './components/FilesPane'
import { CollapsedPaneRail } from './components/CollapsedPaneRail'
import { DUO_FS_PATH_MIME } from './components/dragPathPayload'
import { ProjectRail, type ProjectCounts } from './components/ProjectRail'
import { useWorkspacePillMenuFlag, setWorkspacePillMenuFlag } from './hooks/useWorkspacePillMenuFlag'
import { ThemeToggle } from './components/ThemeToggle'
import { ClaudePresenceDot } from './components/ClaudePresenceDot'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useNavigator, computePendingCwd } from './hooks/useNavigator'
import { useUserClaudeNavigator } from './hooks/useUserClaudeNavigator'
import { useFrontTerminalClaudeLive } from './hooks/useClaudePresence'
import { useSendPillFlags } from './hooks/useSendPillFlags'
import { useProjects } from './hooks/useProjects'
import { useBrowserMode } from './hooks/useBrowserMode'
import { useNavPins } from './hooks/useNavPins'
import { useTheme } from './hooks/useTheme'
import { useAuthor } from './hooks/useAuthor'
import { useSelectionFormat } from './hooks/useSelectionFormat'
import { htmlBoilerplate } from './components/Page/htmlBoilerplate'
import { encodeUtf8 } from './components/editor/markdown-io'
import { findVaultRoot, resolveWikilinkInVault } from './components/editor/wikilinkResolver'
import type { TabSession, DirEntry, TerminalTabKind, NewTabResult, PinEntry, SessionState, BrowserTab, ActiveWorkspace } from '@shared/types'
import { reorderVisible } from '@shared/reorderTabs'
import { pruneByTab } from './state/perTabPrune'
import {
  effectiveProjectTerminals,
  mergeLiveCwdInfo,
  planProjectClose,
  shouldReleaseFocus,
  type LiveCwdEntry
} from '@shared/project-lifecycle'

// Stage 10 § D32: auto-collapse the Files column on windows narrower than
// this. The user can manually re-expand; we don't re-collapse again unless
// the threshold is re-crossed (hysteresis prevents jitter).
const AUTO_COLLAPSE_WIDTH = 1100
// BUG-191 — how often to re-probe each terminal's live shell cwd so the
// project rail tracks where the shell IS, not where it launched. Coarse
// (lsof is not free) but well under "feels stuck"; gated on tab visibility.
const LIVE_CWD_POLL_MS = 5000

// Stage 9: cozy-mode persistence keys. Per-tab map survives within a
// session but tab UUIDs don't span relaunches; the last-choice flag is the
// durable piece (new tabs inherit it per PRD § C4).
//
// ENH-191 P4 (seam 3b) — the byTab maps move to a PER-WINDOW key
// (`…v2.w<id>.byTab`) so a second window's prune can't clobber the first
// window's entries (C13). The id is THIS renderer's window id (preload-
// injected as window.electron.env.windowId == the main-process registry id).
// The old shared v1 keys are left in place but UNREAD/UNWRITTEN so a Cut-3
// revert reads them untouched (PRD §7.5). No v1→v2 seed is needed: tab UUIDs
// don't span relaunches, so any v1 byTab entries are already stale (they'd be
// pruned on first tab-sync) — switching keys is byte-identical to today's
// post-relaunch behavior (empty map → the shared lastChoice default). The
// lastChoice default stays GLOBAL (its own v1 key, NOT per-window): new tabs
// in ANY window inherit the same last-used value.
const DUO_WINDOW_ID: number = (() => {
  const id = typeof window !== 'undefined' ? window.electron?.env?.windowId : undefined
  return typeof id === 'number' && id > 0 ? id : 1
})()
const COZY_BY_TAB_KEY = `duo.cozy.v2.w${DUO_WINDOW_ID}.byTab`
const COZY_LAST_KEY = 'duo.cozy.v1.lastChoice'

// Per-tab terminal font-size bump (⌘+/-/0). Signed integer, added on top
// of the cozy/default base fontSize in TerminalPane. Same new-tab-inherits
// pattern as cozy so new tabs pick up the last-used bump.
const FONT_BUMP_BY_TAB_KEY = `duo.fontBump.v2.w${DUO_WINDOW_ID}.byTab`
const FONT_BUMP_LAST_KEY = 'duo.fontBump.v1.lastChoice'
const FONT_BUMP_MIN = -4
const FONT_BUMP_MAX = 10

// Stage 19c D28 — persisted last manual choice between shell and claude.
// The split-button `+` always opens claude regardless (the primary
// affordance is opinionated). This persisted value only governs `duo
// new-tab` calls that arrive without a --kind flag, so an agent popping
// tabs follows the user's most recent manual selection.
const LAST_TAB_KIND_KEY = 'duo.lastNewTabKind'

function loadLastTabKind(): TerminalTabKind {
  try {
    const v = localStorage.getItem(LAST_TAB_KIND_KEY)
    return v === 'shell' || v === 'claude' ? v : 'claude'
  } catch { return 'claude' }
}

function saveLastTabKind(kind: TerminalTabKind): void {
  try { localStorage.setItem(LAST_TAB_KIND_KEY, kind) } catch { /* quota */ }
}

// Stage 19c D23 — banner the user sees on a `+ claude` click when
// `claude` isn't on PATH. Single shell line; clears on the next prompt.
// The URL is the canonical install doc — short enough not to wrap on
// narrow terminals.
const CLAUDE_MISSING_BANNER =
  'echo "Install Claude Code to enable agent tabs: https://docs.claude.com/claude-code"\n'

// BUG-009 fix — wait for the shell's PS1 to be emitted before writing
// the post-spawn payload. Without this, the write races the shell's
// startup: the bytes can land before the shell has read its rc files,
// causing the literal payload to render as raw text outside the prompt
// and the trailing newline to no-op against an empty prompt.
//
// BUG-010 fix — the original "first PTY data" trigger was too eager:
// shells emit terminal-init escape codes (OSC 133 prompt-marks,
// alt-screen toggles, cursor-position queries) and rc-file output
// (conda/nvm init lines, MOTDs) BEFORE the visible PS1 lands, so the
// post-spawn write would still interleave with shell startup chatter.
// We now accumulate the data stream, strip ANSI/CSI/OSC escapes from
// the visible tail, and only resolve once the tail looks like a
// rendered prompt (`$ `, `% `, `# `, `❯ `, `> `, …). Both the 30ms
// paint settle and the 1s hard fallback are preserved — exotic
// custom prompts that don't match any of the recognized tails will
// still get the write after the timeout, which is no worse than the
// pre-BUG-009 behavior.
const PROMPT_TAIL_REGEX = /[$%#❯>›→]\s*$/
const ANSI_STRIP_REGEX = /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\)|[@-Z\\-_])/g

function stripAnsi(s: string): string {
  // Remove CSI / OSC / single-char ESC sequences, plus carriage
  // returns and NULs that don't render as visible characters.
  return s.replace(ANSI_STRIP_REGEX, '').replace(/[\r\x00]/g, '')
}

function waitForPtyReady(id: string, timeoutMs: number = 1000): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    let buffer = ''
    const finish = () => {
      if (done) return
      done = true
      off()
      setTimeout(resolve, 30)
    }
    const off = window.electron.pty.onData(id, (chunk: string) => {
      if (done) return
      buffer += chunk
      // Bound the regex by checking only the recent visible tail —
      // an rc that prints a kilobyte of MOTD shouldn't slow us down.
      const tail = stripAnsi(buffer).slice(-160)
      if (PROMPT_TAIL_REGEX.test(tail)) finish()
    })
    setTimeout(() => {
      if (done) return
      done = true
      off()
      resolve()
    }, timeoutMs)
  })
}

function loadCozyByTab(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COZY_BY_TAB_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch { return {} }
}

function loadCozyLast(): boolean {
  try { return localStorage.getItem(COZY_LAST_KEY) === '1' } catch { return false }
}

function loadFontBumpByTab(): Record<string, number> {
  try {
    const raw = localStorage.getItem(FONT_BUMP_BY_TAB_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch { return {} }
}

function loadFontBumpLast(): number {
  try {
    const n = parseInt(localStorage.getItem(FONT_BUMP_LAST_KEY) || '0', 10)
    if (isNaN(n)) return 0
    return Math.max(FONT_BUMP_MIN, Math.min(FONT_BUMP_MAX, n))
  } catch { return 0 }
}

type FocusedColumn = 'files' | 'terminal' | 'working'

// Stage 19c D26 — title format. Claude tabs prefix `claude · ` so a
// mixed strip of shell + claude tabs reads at a glance. Shell tabs use
// today's title (xterm OSC sequences eventually overwrite both).
function tabTitle(kind: TerminalTabKind, cwd: string, home: string): string {
  const basename = cwd === home || cwd === '~'
    ? '~'
    : (cwd.slice(cwd.lastIndexOf('/') + 1) || cwd)
  return kind === 'claude' ? `claude · ${basename}` : (basename || 'Terminal')
}

/**
 * ENH-179 — recently-closed-tab entry shape. ⌘Z (when not in a
 * text-input surface) pops the most-recent entry off App.tsx's
 * `closedTabsRef` ring and restores via the same open-path used by
 * other entry vectors (openFileSmart / browser.addTab / makeTab).
 */
type ClosedTabEntry =
  | { kind: 'file'; path: string; closedAt: number }
  | { kind: 'browser'; url: string; closedAt: number }
  | { kind: 'terminal'; cwd: string; ptyKind: TerminalTabKind; closedAt: number }

function makeTab(cwd: string, kind: TerminalTabKind, home: string, lastClaudeSession?: TabSession['lastClaudeSession']): TabSession {
  return {
    id: crypto.randomUUID(),
    title: tabTitle(kind, cwd, home),
    cwd,
    kind,
    ...(lastClaudeSession ? { lastClaudeSession } : {})
  }
}

/**
 * A terminal's persisted launch cwd may have been deleted between
 * sessions. Restoring it verbatim spawns a PTY in a dead directory
 * (ENOENT) and surfaces a project-rail tile for a folder that no longer
 * exists. Mirror the BUG-039 file-tab pattern: fall the cwd back to the
 * nearest surviving ancestor (or `home` if none qualifies). On a probe
 * error we restore verbatim rather than guess.
 */
async function resolveRestorableCwd(cwd: string, home: string): Promise<string> {
  try {
    if (await window.electron.files.dirExists(cwd)) return cwd
  } catch {
    return cwd
  }
  let cur = cwd
  while (true) {
    const idx = cur.lastIndexOf('/')
    const parent = idx > 0 ? cur.slice(0, idx) : '/'
    if (parent === cur) break
    try {
      if (await window.electron.files.dirExists(parent)) return parent
    } catch {
      break
    }
    cur = parent
  }
  return home
}

/**
 * ENH-096 (B1) — Walk up from `startPath` (a file path) until an
 * `.obsidian/` directory is found at the same level. Returns the
 * directory containing `.obsidian/` (the vault root) or `null` if
 * none is found before reaching `/`. If `startPath` is null,
 * returns null without doing any IO.
 *
 * Cap the walk at a reasonable depth so a non-vault tree doesn't
 * pay arbitrary IO cost on every cmd+click. 16 levels covers any
 * practical vault depth.
 */
/**
 * ENH-098 (Sprint 9 walk-2) — find the VISIBLE editor's
 * contenteditable scoped to the requested working-pane subtree.
 *
 * Why this is non-trivial: BUG-046 keeps every file-tab renderer
 * mounted simultaneously (display-toggled) for instant cycling.
 * So `[data-duo-workingpane]` matches N elements in DOM at any
 * time, only one of which is visible (its ancestor's display !==
 * 'none'). And when split view is open, the aux pane mounts its
 * own editor too, also marked [data-duo-workingpane]. A naive
 * querySelector picks the FIRST in DOM order, which is rarely
 * the right target.
 *
 * Algorithm: walk every [data-duo-workingpane], filter by
 * `offsetParent !== null` (excludes display:none AND visibility
 * variants without false positives), then partition by whether
 * the element sits inside [data-duo-workingpane-aux]. Return the
 * first element matching the requested scope.
 *
 * Returns the editor's contenteditable when present (the actual
 * caret target), falling back to the wrapper element when no
 * contenteditable is rendered (image/PDF preview tabs are
 * non-editable).
 */
function findVisibleWorkingPaneCE(scope: 'main' | 'aux'): HTMLElement | null {
  const all = Array.from(
    document.querySelectorAll<HTMLElement>('[data-duo-workingpane]')
  )
  const visible = all.filter(el => el.offsetParent !== null)
  const target = visible.find(el => {
    const inAux = el.closest('[data-duo-workingpane-aux]') !== null
    return scope === 'aux' ? inAux : !inAux
  })
  if (!target) return null
  const ce = target.querySelector<HTMLElement>('[contenteditable="true"]')
  return ce ?? target
}

// Sprint 11 — `findVaultRoot` + `resolveWikilinkInVault` extracted to
// `./components/editor/wikilinkResolver.ts` so the wikilink autocomplete
// (ENH-096 B.2), `@` mention (ENH-105), and `⌘O` quick switcher (B.4)
// share the same vault-detection + name-first BFS walk logic. The
// extracted module also exports `walkVaultFiles` for the autocomplete
// UI's bulk-list use-case (the resolver bails on first match; the
// walker collects everything for fuzzy ranking).

export function App() {
  const home = window.electron.env.HOME || '~'
  const nav = useNavigator(home)
  // Stage 22 — separate navigator state for the top "Your Claude
  // settings" pane (rooted at ~/.claude/). Lives at App level so its
  // expanded set + show-all toggle persist across re-mounts.
  const userClaudeNav = useUserClaudeNavigator(home)
  // Stage 26 PR 2 (ENH-010) — navigator pin state, persisted at
  // ~/.claude/duo/nav-pins.json. Hook loads on mount; PinnedNav
  // renders the section when pins.length > 0.
  const navPins = useNavPins()
  const pendingCwd = computePendingCwd(nav.state)
  const theme = useTheme()
  // Stage 15 G19 — sets up the localStorage round-trip for `duo
  // selection-format`. The hook's return value isn't consumed yet
  // (the editor pill that uses it lands in 15.1's UI half); calling
  // it here is what bootstraps the renderer→main pushState so CLI
  // reads return the persisted value rather than the default.
  useSelectionFormat()
  // BUG-138 Phase 2 — bootstrap the author identity hook so the main
  // process always has a fresh AUTHOR snapshot for `duo author` reads.
  // Editor components reach the same identity via useAuthor on demand.
  useAuthor()

  // Stage 19c — first tab on app launch defaults to a vanilla shell, not
  // claude. Rationale: today the user lands in the same place they always
  // have; the new opinionated default surfaces via the split-button `+`
  // (and ⌘T from terminal focus) — affordances they will discover. A
  // disruptive change to the boot tab would be a worse first impression
  // than what 19c is trying to fix. The PRD's "PM hits ⌘T and is talking
  // to a primed Claude in three seconds" criterion measures the
  // user-initiated path, not boot.
  const [tabs, setTabs] = useState<TabSession[]>(() => [makeTab(home, 'shell', home)])
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id)
  const [lastTabKind, setLastTabKind] = useState<TerminalTabKind>(loadLastTabKind)

  const [splitPct, setSplitPct] = useState(55)
  // ENH-040 — prevSplitPct caches the last "real" split (clamped
  // 20–80) so collapse → restore returns the user to where they were
  // mid-conversation, not to the 55% default. Updated whenever
  // setSplitPct lands a non-collapsed value (via drag, View → Pane
  // size menu, `duo split <n>`, or restore here).
  const [prevSplitPct, setPrevSplitPct] = useState(55)
  const splitContainerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  // BUG-031 — re-render trigger for the drag overlay. The overlay
  // covers iframes (canvas) during drag so mousemove keeps reaching
  // the parent document. Ref alone is invisible to React; pair it
  // with state.
  const [isDraggingSplit, setIsDraggingSplit] = useState(false)

  const [filesCollapsed, setFilesCollapsed] = useState(false)
  // FOLLOWUP-025 — File → Clone… modal visibility. Opened by ⌘⇧K
  // (via useKeyboardShortcuts) AND by the native File menu entry's
  // IPC push (window.electron.nav.onOpenCloneModal). Closed by the
  // modal's own Cancel/Esc/Done; opens are idempotent.
  const [cloneModalOpen, setCloneModalOpen] = useState(false)
  // FOLLOWUP-025 v2 walk-rev3 — when the Clone modal opens, park the
  // browser-pane WCV off-screen so it doesn't paint over the modal.
  // WCVs are native OS overlays that beat the renderer's z-index
  // stacking; without this hack the modal renders partially occluded
  // (owner: "if I alt-tab away, and return, it is partially occluded
  // on the left by the canvas, which should be under it"). Restore
  // on close — BrowserRenderer's `duo-wcv-restore` listener re-runs
  // its DOM-rect measurement to put the WCV back in its proper place.
  useEffect(() => {
    if (cloneModalOpen) {
      window.dispatchEvent(new CustomEvent('duo-wcv-park'))
    } else {
      window.dispatchEvent(new CustomEvent('duo-wcv-restore'))
    }
  }, [cloneModalOpen])
  const lastAutoCollapseState = useRef(false)

  // BUG-048 v3 — focusedColumn is mirrored into a ref alongside the
  // React state. The ref is the AUTHORITATIVE source for the ⌘`
  // toggle direction; the React state drives UI highlights. Why a
  // ref: when ⌘` fires, the main process used to reclaim OS focus
  // BEFORE sending PANE_TOGGLE_FOCUS, which fired the xterm
  // helper-textarea's `focus` event in the renderer (xterm was the
  // previously-focused element). The xterm focus listener flipped
  // focusedColumn = 'terminal' as a side effect — so by the time
  // togglePaneFocus's `setFocusedColumn(prev => …)` read prev, it
  // had already been poisoned to 'terminal'. The toggle ran
  // 'terminal' → 'working' instead of the user's expected
  // 'working' → 'terminal'.
  //
  // Fix has two parts:
  //  (a) main no longer reclaims focus on ⌘` (see
  //      installAppMenu in electron/main.ts § BUG-048 v3 comment).
  //      Renderer requests reclaim AFTER it's decided direction.
  //  (b) The xterm focus listener uses `setFocusedColumnSilent`
  //      which updates state but NOT the ref. So even if the
  //      reclaim-induced focus event still fires (after the toggle),
  //      the ref keeps the deliberate value for the *next* ⌘`.
  const [focusedColumn, _internalSetFocusedColumn] = useState<FocusedColumn>('terminal')
  const focusedColumnRef = useRef<FocusedColumn>('terminal')
  const setFocusedColumn = useCallback((next: FocusedColumn) => {
    focusedColumnRef.current = next
    _internalSetFocusedColumn(next)
  }, [])
  const setFocusedColumnSilent = useCallback((next: FocusedColumn) => {
    // Updates state (UI highlight) but bypasses the ref. Used only
    // by the xterm helper-textarea focus listener — which fires for
    // programmatic .focus() reclaims, not just deliberate user
    // clicks. Refusing to clobber the ref here lets the ⌘` toggle
    // read the user's last deliberate column choice unaffected.
    _internalSetFocusedColumn(next)
  }, [])

  // BUG-101 (Sprint 13 v2 fix) — `fileTabsRef` mirrors the latest
  // committed `fileTabs` so openFile can read it synchronously
  // without waiting for a setFileTabs updater to commit. Pre-fix the
  // sprint-9 "scratchpad ref" pattern stashed activation inside the
  // setFileTabs updater and tried to flush it on the next line, but
  // the updater is deferred to commit time — by the time the flush
  // ran, the ref was still null. Now we resolve activation entirely
  // outside the updater (see openFile below).
  const fileTabsRef = useRef<FileTab[]>([])
  // Stage 26 PR 3 item 8 — handle for the FilesPane so the global
  // ⌘⇧G shortcut can flip its breadcrumb into the editable input.
  const filesPaneRef = useRef<FilesPaneHandle | null>(null)

  // Stage 10 Phase 5 — working-pane file tabs live in App-level state so
  // the navigator can push into them from FilesPane.onOpenFile.
  const [fileTabs, setFileTabs] = useState<FileTab[]>([])
  // BUG-101 (Sprint 13 v2 fix) — keep fileTabsRef in sync so openFile
  // can read the latest committed value synchronously without going
  // through a setFileTabs updater.
  fileTabsRef.current = fileTabs
  // Sprint 3 Phase 3c-iii foundation (v0.6.5 prep) — path-keyed dirty
  // tracking that bridges main fileTabs and the aux pane (whose
  // synthesized `aux:${path}` IDs aren't in fileTabs). Populated by
  // onTabDirtyChange below. Consumed by the upcoming dirty-replace
  // dialog logic in splitViewMoveTabByPath.
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(() => new Set())
  const [activeWorking, setActiveWorking] = useState<ActiveWorking>({ kind: 'browser' })

  // ENH-080 — `⌘⇧A` opens a fuzzy search palette over open tabs.
  // The palette is a renderer overlay; we set its `open` state from
  // the `duo-open-tab-search` window event fired by useKeyboardShortcuts.
  const [tabSearchOpen, setTabSearchOpen] = useState<boolean>(false)
  // Sprint 11 ENH-096 B.4 — ⌘O vault quick switcher overlay state.
  // Distinct from tabSearchOpen (⌘⇧A — open tabs). Sources its file
  // list from useVaultIndex below, keyed off the active file's path.
  const [vaultQuickSwitcherOpen, setVaultQuickSwitcherOpen] = useState<boolean>(false)

  // ENH-041 / Sprint 3 — Split View ("aux") state. Locked spec at
  // docs/prd/canvas-split-view-research.html. v1 is single-slot
  // (paths.length 0 or 1); state shape is multi-tab capable so
  // Option B (multi-tab aux) can ship by just turning the strip on.
  //
  // v1 scope: aux holds FILE TABS only (no browser tabs). Browser-
  // tabs-in-aux is queued for v2 — would require BrowserManager
  // coordination and a bigger plumbing pass than this phase covers.
  //
  // Phase 3a-i: state is tracked + IPC-driven + pushed to main, but
  // the WorkingPane.tsx layout split (visible UI) lands in 3a-ii.
  // The CLI verbs (`duo split-view *`) work end-to-end against this
  // state today; the user just doesn't see anything until 3a-ii.
  const [auxState, setAuxState] = useState<{
    /** v1: 0 or 1. v2 lifts the cap. */
    paths: string[]
    /** Index into `paths`. -1 when empty. */
    activeIndex: number
    /** Main pane width as fraction of total working area. 0.5 default. */
    splitPct: number
  } | null>(null)

  // Sprint 7 Phase 3c — browser-in-aux. Mutually exclusive with
  // auxState (a file in aux clears any browser pin and vice versa).
  // Tracked separately rather than threaded through auxState so the
  // existing file-aux consumers are unchanged. Carries the numeric
  // BrowserTab id (from BrowserManager); cached url/title fuels the
  // aux header without a per-render IPC round trip. Not persisted in
  // session-state.json for v1 — relaunch starts with a clean aux pane
  // when the previous session had a browser pinned (acceptable: the
  // browser tab itself is still in BrowserManager, just back in the
  // main strip).
  const [auxBrowserTab, setAuxBrowserTab] = useState<{
    id: number
    url: string
    title: string
    splitPct: number
  } | null>(null)

  // Stage 24 — pinned WorkingPane tabs. Owned at App level so the ⌘W
  // keyboard handler can gate close-of-pinned-tab behind a confirm
  // modal. Persisted via the pins service in main; loaded once on
  // mount, refreshed after each toggle.
  const [pins, setPins] = useState<PinEntry[]>([])
  useEffect(() => {
    let cancelled = false
    void window.electron.pins.list().then(list => {
      if (!cancelled) setPins(list)
    })
    return () => { cancelled = true }
  }, [])
  const togglePin = useCallback(async (entry: PinEntry) => {
    const next = await window.electron.pins.toggle(entry)
    setPins(next)
  }, [])

  // BUG-057 file-tab pin auto-open lives below, after sessionHydrated.
  // App-level pinned-close confirmation (used by the ⌘W keyboard path
  // when the active working tab is pinned). Strip-side close-button
  // path uses its own local state in WorkingTabStrip — both render
  // the same modal component.
  // pendingClosePinned (the in-renderer modal state) retired v0.6.3 in
  // favor of inline async dialog.confirm calls in the closeTab keymap
  // below. ENH-050 — system sheet composes correctly above WCV.

  // Stage 21c Phase 2 — session state restored across Duo relaunches
  // (issue #24). Hydrate `tabs` / `fileTabs` / `activeTabId` /
  // `activeWorking` from `~/.claude/duo/session-state.json` on mount;
  // debounce-save on every state change post-hydration. Browser tabs
  // are restored separately by main (BrowserManager.restoreFromSession
  // after did-finish-load) — we just observe the latest list here for
  // save purposes. Navigator path uses its own localStorage layer
  // (`useNavigator`) and is not routed through session-state.json.
  const [sessionHydrated, setSessionHydrated] = useState(false)
  const sessionLoadStartedRef = useRef(false)
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([])

  // ENH-179 (Sprint 20 / v0.7.7) — recently-closed-tabs LIFO ring for
  // ⌘Z reopen. Three kinds (file / browser / terminal); the chord
  // pops the most-recent entry regardless of kind. Bounded at 10
  // entries — long-tail "I closed something an hour ago" use cases
  // aren't what muscle memory expects from ⌘Z.
  const closedTabsRef = useRef<ClosedTabEntry[]>([])
  const CLOSED_TABS_MAX = 10
  // Snapshot the prior browserTabs list inside the onTabsChange diff
  // so we can detect which tab(s) were closed and push to the ring.
  const browserTabsRef = useRef<BrowserTab[]>([])
  // ENH-167 v1.2 — active session pointer for the in-app titlebar
  // badge. Loaded once on mount; pushed live on every Save / Open /
  // New so the badge tracks main's authoritative state.
  const [activeWorkspace, setActiveWorkspace] = useState<ActiveWorkspace | null>(null)
  useEffect(() => {
    void window.electron.workspaceFile.active().then(setActiveWorkspace)
    return window.electron.workspaceFile.onActiveChanged(setActiveWorkspace)
  }, [])

  // ENH-171 (Sprint 20) — workspace switcher dropdown. Triggered by
  // clicking the workspace-name badge in the titlebar.
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const workspaceBadgeRef = useRef<HTMLButtonElement | null>(null)


  // Subscribe to BrowserManager's tab broadcasts so `browserTabs`
  // tracks main's view of the browser tab list. Used by the save
  // effect below.
  useEffect(() => {
    return window.electron.browser.onTabsChange((tabs) => {
      // ENH-179 — diff prev vs new to detect a browser-tab close.
      // Any URL/title pairs present in `prev` but missing from `tabs`
      // (by stable `id`) are closed; push the most-recent one onto
      // the ring. (Usually exactly one per fire, but defensive in
      // case of batched closes.) about:blank tabs are skipped — a
      // blank tab isn't a useful restore target.
      const prev = browserTabsRef.current
      const currentIds = new Set(tabs.map(t => t.id))
      for (const old of prev) {
        if (!currentIds.has(old.id) && old.url && !old.url.startsWith('about:blank')) {
          const entry: ClosedTabEntry = {
            kind: 'browser',
            url: old.url,
            closedAt: Date.now()
          }
          const ring = closedTabsRef.current
          ring.push(entry)
          if (ring.length > CLOSED_TABS_MAX) ring.shift()
        }
      }
      browserTabsRef.current = tabs
      setBrowserTabs(tabs)
      // Sprint 7 Phase 3c — keep aux-browser-tab state consistent
      // with main's view of browser tabs. When the pinned browser
      // tab is closed externally (BrowserManager already clears its
      // auxTabId on close), drop the aux state so the aux pane
      // doesn't render a header for a tab that no longer exists.
      // Also refresh url/title from the broadcast so the header
      // tracks navigation inside the aux tab.
      setAuxBrowserTab(prev => {
        if (!prev) return prev
        const stillExists = tabs.find(t => t.id === prev.id)
        if (!stillExists) return null
        if (stillExists.url === prev.url && stillExists.title === prev.title) return prev
        return { ...prev, url: stillExists.url, title: stillExists.title }
      })
    })
  }, [])

  // One-shot session-state load on mount.
  useEffect(() => {
    if (sessionLoadStartedRef.current) return
    sessionLoadStartedRef.current = true

    void window.electron.sessionState.load().then(async state => {
      // Terminal tabs first — these drive most of the renderer's
      // initial state. Empty list (first launch) → keep the default
      // single shell tab the constructor seeded.
      if (state.terminals.length > 0) {
        const restored = await Promise.all(
          state.terminals.map(async t =>
            makeTab(await resolveRestorableCwd(t.cwd, home), t.kind, home, t.lastClaudeSession ?? null)
          )
        )
        setTabs(restored)
        const idx = state.activeTerminalIndex
        if (Number.isInteger(idx) && idx >= 0 && idx < restored.length) {
          setActiveTabId(restored[idx].id)
        } else {
          setActiveTabId(restored[0].id)
        }
      }

      // BUG-039 — gate file-tab hydration on `files.exists`. Tabs
      // whose paths were deleted between sessions get dropped here
      // (silently — the user's mental model is "I deleted that file";
      // re-opening Duo to a half-broken tab strip is worse than
      // silent prune). Logs a one-shot console diagnostic so
      // unexpected drops are diagnosable.
      const existenceChecks = await Promise.all(
        state.fileTabs.map(async f => ({ entry: f, exists: await window.electron.files.exists(f.path) }))
      )
      const dropped = existenceChecks.filter(c => !c.exists).map(c => c.entry.path)
      if (dropped.length > 0) {
        console.warn(`[session-restore] dropped ${dropped.length} file tab(s) (no longer on disk):`, dropped)
      }

      // File tabs — IDs are session-local; mint fresh, key off path.
      const restoredFileTabs: FileTab[] = existenceChecks
        .filter(c => c.exists)
        .map(c => ({
          id: crypto.randomUUID(),
          type: c.entry.type,
          path: c.entry.path,
          title: c.entry.path.split('/').pop() || c.entry.path,
          mime: c.entry.mime
        }))
      if (restoredFileTabs.length > 0) {
        setFileTabs(restoredFileTabs)
      }

      // Active working selection.
      if (state.activeWorking && state.activeWorking.kind === 'file') {
        const targetPath = state.activeWorking.path
        const matching = restoredFileTabs.find(t => t.path === targetPath)
        if (matching) {
          setActiveWorking({ kind: 'file', id: matching.id })
        }
        // BUG-039 — if the active-working file was dropped, fall
        // through to the default 'browser' state. Don't try to land
        // the user on a tab that's no longer there.
      }
      // 'browser' is the default initial state, no-op.

      // Sprint 3 Phase 3c — restore Split View aux state. Same
      // existence-check pattern as fileTabs (BUG-039 lineage): if the
      // persisted aux paths no longer exist on disk, drop them (split
      // closes silently) rather than rehydrating dangling refs.
      if (state.aux && state.aux.paths.length > 0) {
        const auxExists = await Promise.all(
          state.aux.paths.map(async p => ({ path: p, exists: await window.electron.files.exists(p) }))
        )
        const survivingPaths = auxExists.filter(c => c.exists).map(c => c.path)
        const droppedAux = auxExists.filter(c => !c.exists).map(c => c.path)
        if (droppedAux.length > 0) {
          console.warn(`[session-restore] dropped ${droppedAux.length} aux file(s) (no longer on disk):`, droppedAux)
        }
        if (survivingPaths.length > 0) {
          const desiredIndex = state.aux.activeIndex
          const activeIndex = desiredIndex >= 0 && desiredIndex < survivingPaths.length
            ? desiredIndex
            : 0
          setAuxState({
            paths: survivingPaths,
            activeIndex,
            splitPct: state.aux.splitPct
          })
        }
      }

      setSessionHydrated(true)
    }).catch(err => {
      console.warn('[session-state] load failed (using defaults):', err)
      setSessionHydrated(true)  // don't block the save loop on a load failure
    })
  }, [home])

  // BUG-057 — auto-open pinned file tabs that aren't in the
  // session-restored fileTabs list. Mirrors the main-side logic for
  // browser pins (in did-finish-load): pins.json is the authoritative
  // "I want these tabs to come back every time" list; without this
  // step, closing a pinned tab drops it from session-state.json and
  // the pin entry becomes a dangling reference. Owner: "pinned files
  // should stay pinned and NEVER be lost between sessions — that's
  // the whole point."
  //
  // Runs after sessionHydrated so we know the restore step has
  // settled. Adds any missing pinned file tabs to fileTabs WITHOUT
  // changing the active tab (session-restore's `activeWorking`
  // wins; pin-auto-opens are background tabs).
  const pinAutoOpenRanRef = useRef(false)
  useEffect(() => {
    if (!sessionHydrated) return
    // ENH-191 NFR-6.2 — a blank New-Window must NOT clone the pinned FILE tabs.
    // The boot/restored windows (env.blank false) reconcile pins as before;
    // env.blank is preload-injected via --duo-blank (main keys it on
    // createWindow({restore:false})).
    if (window.electron.env.blank) return
    if (pinAutoOpenRanRef.current) return
    pinAutoOpenRanRef.current = true
    const filePins = pins.filter(p => p.kind === 'file')
    if (filePins.length === 0) return
    setFileTabs(prev => {
      const existing = new Set(prev.map(t => t.path))
      const missing = filePins.filter(p => !existing.has(p.ref))
      if (missing.length === 0) return prev
      // Verify each missing path actually exists before opening — a
      // pinned file the user moved or deleted shouldn't crash the
      // tab UI. Fire-and-forget; result lands as a follow-up state
      // update.
      Promise.all(
        missing.map(async p => {
          const exists = await window.electron.files.exists(p.ref)
          return exists ? p : null
        })
      ).then(results => {
        const valid = results.filter((r): r is PinEntry & { kind: 'file' } => r !== null)
        if (valid.length === 0) return
        setFileTabs(current => {
          const stillMissing = valid.filter(p => !current.some(t => t.path === p.ref))
          if (stillMissing.length === 0) return current
          const newTabs = stillMissing.map(p => {
            const { type, mime } = classifyFile(p.ref)
            return {
              id: crypto.randomUUID(),
              type,
              path: p.ref,
              title: p.title || p.ref.slice(p.ref.lastIndexOf('/') + 1) || p.ref,
              mime
            }
          })
          return [...current, ...newTabs]
        })
      }).catch(err => {
        console.warn('[pins] auto-open file tabs failed:', err)
      })
      return prev
    })
    // Intentionally only depend on sessionHydrated — pins state may
    // change later (toggle), but auto-open is a one-shot boot-time
    // reconciliation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionHydrated])

  // Debounced save on every change post-hydration. The 500ms in
  // renderer + 250ms in main coalesces bursty edits into a single
  // disk write.
  const sessionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // ENH-167 — build the live SessionState snapshot. Shared by the
  // autosave debounce AND the on-demand snapshot-request handler that
  // backs File > Save Session. Closure re-created on every state
  // change so the snapshot reflects the latest state.
  const buildSessionSnapshot = (): SessionState => {
    const activeTerminalIndex = tabs.findIndex(t => t.id === activeTabId)
    const activeBrowserIndex = browserTabs.findIndex(b => b.isActive)
    const activeFileTab = activeWorking.kind === 'file'
      ? fileTabs.find(f => f.id === activeWorking.id)
      : undefined
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      appVersion: '0.4.1',
      terminals: tabs.map(t => ({
        cwd: t.cwd,
        kind: t.kind,
        title: t.title,
        // ENH-177 — passthrough; main's enrichBeforePersistHook overwrites
        // with the current detected session before disk write.
        lastClaudeSession: t.lastClaudeSession ?? null
      })),
      activeTerminalIndex: activeTerminalIndex >= 0 ? activeTerminalIndex : -1,
      browserTabs: browserTabs.map(b => ({ url: b.url, title: b.title })),
      activeBrowserIndex: activeBrowserIndex >= 0 ? activeBrowserIndex : -1,
      fileTabs: fileTabs.map(f => ({ path: f.path, type: f.type, mime: f.mime })),
      activeWorking: activeWorking.kind === 'browser'
        ? { kind: 'browser', index: activeBrowserIndex >= 0 ? activeBrowserIndex : 0 }
        : (activeFileTab ? { kind: 'file', path: activeFileTab.path } : null),
      navigatorPath: '',  // useNavigator owns this via localStorage (Stage 10 Phase 4)
      // Sprint 3 Phase 3c — Split View persistence. Mirrors the
      // additive aux field on SessionState. null when the split is
      // closed; populated with the local auxState shape otherwise.
      aux: auxState && auxState.paths.length > 0
        ? {
            paths: [...auxState.paths],
            activeIndex: auxState.activeIndex,
            splitPct: auxState.splitPct
          }
        : null
    }
  }
  useEffect(() => {
    if (!sessionHydrated) return
    if (sessionSaveTimerRef.current) clearTimeout(sessionSaveTimerRef.current)
    sessionSaveTimerRef.current = setTimeout(() => {
      void window.electron.sessionState.save(buildSessionSnapshot())
    }, 500)
    return () => {
      if (sessionSaveTimerRef.current) clearTimeout(sessionSaveTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionHydrated, tabs, activeTabId, fileTabs, activeWorking, browserTabs, auxState])

  // ENH-167 — answer main's snapshot-request from Save Session. Re-
  // subscribes on every state change so the closure over the build
  // closure always sees the latest values. Cheap; events are rare.
  useEffect(() => {
    if (!sessionHydrated) return
    const unsubscribe = window.electron.sessionState.onSnapshotRequest((reqId) => {
      window.electron.sessionState.snapshotReply({ reqId, state: buildSessionSnapshot() })
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionHydrated, tabs, activeTabId, fileTabs, activeWorking, browserTabs, auxState])

  // Stage 10 Phase 6 § D16 — dismissible chip when the agent drives the
  // navigator via `duo reveal`. Cleared after ~4s or by user dismiss.
  const [revealChip, setRevealChip] = useState<string | null>(null)

  // Stage 9 — per-tab cozy mode. `cozyByTab` is keyed by tab UUID;
  // `cozyDefault` seeds new tabs with the last-toggled value.
  const [cozyByTab, setCozyByTab] = useState<Record<string, boolean>>(loadCozyByTab)
  const [cozyDefault, setCozyDefault] = useState<boolean>(loadCozyLast)

  // Per-tab terminal font-size bump from ⌘+/-/0.
  const [fontBumpByTab, setFontBumpByTab] = useState<Record<string, number>>(loadFontBumpByTab)
  const [fontBumpDefault, setFontBumpDefault] = useState<number>(loadFontBumpLast)

  const activeTab = tabs.find(t => t.id === activeTabId)
  const activeCozy = activeTab ? (cozyByTab[activeTab.id] ?? cozyDefault) : false
  // ENH-013 — Send → Duo pill gates on whether the front terminal has
  // a live `claude` descendant in its PTY tree (or is in the post-spawn
  // grace window for a kind=='claude' tab). State pushed by main's
  // claude-presence probe.
  const claudeLive = useFrontTerminalClaudeLive()

  // ENH-176 — independent feature flags for the two Send-pill
  // variants. See `useSendPillFlags` for the locked owner spec:
  // agent default ON, terminal default OFF; when both could fire,
  // agent wins. Compute the (callback, label) tuple here so each
  // editor surface gets the right wiring via `onSendToDuo` +
  // `pillLabel`.
  const sendPillFlags = useSendPillFlags()

  // Workspace-pill click-to-open-menu feature flag. Default OFF
  // (2026-05-24) — ENH-171's dropdown gesture is disabled until the
  // affordance is reworked. Flip via DevTools:
  //   localStorage.setItem('duo.workspacePillMenu', 'true')
  //   window.dispatchEvent(new CustomEvent('duo:workspacePillMenuFlagChanged'))
  // or via CLI: `duo workspace-pill-menu on|off|toggle`.
  const workspacePillMenuEnabled = useWorkspacePillMenuFlag()
  // ENH-184 Phase 4 — push current flag value to main on every change
  // so `duo workspace-pill-menu` (read) returns the live state.
  useEffect(() => {
    window.electron.workspacePillMenu.pushState(workspacePillMenuEnabled)
  }, [workspacePillMenuEnabled])
  // ENH-184 Phase 4 — listen for CLI writes (main → renderer) and
  // apply via the existing setWorkspacePillMenuFlag helper, which
  // writes localStorage + fires the in-window event that the hook
  // already subscribes to.
  useEffect(() => {
    return window.electron.workspacePillMenu.onSet((enabled) => {
      setWorkspacePillMenuFlag(enabled)
    })
  }, [])

  // ENH-178 — three-mode browser URL filter. Hook mounts on App
  // boot; first effect pushes the persisted localStorage value to
  // main so BrowserManager.routeOffHostIfMatched is in lockstep
  // before any URL navigation happens. Default: 'local-only' for
  // new installs; existing values are preserved across launches.
  // Currently the cached value is referenced only by the address-bar
  // affordance + future Settings UI; main is the authority for
  // off-host routing decisions.
  useBrowserMode()

  // ENH-182 Phase 1 — derive the project list from open tabs +
  // terminals + nav listings + (eventually) persisted pins. The rail
  // mounts at the left edge of the main flex row below; clicking a
  // tile is a no-op in Phase 1 (read-only). Phase 2 wires
  // `focusedProject` + filter behavior. `pinnedFileTabPaths` excludes
  // pinned reference tabs from "working in" qualification (D2).
  const pinnedFileTabPaths = useMemo(
    () => new Set(pins.filter((p) => p.kind === 'file').map((p) => p.ref)),
    [pins]
  )
  // BUG-191 — live shell-cwd info per terminal (id → {alive, cwd}),
  // refreshed by the poll effect below. `deriveProjects` consumes this
  // via effectiveProjectTerminals so a shell that cd-d away or exited
  // stops keeping a ghost tile.
  const [liveCwdInfo, setLiveCwdInfo] = useState<Map<string, LiveCwdEntry>>(() => new Map())
  const projectTerminals = useMemo(
    () => effectiveProjectTerminals(tabs, liveCwdInfo),
    [tabs, liveCwdInfo]
  )
  const projectWorkingTabs = useMemo(
    () =>
      fileTabs
        .filter((t) => !!t.path && !t.isNew)
        .map((t) => ({ id: t.id, path: t.path })),
    [fileTabs]
  )
  // BUG-191 — poll each open terminal's real shell cwd (+ liveness) so
  // the rail follows where the shell IS, not where it launched. Batched +
  // async in main (lsof never blocks the main thread); merged only when
  // something actually changed (mergeLiveCwdInfo keeps the map reference
  // stable) so a steady poll doesn't re-derive the project set every tick.
  // Re-armed only when the SET of tab ids changes (not on title updates).
  const tabIdsKey = useMemo(() => tabs.map((t) => t.id).join(','), [tabs])
  useEffect(() => {
    const ids = tabIdsKey ? tabIdsKey.split(',') : []
    if (ids.length === 0) {
      setLiveCwdInfo((prev) => (prev.size === 0 ? prev : new Map()))
      return
    }
    let cancelled = false
    const poll = async () => {
      try {
        const info = await window.electron.pty.liveCwds(ids)
        if (!cancelled) setLiveCwdInfo((prev) => mergeLiveCwdInfo(prev, info, ids))
      } catch {
        /* transient lsof/IPC failure — keep prior info (launch-cwd fallback) */
      }
    }
    void poll()
    const handle = window.setInterval(() => {
      if (!document.hidden) void poll()
    }, LIVE_CWD_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(handle)
    }
  }, [tabIdsKey])
  // ENH-182 Phase 3a — persisted projects.json slice (pins + color
  // overrides). Loaded once on mount; subscribes to PROJECTS_CHANGED
  // pushes from main (toggle-pin, set-color-override, Phase 4 CLI
  // verbs all broadcast). Defaults to the empty slice until the
  // initial read resolves — Phase 0 derivation handles that cleanly
  // (no pins = behaviour identical to pre-Phase 3a).
  const [projectsFile, setProjectsFile] = useState<{ pins: string[] }>(
    () => ({ pins: [] })
  )
  useEffect(() => {
    let cancelled = false
    void window.electron.projects.read().then((file) => {
      if (cancelled) return
      setProjectsFile({ pins: file.pins })
    })
    const off = window.electron.projects.onChange((file) => {
      setProjectsFile({ pins: file.pins })
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])
  const pinnedProjectsSet = useMemo(
    () => new Set(projectsFile.pins),
    [projectsFile.pins]
  )
  const {
    projects: railProjects,
    terminalMembership,
    tabMembership
  } = useProjects({
    terminals: projectTerminals,
    workingTabs: projectWorkingTabs,
    pinnedTabPaths: pinnedFileTabPaths,
    pinnedProjects: pinnedProjectsSet
  })
  // ENH-182 Phase 2 — focus filter. `null` = All (no filter). Clicking
  // a tile sets this; clicking the active tile (or All) clears it.
  // Visibility-only: hidden tabs stay in state, just skip render.
  const [focusedProject, setFocusedProject] = useState<string | null>(null)
  const handleProjectFocus = useCallback(
    (root: string | null) => {
      // Click the active tile to release focus (D8: "click the active
      // tile (or All) to release"). Clicking All when already on All
      // is a no-op.
      setFocusedProject((prev) => (prev === root ? null : root))
    },
    []
  )
  // ENH-182 Phase 3 D12 — counts map per project root for the tile
  // right-click menu labels. Aggregates membership outputs from
  // useProjects + tab.kind for the live-process confirm. Recomputes
  // whenever membership or tab kinds change; cheap enough to be a
  // useMemo. `hasClaudeKindTerminal` is a coarse proxy for "may have
  // live work" — see ProjectRail.tsx comment on ProjectCounts.
  const projectCounts = useMemo(() => {
    const map = new Map<string, ProjectCounts>()
    const ensure = (root: string): ProjectCounts => {
      const existing = map.get(root)
      if (existing) return existing
      const fresh: ProjectCounts = {
        terminals: 0,
        workingTabs: 0,
        hasClaudeKindTerminal: false
      }
      map.set(root, fresh)
      return fresh
    }
    for (const t of tabs) {
      const root = terminalMembership[t.id]
      if (!root) continue
      const c = ensure(root)
      c.terminals += 1
      if (t.kind === 'claude') c.hasClaudeKindTerminal = true
    }
    for (const ft of fileTabs) {
      const root = tabMembership[ft.id]
      if (!root) continue
      ensure(root).workingTabs += 1
    }
    return map
  }, [tabs, fileTabs, terminalMembership, tabMembership])
  // ENH-182 Phase 3 D12 — Pin/Unpin handler. IPC call broadcasts
  // PROJECTS_CHANGED which the renderer's effect picks up to update
  // projectsFile + re-derive railProjects.
  const handleTogglePin = useCallback((root: string) => {
    void window.electron.projects.togglePin(root)
  }, [])
  // ENH-182 Phase 4 — push the rendered rail snapshot to main on
  // every change. Main caches it for `duo project list` + name→root
  // resolution. Tiny IPC payload (rail-sized arrays + counts map),
  // safe to send on every relevant state change.
  useEffect(() => {
    window.electron.projects.pushState({
      projects: railProjects,
      focusedProject,
      counts: Object.fromEntries(projectCounts)
    })
  }, [railProjects, focusedProject, projectCounts])
  // ENH-182 Phase 4 — CLI `duo project focus` push. Routes through
  // the same setFocusedProject the rail uses; downstream effects
  // (navigator re-root, visibility filters, auto-spawn, focus chip)
  // fire identically.
  useEffect(() => {
    return window.electron.projects.onSetFocus((root) => {
      setFocusedProject(root)
    })
  }, [])
  // ENH-182 Phase 3c (D11) — auto-switch focus when activeWorking
  // moves to a file whose deepest project ≠ the currently-focused
  // project. Hooking off `activeWorking` (rather than `tabMembership`
  // change) catches both new-file opens AND reactivations of an
  // existing tab — `duo edit` of an already-open file reactivates
  // without growing fileTabs, but the user's intent is still "show
  // me this file in its project."
  //
  // Skipped in All mode (focusedProject === null) — no filter is
  // active, so there's nothing to switch from. The PRD locks D11 to
  // file activations; terminal-tab switches are intentionally not a
  // trigger (a focused user clicking a hidden terminal is a UI
  // impossibility — the strip already hides it).
  useEffect(() => {
    if (focusedProject === null) return
    if (activeWorking.kind !== 'file') return
    const project = tabMembership[activeWorking.id]
    if (project && project !== focusedProject) {
      setFocusedProject(project)
    }
  }, [activeWorking, tabMembership, focusedProject])
  // BUG-194 — release focus when the focused project vanishes. With
  // BUG-191's live-cwd tracking, `cd`-ing the focused project's last
  // terminal OUT of it drops the project from the rail; if focus stayed
  // pinned to it, the visibility filter (`membership === focusedProject`)
  // would hide the now-orphaned terminals/tabs — the active terminal
  // "disappears" and ⌘T / ⌃Tab lose their target. Releasing to All keeps
  // them visible. Pinned-but-empty projects stay in `railProjects`, so
  // focusing one correctly does NOT trip this.
  useEffect(() => {
    if (shouldReleaseFocus(focusedProject, railProjects.map((p) => p.root))) {
      setFocusedProject(null)
    }
  }, [railProjects, focusedProject])
  // Phase 3c-browser + FOLLOWUP-030 effects live below, after
  // visibleBrowserTabIds + browserTabMembership are declared
  // (declaration order matters; they need to come AFTER the visible
  // sets compute, so they can't sit here next to the file-tab Phase
  // 3c effect). Search for FOLLOWUP-030 to find them.
  // ENH-182 Phase 3 D12 — bulk close every member terminal + tab for
  // `root`. Confirms via dialog.confirm when any member terminal is
  // `kind === 'claude'` (coarse proxy for "may have live work").
  // Leaves at least one terminal alive — if we'd close every tab in
  // `tabs`, append a fresh shell at the home dir so the strip stays
  // non-empty (the existing closeTab path enforces a floor of 1).
  // BUG-192 — re-entrancy guard. A second close for the same root (rapid
  // double-trigger, or the CLI close path racing the right-click menu)
  // no-ops instead of re-running the multi-store flush mid-flush (the
  // FOLLOWUP-032 fix, generalized to the UI path).
  const inFlightCloseRef = useRef<Set<string>>(new Set())
  const handleCloseProject = useCallback(
    async (root: string) => {
      if (inFlightCloseRef.current.has(root)) return
      const counts = projectCounts.get(root)
      if (!counts || (counts.terminals === 0 && counts.workingTabs === 0)) return
      // BUG-192 — confirm BEFORE taking any snapshot or writing state, so
      // the `await` can never split a partially-applied flush across
      // renders (a window the old "snapshot, then await, then mutate"
      // ordering left open).
      if (counts.hasClaudeKindTerminal) {
        const result = await window.electron.dialog.confirm({
          title: 'Close project?',
          message:
            `${railProjects.find((p) => p.root === root)?.name ?? root} has a Claude terminal — ` +
            `closing it ends any live session in that tab. Continue?`,
          buttons: ['Cancel', 'Close project'],
          defaultId: 0,
          cancelId: 0
        })
        if (result.response !== 1) return
      }
      inFlightCloseRef.current.add(root)
      try {
        // Pure plan (member/survivor/active-shift) — no setState nesting.
        const plan = planProjectClose({
          tabs,
          fileTabs,
          terminalMembership,
          tabMembership,
          activeTabId,
          activeWorkingFileId: activeWorking.kind === 'file' ? activeWorking.id : null,
          root
        })
        const memberTermIds = new Set(plan.memberTermIds)
        const memberFileIds = new Set(plan.memberFileIds)
        // Pre-create the floor-of-1 replacement OUTSIDE the updater so its
        // id is known for the active-tab shift (BUG-192 — never call
        // setActiveTabId from inside the setTabs updater).
        const replacement = plan.needsReplacementShell ? makeTab(home, 'shell', home) : null
        setTabs((prev) => {
          const survivors = prev.filter((t) => !memberTermIds.has(t.id))
          return survivors.length === 0 ? [replacement ?? makeTab(home, 'shell', home)] : survivors
        })
        if (plan.activeTerminalBecameMember) {
          setActiveTabId(plan.survivingTermIds[0] ?? replacement?.id ?? activeTabId)
        }
        setFileTabs((prev) => prev.filter((ft) => !memberFileIds.has(ft.id)))
        // If the active working tab was a member, drop to the browser
        // surface (matches closeFileTab's degenerate-case behavior).
        if (plan.activeWorkingFileBecameMember) {
          setActiveWorking({ kind: 'browser' })
        }
        // If the focus chip is on this project, release focus — the
        // project has zero members now (unless it's pinned, in which case
        // the tile stays but the focus would be on an empty set).
        if (focusedProject === root) {
          setFocusedProject(null)
        }
      } finally {
        inFlightCloseRef.current.delete(root)
      }
    },
    [
      projectCounts,
      tabs,
      fileTabs,
      terminalMembership,
      tabMembership,
      railProjects,
      activeTabId,
      activeWorking,
      focusedProject,
      home
    ]
  )
  // ENH-182 Phase 4 — CLI `duo project close` push. Reuses the same
  // handleCloseProject pipeline as the right-click bulk-close, so
  // the confirm dialog + atomic flush + focus release all fire
  // identically. CLI calls feel like UI clicks from the renderer's
  // perspective.
  useEffect(() => {
    return window.electron.projects.onCloseRequest((root) => {
      void handleCloseProject(root)
    })
  }, [handleCloseProject])
  // Build the visible-terminal + visible-working-tab arrays the rest
  // of App.tsx consumes. While focused, hide tabs that belong to a
  // different project (or no project at all).
  const visibleTerminals = useMemo(() => {
    if (focusedProject === null) return tabs
    return tabs.filter((t) => terminalMembership[t.id] === focusedProject)
  }, [tabs, focusedProject, terminalMembership])
  const visibleFileTabs = useMemo(() => {
    if (focusedProject === null) return fileTabs
    return fileTabs.filter((t) => {
      // Pinned file tabs stay visible across focuses (they're
      // intentionally cross-project references). Otherwise gate on
      // project membership.
      const isPinned = pinnedFileTabPaths.has(t.path)
      if (isPinned) return true
      return tabMembership[t.id] === focusedProject
    })
  }, [fileTabs, focusedProject, tabMembership, pinnedFileTabPaths])
  // Set of visible file-tab ids — handed to WorkingPane to gate its
  // internal WorkingTabStrip filter. `undefined` while All-focused
  // tells WorkingPane to skip filtering entirely.
  const visibleFileTabIds = useMemo<ReadonlySet<string> | undefined>(() => {
    if (focusedProject === null) return undefined
    return new Set(visibleFileTabs.map((t) => t.id))
  }, [focusedProject, visibleFileTabs])
  // ENH-182 Phase 2b — browser-mode canvas tab filter. Apply the same
  // membership rule to `file://` browser tabs as Phase 2 does to file
  // editor tabs. URL→project resolution: decode the file:// path,
  // strip query+fragment, then pick the deepest project root whose
  // path is an ancestor (or exact match).
  //
  // Non-file URLs (http/https/about/duo-file/etc.) have no path under
  // a project — they're treated like reference material and stay
  // visible across every focus, mirroring the Phase 2 "pinned file
  // tabs cross focuses" rule. Pinned browser tabs (via Stage 24
  // pins.json) also stay visible, by the same logic.
  const pinnedBrowserUrls = useMemo(
    () => new Set(pins.filter((p) => p.kind === 'browser').map((p) => p.ref)),
    [pins]
  )
  // ENH-182 Phase 2b / FOLLOWUP-030 — browser-tab membership map keyed
  // by BrowserTab.id. file:// → deepest qualifying project root (or
  // null when no qualifying ancestor); non-file URLs (http/https/etc.)
  // → null because they have no path under any project. Pinned URLs
  // are NOT special here — that's a visibility concern, not a project
  // membership concern; pinned tabs may legitimately belong to a
  // specific project (e.g. a pinned smoke walk under duo) and the
  // membership reflects that. Cached so the FOLLOWUP-030 active-tab
  // redirect effect + the Phase 3c-browser auto-switch-focus effect
  // (both below) reuse the same URL→project resolution.
  const browserTabMembership = useMemo<Map<number, string | null>>(() => {
    const map = new Map<number, string | null>()
    if (railProjects.length === 0) {
      for (const bt of browserTabs) map.set(bt.id, null)
      return map
    }
    // Pre-sort roots by descending length so the first hit in the
    // find loop is the deepest qualifying ancestor (D5).
    const rootsByDepth = [...railProjects.map((p) => p.root)].sort(
      (a, b) => b.length - a.length
    )
    for (const bt of browserTabs) {
      if (!bt.url || !bt.url.startsWith('file://')) {
        map.set(bt.id, null)
        continue
      }
      let pathPart: string
      try {
        pathPart = decodeURIComponent(new URL(bt.url).pathname)
      } catch {
        map.set(bt.id, null)
        continue
      }
      // BUG-162 (v0.8.0 fold-in) — macOS symlink shadow. /tmp →
      // /private/tmp realpath; git rev-parse returns /private/tmp/X
      // for paths under /tmp/X, so railProjects.root carries the
      // /private/ form. Browser tabs opened via `duo open /tmp/foo.html`
      // arrive as file:///tmp/foo.html. Without a fallback the string
      // compare misses. Build TWO candidate paths (raw + /private-
      // stripped) and try each against the sorted roots.
      const candidates: string[] = [pathPart]
      if (pathPart.startsWith('/private/')) {
        candidates.push(pathPart.replace(/^\/private\//, '/'))
      } else if (pathPart.startsWith('/tmp/') || pathPart === '/tmp') {
        candidates.push('/private' + pathPart)
      }
      let deepest: string | undefined
      for (const candidate of candidates) {
        deepest = rootsByDepth.find(
          (r) => candidate === r || candidate.startsWith(r + '/')
        )
        if (deepest) break
      }
      map.set(bt.id, deepest ?? null)
    }
    return map
  }, [browserTabs, railProjects])
  const visibleBrowserTabIds = useMemo<ReadonlySet<number> | undefined>(() => {
    if (focusedProject === null) return undefined
    const visible = new Set<number>()
    for (const bt of browserTabs) {
      if (!bt.url) continue
      if (pinnedBrowserUrls.has(bt.url)) {
        // Pinned browser tabs are cross-project reference material;
        // keep visible across every focus.
        visible.add(bt.id)
        continue
      }
      if (!bt.url.startsWith('file://')) {
        // Non-file URLs are also cross-project (no path under a
        // project to bind to); keep visible across every focus.
        visible.add(bt.id)
        continue
      }
      if (browserTabMembership.get(bt.id) === focusedProject) {
        visible.add(bt.id)
      }
    }
    return visible
  }, [focusedProject, browserTabs, pinnedBrowserUrls, browserTabMembership])
  // ENH-182 Phase 3c (D11) — browser-tab parallel to the file-tab
  // auto-switch effect above. When activeWorking shifts to a browser
  // tab whose `file://` URL resolves to a project ≠ focused, flip
  // focus. Catches `duo open` of a different-project file:// URL +
  // user-driven browser tab activations while focused.
  //
  // Browser tabs with no project membership (non-file URLs, /tmp,
  // any path under no qualifying root) do NOT trigger a switch —
  // those are reference material; the FOLLOWUP-030 effect below
  // handles their visibility separately.
  useEffect(() => {
    if (focusedProject === null) return
    if (activeWorking.kind !== 'browser') return
    const active = browserTabs.find((bt) => bt.isActive && !bt.inAux)
    if (!active) return
    const project = browserTabMembership.get(active.id)
    if (project && project !== focusedProject) {
      setFocusedProject(project)
    }
  }, [activeWorking, browserTabs, browserTabMembership, focusedProject])
  // ENH-182 FOLLOWUP-030 — browser-pane active-tab redirect on focus
  // entry / focus change. The browser pane is one shared
  // WebContentsView; without this, hiding a non-member browser tab's
  // strip entry leaves the pane still rendering its content
  // (disorienting + no UI affordance to close/switch away while the
  // strip filter hides it).
  //
  // **Crucially gated on focusedProject change, NOT on activeWorking
  // change.** Without the ref-guard the effect would also fire when
  // the user CLICKS a non-member browser tab while focused — a click
  // they presumably want to act on, not be bounced away from. The
  // guard ensures the redirect only fires when focus is entered or
  // changes (the conditions that actually create the disorientation).
  // Phase 3c-browser above is the right effect for handling
  // user-clicked tab activations (it auto-switches FOCUS instead).
  //
  // Strategy mirrors the Phase 2 file-side fallback in the bigger
  // useEffect below (on `[focusedProject, visibleTerminals,
  // visibleFileTabs]`):
  //   1. Active browser is a visible member → no-op.
  //   2. Hidden + member browser tabs exist → switch active to first.
  //   3. Hidden + no member browser tabs + member file tabs exist →
  //      flip activeWorking.kind to 'file' (delegates to file-pane).
  //   4. Hidden + nothing of mine open → leave alone (last resort);
  //      the focus chip + strip filter still signal the lens is active.
  // State-machine instead of a simple ref-guard:
  // - `pendingBrowserRedirect` is set to focusedProject on every focus
  //   change (including hydration to null, which clears it).
  // - The apply effect drains pendingBrowserRedirect once the relevant
  //   browser state has converged (browserTabs populated, activeWorking
  //   committed, visibleBrowserTabIds derived).
  // - Once drained, subsequent re-renders (caused by user clicks on
  //   non-member tabs, browserTabs updates, etc.) DON'T re-trigger the
  //   redirect — preserving the user's intent to view that tab.
  //
  // This shape was necessary because a pure focus-change-only effect
  // fires once on focus change but bails when browserTabs hasn't yet
  // propagated from the addTab IPC, then never re-fires for that focus
  // session (ref-guard skips). A pure no-guard effect fires every
  // state change but bounces user-clicked tabs.
  const [pendingBrowserRedirect, setPendingBrowserRedirect] = useState<string | null>(null)
  useEffect(() => {
    setPendingBrowserRedirect(focusedProject)
  }, [focusedProject])
  useEffect(() => {
    if (pendingBrowserRedirect === null) return
    if (pendingBrowserRedirect !== focusedProject) return
    // Focus is null = no filter to enforce; clear pending.
    if (focusedProject === null) {
      setPendingBrowserRedirect(null)
      return
    }
    // Not viewing the browser pane — the existing file-side fallback
    // will land us on the right surface; clear pending so we don't
    // re-fire if/when the user later switches to browser kind via a
    // non-focus-change path.
    if (activeWorking.kind !== 'browser') {
      setPendingBrowserRedirect(null)
      return
    }
    // visibleBrowserTabIds derived from focus + browserTabs + memos;
    // when focused !== null, it's a Set. Defensive guard.
    if (!visibleBrowserTabIds) return
    // Wait for browserTabs population — `duo open` adds a tab via
    // async IPC and the renderer's onTabsChange fires after a tick.
    // Until then, browserTabs may be empty; defer the decision.
    if (browserTabs.length === 0) return
    const activeBrowser = browserTabs.find((bt) => bt.isActive && !bt.inAux)
    if (!activeBrowser) {
      setPendingBrowserRedirect(null)
      return
    }
    // Already showing a visible member / pinned-cross / non-file URL
    // tab — nothing to redirect.
    if (visibleBrowserTabIds.has(activeBrowser.id)) {
      setPendingBrowserRedirect(null)
      return
    }
    // Prefer a TRUE member browser tab (its file:// URL resolves to
    // focusedProject) over a pinned cross-project tab. Pinned tabs
    // pass the visibility filter as reference material but they're
    // NOT members; landing the user on a pinned-from-elsewhere tab
    // chains into Phase 3c-browser auto-switching focus to that
    // tab's actual project — exactly the disorientation FOLLOWUP-
    // 030 was filed to fix.
    const firstMember = browserTabs.find(
      (bt) => !bt.inAux && browserTabMembership.get(bt.id) === focusedProject
    )
    if (firstMember) {
      void window.electron.browser.switchTab(firstMember.id)
    } else if (visibleFileTabs.length > 0) {
      setActiveWorking({ kind: 'file', id: visibleFileTabs[0].id })
    }
    setPendingBrowserRedirect(null)
  }, [pendingBrowserRedirect, focusedProject, activeWorking, visibleBrowserTabIds, browserTabs, browserTabMembership, visibleFileTabs])
  // ENH-182 Phase 2 — when the user enters focus, save the previous
  // navigator cwd so we can restore it when focus clears. Re-root the
  // navigator to the project root (D10 — not a hard tree filter; the
  // user can still navigate up/out, the rail just sets the home cwd
  // for the focused project).
  const navCwdBeforeFocusRef = useRef<string | null>(null)
  useEffect(() => {
    if (focusedProject) {
      // Entering focus (or switching projects): capture cwd ONCE,
      // then jump to project root.
      if (navCwdBeforeFocusRef.current === null) {
        navCwdBeforeFocusRef.current = nav.state.cwd ?? null
      }
      nav.actions.navigateTo(focusedProject)
    } else if (navCwdBeforeFocusRef.current !== null) {
      // Clearing focus: restore the pre-focus cwd, drop the saved
      // value.
      nav.actions.navigateTo(navCwdBeforeFocusRef.current)
      navCwdBeforeFocusRef.current = null
    }
    // We intentionally OMIT `nav.actions` / `nav.state.cwd` from the
    // dep list — including them would re-trigger this effect every
    // time the navigator moves, fighting the user's own navigation
    // while focused (D10 explicitly allows free navigation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedProject])
  // ENH-182 Phase 2 — auto-spawn-on-focus tracker. Owner directive
  // 2026-05-25 walk-1: focusing on a project that has working tabs
  // but no terminals shows an empty terminal strip — confusing.
  // Auto-spawn a fresh terminal at the project root (using the
  // user's most-recent kind choice) so the focused state always has
  // a usable terminal. Tracked per-focus-session so re-focusing the
  // same project repeatedly doesn't keep spawning.
  const autoSpawnedForRef = useRef<string | null>(null)
  // While focused, if the active terminal tab isn't visible, switch
  // to the first visible one. Same for the working pane. Keeps the
  // user from staring at an empty pane after entering focus.
  useEffect(() => {
    if (focusedProject === null) {
      autoSpawnedForRef.current = null
      return
    }
    const activeTerminalVisible = visibleTerminals.some((t) => t.id === activeTabId)
    if (!activeTerminalVisible && visibleTerminals.length > 0) {
      setActiveTabId(visibleTerminals[0].id)
    } else if (
      visibleTerminals.length === 0 &&
      autoSpawnedForRef.current !== focusedProject
    ) {
      // No member terminals — spawn one at the project root. Mark
      // the focus session as auto-spawned BEFORE the state update so
      // the next render (with the new tab in `tabs`) doesn't re-fire.
      //
      // Race guard: `terminalMembership` is computed from async
      // git/marker probes, so in the probe-pending window right after a
      // focus click `visibleTerminals` is transiently empty even when an
      // existing terminal's launch cwd sits under the focused root.
      // Auto-spawning here would strand the user with a spurious new
      // terminal while their real one becomes visible-but-inactive a
      // beat later. Suppress the spawn while any open terminal's cwd is
      // under the focused root — once membership resolves, the
      // switch-to-first-visible branch above focuses it. Only spawn when
      // there's genuinely no terminal under the root (e.g. focusing a
      // project that has only working tabs open).
      const hasTerminalUnderRoot = tabs.some(
        (t) => t.cwd === focusedProject || t.cwd.startsWith(focusedProject + '/')
      )
      if (!hasTerminalUnderRoot) {
        autoSpawnedForRef.current = focusedProject
        if (lastTabKind === 'claude') {
          openClaudeIn(focusedProject)
        } else {
          openTerminalHere(focusedProject)
        }
      }
    }
    if (
      activeWorking.kind === 'file' &&
      !visibleFileTabs.some((t) => t.id === activeWorking.id)
    ) {
      if (visibleFileTabs.length > 0) {
        setActiveWorking({ kind: 'file', id: visibleFileTabs[0].id })
      } else {
        setActiveWorking({ kind: 'browser' })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedProject, visibleTerminals, visibleFileTabs])
  // BUG-161 (v0.8.0 fold-in) — auto-release focus when the focused
  // project loses its last member via a non-rail close path. Without
  // this, ⌘W or × on the last member tab leaves the user focus-
  // trapped (auto-spawn already fired once this focus session;
  // refuses to fire again; strip empty; only escape is clicking All
  // or chip ×). Bulk-close via the rail right-click menu already
  // handles release explicitly; this covers the direct close paths.
  //
  // Two-layer guard against false positives during the probe-pending
  // window (terminalMembership/tabMembership briefly null while
  // qualify probes are in-flight, producing transient 0/0 counts):
  //   1. Don't release on undefined counts — wait for a positive
  //      signal that the project exists in the counts map.
  //   2. Don't release unless we've previously OBSERVED this project
  //      with > 0 members in this session. A freshly focused project
  //      whose probes haven't completed yet won't appear as
  //      observed; first render with 0/0 is treated as "not yet
  //      probed" rather than "user just closed everything."
  //
  // Pinned projects skip the release — D12 says pinned tiles persist
  // even with zero members; the user opted-in to the empty state by
  // pinning. Auto-spawn still fires for them.
  const previousNonZeroCountsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (focusedProject === null) return
    const focusedProjectObj = railProjects.find((p) => p.root === focusedProject)
    if (!focusedProjectObj) return
    if (focusedProjectObj.pinned) return
    const counts = projectCounts.get(focusedProject)
    if (!counts || counts.terminals !== 0 || counts.workingTabs !== 0) {
      previousNonZeroCountsRef.current.add(focusedProject)
      return
    }
    if (!previousNonZeroCountsRef.current.has(focusedProject)) return
    previousNonZeroCountsRef.current.delete(focusedProject)
    setFocusedProject(null)
  }, [focusedProject, projectCounts, railProjects])
  // Resolve the focused project's display name for the title-bar
  // chip. Avoids re-searching the list on every render.
  const focusedProjectName = useMemo(() => {
    if (focusedProject === null) return null
    return railProjects.find((p) => p.root === focusedProject)?.name ?? null
  }, [focusedProject, railProjects])

  // Stage 15 G17 — push the active terminal id to main so `duo send`
  // can write into the right PTY. `null` covers the degenerate case
  // where every terminal tab was closed (today the UI prevents this,
  // but the IPC contract supports it for future surfaces).
  // ENH-013 — payload also carries `kind` so main's claude-presence
  // probe can arm its starting-grace window for kind=='claude' tabs.
  useEffect(() => {
    window.electron.terminal?.pushActiveId({
      id: activeTab ? activeTab.id : null,
      kind: activeTab ? activeTab.kind : null
    })
  }, [activeTab?.id, activeTab?.kind])

  // ── Tab actions ────────────────────────────────────────────────────────────

  // Stage 19c D21–D23 — after PtyManager spawns the user's shell, write
  // the post-spawn payload (claude\n, the install banner, or whatever the
  // CLI's --cmd specified) into the same PTY. Done here, not in main,
  // because PTY data writes route through the renderer's preload pty API
  // — same path the user's keystrokes take, so the payload appears in
  // the terminal exactly as if the user typed it.
  //
  // BUG-009 fix — wait for the shell to have emitted its PS1 (first
  // PTY data event) before writing. Earlier code used queueMicrotask
  // alone, which deferred only one renderer event-loop tick — not
  // enough for zsh to read rc files and print its prompt. Result was a
  // visible race: literal payload text rendered above the prompt, and
  // the trailing newline got swallowed against an empty pre-prompt
  // state. waitForPtyReady (defined above) handles all post-spawn
  // payloads — claude auto-launch, install banner, --cmd from CLI.
  const dispatchPostSpawnWrite = useCallback(async (id: string, kind: TerminalTabKind, cmd?: string) => {
    let payload: string | null = null
    if (kind === 'claude') {
      // D23 — only auto-launch if claude is reachable; otherwise print
      // the install banner so the user knows why their tab opened bare.
      const onPath = await window.electron.terminal.claudeOnPath()
      if (onPath) {
        // ENH-049 — when a cmd is supplied (Stage 27 `claude:spawn`
        // data-cmd, CLI `duo new-tab --claude --cmd "<msg>"`), launch
        // claude FIRST, then queue the cmd into the PTY input buffer
        // so claude reads it as its FIRST MESSAGE once it takes over
        // stdin. Previously the code path sent the cmd directly (no
        // claude\n prefix), which typed the cmd into zsh and errored
        // because the cmd was prose like "Read X and walk me through".
        // PTY input is line-buffered: zsh reads `claude\n`, execs
        // claude, claude inherits stdin with `<cmd>\n` already in the
        // buffer, claude reads it as the first user message.
        payload = cmd && cmd.length > 0 ? `claude\n${cmd}\n` : 'claude\n'
      } else {
        // claude not on PATH — show the install banner. Cmd (if any)
        // is dropped: it's a Claude prompt, useless without Claude.
        payload = CLAUDE_MISSING_BANNER
      }
    } else if (cmd && cmd.length > 0) {
      // kind='shell' + --cmd — type the cmd as the shell's first
      // command. No trailing newline — parity with `duo send` (the
      // user / agent confirms by pressing Enter).
      payload = cmd
    }
    if (payload === null) return
    await waitForPtyReady(id)
    void window.electron.pty.write(id, payload)
  }, [])

  // Stage 10 § D9 + Stage 19c — new terminal tabs inherit the focused
  // terminal's CWD. ENH-187 (2026-05-26) — read the focused tab's
  // LIVE shell cwd (via lsof in main) rather than its launch cwd, so a
  // tab the user has `cd`'d around in still inherits where they
  // currently are. Three-tier fallback:
  //   1. Active tab's live cwd (lsof) — what the user sees in their shell.
  //   2. Active tab's launch cwd — if lsof can't read (dead pid, no permission).
  //   3. pendingCwd — when there's no active terminal at all (navigator's
  //      current folder or the selected file's parent — Stage 10 D9).
  // Pre-ENH-187, this used pendingCwd directly, which lagged the focused
  // terminal on follow-mode races (rapid switch + ⌘T) and never tracked
  // the live shell cwd. `kind` controls whether the tab auto-launches
  // claude after the shell starts (D17 / D21). The split-button `+`
  // always passes 'claude'; `>` passes 'shell'. The persisted last-kind
  // only governs `duo new-tab` calls without --kind — see addTabFromCli below.
  const newTab = useCallback(async (kind: TerminalTabKind) => {
    let cwd = pendingCwd
    if (activeTab) {
      const liveCwd = await window.electron.pty.liveCwd(activeTab.id)
      cwd = liveCwd ?? activeTab.cwd ?? pendingCwd
    }
    const tab = makeTab(cwd, kind, home)
    setTabs(prev => [...prev, tab])
    setActiveTabId(tab.id)
    void dispatchPostSpawnWrite(tab.id, kind)
    return tab
  }, [pendingCwd, home, dispatchPostSpawnWrite, activeTab])

  // "Open terminal here" from the navigator's right-click menu (§ D11).
  // Explicit CWD bypasses the pending-CWD rule so the user gets exactly
  // the folder they right-clicked. Stage 19c: today this still opens a
  // vanilla shell (the right-click menu's "open terminal here" wording
  // promises a shell, not an agent). The Navigator polish bundle has a
  // separate item for a "claude here" hover-action; that lives there,
  // not in this menu item.
  const openTerminalHere = useCallback((folderPath: string) => {
    const tab = makeTab(folderPath, 'shell', home)
    setTabs(prev => [...prev, tab])
    setActiveTabId(tab.id)
    setFocusedColumn('terminal')
  }, [home])

  // Stage 26 item 7 — hover "new Claude here" on folder rows. Same
  // explicit-CWD pattern as openTerminalHere, but kind='claude' so the
  // post-spawn writer runs `claude\n` (or the install banner if claude
  // isn't on PATH). CLI parity already lives in
  // `duo new-tab --claude --cwd <path>`.
  const openClaudeIn = useCallback((folderPath: string) => {
    const tab = makeTab(folderPath, 'claude', home)
    setTabs(prev => [...prev, tab])
    setActiveTabId(tab.id)
    setFocusedColumn('terminal')
    void dispatchPostSpawnWrite(tab.id, 'claude')
  }, [home, dispatchPostSpawnWrite])

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      if (prev.length === 1) return prev
      const next = prev.filter(t => t.id !== id)
      if (id === activeTabId) {
        const idx = prev.findIndex(t => t.id === id)
        setActiveTabId(next[Math.max(0, idx - 1)].id)
      }
      // ENH-179 — push the closed terminal tab onto the ring. Note:
      // restoring a terminal tab spawns a NEW PTY at the same cwd
      // (PTY state is not preserved across close + reopen); but a
      // tab at the right cwd + kind is usually what muscle memory
      // expects from ⌘Z.
      const closed = prev.find(t => t.id === id)
      if (closed) {
        const entry: ClosedTabEntry = {
          kind: 'terminal',
          cwd: closed.cwd,
          ptyKind: closed.kind,
          closedAt: Date.now()
        }
        const ring = closedTabsRef.current
        ring.push(entry)
        if (ring.length > CLOSED_TABS_MAX) ring.shift()
      }
      return next
    })
  }, [activeTabId])

  // ENH-188 — reorder terminal tabs (drag + move-left/right menu).
  // Mirrors WorkingPane's `reorderTab` insert-before/after semantics but
  // operates directly on the `tabs` array (no pinned zones, no separate
  // order state — array order IS the strip order, and it persists for
  // free via workspace-save). Both ids are members of the VISIBLE strip
  // (TabBar only ever hands us visible-tab ids). Under ENH-182 project
  // focus the strip is a subset, so `reorderVisible` reorders within the
  // visible subsequence and rebuilds in place — hidden tabs keep their
  // absolute slots, so a reorder while focused never disturbs another
  // project's tab order. The transform (+ its hidden-slot invariant) is
  // unit-tested in `shared/reorderTabs.test.ts`.
  const reorderTerminalTab = useCallback((sourceId: string, targetId: string) => {
    setTabs(prev => reorderVisible(prev, sourceId, targetId, (t) =>
      focusedProject === null || terminalMembership[t.id] === focusedProject))
  }, [focusedProject, terminalMembership])

  // ENH-188 — "Close other tabs" context-menu verb. Closes every VISIBLE
  // terminal tab except the kept one (under project focus, other
  // projects' tabs are untouched). Each closed tab is pushed onto the
  // ENH-179 closed-tab ring so ⌘Z restores them (re-spawns at the same
  // cwd/kind — PTY state isn't preserved, matching single-tab close).
  const closeOtherTabs = useCallback((keepId: string) => {
    setTabs(prev => {
      const isVisible = (t: TabSession) =>
        focusedProject === null || terminalMembership[t.id] === focusedProject
      const toClose = prev.filter(t => isVisible(t) && t.id !== keepId)
      if (toClose.length === 0) return prev
      const closeIds = new Set(toClose.map(t => t.id))
      const ring = closedTabsRef.current
      for (const closed of toClose) {
        ring.push({ kind: 'terminal', cwd: closed.cwd, ptyKind: closed.kind, closedAt: Date.now() })
        if (ring.length > CLOSED_TABS_MAX) ring.shift()
      }
      return prev.filter(t => !closeIds.has(t.id))
    })
    setActiveTabId(keepId)
  }, [focusedProject, terminalMembership])

  const updateTabTitle = useCallback((id: string, title: string) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, title } : t))
  }, [])

  // Stage 10 § D1: follow-mode — unless the navigator is pinned, switching
  // between terminal tabs moves the navigator's cwd to that tab's launch
  // CWD. This is the "context drawer" behavior.
  //
  // The trigger is a *tab switch*, not any nav-state change. Earlier
  // versions re-ran on every render, which reverted any breadcrumb /
  // tree click back to the active tab's launch CWD. The ref guards against
  // that: we only follow when activeTabId differs from the last tab we
  // followed.
  const lastFollowedTabIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (nav.state.pinned || !activeTab) return
    if (lastFollowedTabIdRef.current === activeTabId) return
    lastFollowedTabIdRef.current = activeTabId
    if (nav.state.cwd !== activeTab.cwd) nav.setCwd(activeTab.cwd)
  }, [activeTabId, activeTab, nav])

  // Stage 10 Phase 6: push navigator-state snapshots to the main process
  // so `duo nav state` can read the current value without a renderer RPC.
  // ENH-148 — selectedPaths carries the full multi-select set; the
  // singular `selected` stays as the primary for back-compat callsites
  // (computePendingCwd, CLI `duo nav-state` consumers).
  useEffect(() => {
    const selectedPaths = Array.from(nav.state.selectedItems.entries())
      .map(([path, kind]) => ({ path, kind }))
    window.electron.nav.pushState({
      cwd: nav.state.cwd,
      selected: nav.state.selected,
      selectedPaths,
      expanded: [...nav.state.expanded],
      pinned: nav.state.pinned,
      // ENH-172 — surface the showDotfiles flag in nav-state for
      // CLI consumers (`duo nav-state` returns it) AND for the
      // View → Show Hidden Files menu-checkmark sync (main reads
      // this off the snapshot in the NAV_STATE_PUSH handler).
      showDotfiles: nav.state.showDotfiles
    })
  }, [nav.state.cwd, nav.state.selected, nav.state.selectedItems, nav.state.expanded, nav.state.pinned, nav.state.showDotfiles])

  // ── File-open from the navigator ───────────────────────────────────────────

  // Open (or switch to) a file tab in the WorkingPane. § D13 — same-path
  // identity: if a tab already exists for this path, activate it instead of
  // creating a duplicate.
  //
  // BUG-101 (Sprint 13 v2 fix) — resolve activation OUTSIDE the
  // setFileTabs updater. Pre-fix (Sprint 9), the activation target
  // was stashed on `pendingActivationRef` inside the updater and
  // flushed on the next line — but the updater is queued, not run
  // synchronously, so the ref was still null when the flush ran.
  // Symptom: `duo edit /path/foo.md` opened the tab but never
  // activated it; the previously-active tab kept focus.
  //
  // Fix: read the latest committed fileTabs via `fileTabsRef`,
  // decide the activation id synchronously, then schedule the
  // setFileTabs append + setActiveWorking + setFocusedColumn calls
  // in the same React batch. The updater inside setFileTabs only
  // does the array mutation (re-checking for an existing tab is
  // race-defensive but otherwise pure).
  const openFile = useCallback((path: string, title: string) => {
    const existing = fileTabsRef.current.find(t => t.path === path)
    let activationId: string
    if (existing) {
      activationId = existing.id
    } else {
      const { type, mime } = classifyFile(path)
      activationId = crypto.randomUUID()
      const newTab: FileTab = { id: activationId, type, path, title, mime }
      setFileTabs(prev => {
        // Race-defense: a concurrent open of the same path may have
        // landed between our ref read and this commit. Re-check.
        if (prev.find(t => t.path === path)) return prev
        return [...prev, newTab]
      })
    }
    setActiveWorking({ kind: 'file', id: activationId })
    setFocusedColumn('working')
    // BUG-101 walk-2 (Sprint 9, 2026-05-07) — owner saw the tab
    // surface but caret stayed in the terminal. Walk-1 added a
    // two-rAF .focus() dance, but the selector hit a hidden tab
    // (BUG-046 keeps all file-tab renderers mounted, display-toggled).
    // Walk-2 fix: route through `findVisibleWorkingPaneCE('main')`
    // which filters by offsetParent !== null AND excludes the aux
    // subtree. Same two-rAF pattern (wait past React commit + paint).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const ce = findVisibleWorkingPaneCE('main')
        if (ce) ce.focus()
      })
    })
    // BUG-101 instrumentation — surface the path the open went down.
    // Walk-1 feedback: console.debug is hidden by Chrome DevTools'
    // default level filter (Info+). Switched to console.log so the
    // trace lands in the default Console view without the user having
    // to enable Verbose.
    console.log('[BUG-101 openFile]', { path, title })
  }, [])

  // ENH-156 — verb-driven file open dispatcher.
  // - HTML routes to the browser pane (interactive, scripts run) by
  //   default. `mode === 'canvas'` overrides to the canvas tab
  //   (source-editable, scripts blocked) — used by `duo edit` and
  //   the right-click "Edit in canvas" entry.
  // - Non-HTML routes via openFile's classifier (`.md` → TipTap
  //   editor; image → viewer; JSON → JsonView; etc.). The mode
  //   arg is HTML-specific; ignored for other types.
  // - The legacy `<meta name="duo-open-in" content="browser">` is
  //   no longer consulted — verb decides surface. Existing meta
  //   declarations on user files are harmless under the new default
  //   (HTML already lands in browser via `duo open`).
  const openFileSmart = useCallback(async (path: string, title: string, mode?: 'canvas' | 'browser') => {
    const lower = path.toLowerCase()
    const isHtml = lower.endsWith('.html') || lower.endsWith('.htm')
    if (isHtml && mode !== 'canvas') {
      const fileUrl = `file://${encodeURI(path)}`
      // BUG-059 — de-dupe local files routed to the browser pane.
      // file:// URLs ARE local files (the FAQ, What Duo Does, any
      // user-authored HTML); opening one twice should activate the
      // existing tab rather than spawning a duplicate. Web URLs
      // (http/https) keep duplicate-allowed (multiple tabs on the
      // same site is a legitimate browser pattern); this branch
      // only fires for local HTML so the filter is by construction.
      const existing = (await window.electron.browser.getTabs())
        .find(t => t.url === fileUrl)
      if (existing) {
        await window.electron.browser.switchTab(existing.id)
      } else {
        await window.electron.browser.addTab(fileUrl)
      }
      setActiveWorking({ kind: 'browser' })
      setFocusedColumn('working')
      return
    }
    // Canvas mode for HTML, OR any non-HTML (classifier picks).
    openFile(path, title)
  }, [openFile])

  const onOpenFile = useCallback((entry: DirEntry) => {
    void openFileSmart(entry.path, entry.name)
  }, [openFileSmart])

  const closeFileTab = useCallback((id: string) => {
    setFileTabs(prev => {
      const closedIdx = prev.findIndex(t => t.id === id)
      const closed = closedIdx >= 0 ? prev[closedIdx] : null
      // ENH-179 — push the closed file tab onto the LIFO ring before
      // it disappears from state. Skip un-saved-yet tabs (isNew: true)
      // because we don't have a real path to restore.
      if (closed && !closed.isNew && closed.path) {
        const entry: ClosedTabEntry = {
          kind: 'file',
          path: closed.path,
          closedAt: Date.now()
        }
        const ring = closedTabsRef.current
        ring.push(entry)
        if (ring.length > CLOSED_TABS_MAX) ring.shift()
      }
      const next = prev.filter(t => t.id !== id)
      // If we closed the active file tab, shift focus to the LEFT neighbor
      // (the file tab immediately preceding the closed one in tab order),
      // falling back to the right neighbor if the closed tab was leftmost,
      // and to the browser tab kind if no file tabs remain. Mirrors the
      // BrowserManager.closeTab findNonAux walker + the Terminal closeTab
      // pattern + Chrome / VS Code / every other tabbed app. ENH-144.
      if (activeWorking.kind === 'file' && activeWorking.id === id) {
        if (next.length === 0) {
          setActiveWorking({ kind: 'browser' })
        } else {
          const targetIdx = Math.min(Math.max(0, closedIdx - 1), next.length - 1)
          setActiveWorking({ kind: 'file', id: next[targetIdx].id })
        }
      }
      return next
    })
  }, [activeWorking])

  // Stage 11 — editor tabs push their dirty state up so the strip can show
  // the unsaved dot. No-op if the tab is already at the requested state.
  //
  // Sprint 3 Phase 3c-iii foundation (v0.6.5 prep) — also mirror the dirty
  // state into a path-keyed Set. The existing fileTabs[i].dirty is fine
  // for main tabs (the strip's unsaved dot reads from there), but aux
  // tabs (synthesized id `aux:${path}`) aren't in fileTabs, so the
  // existing flow silently drops their dirty signal. dirtyPaths is the
  // canonical "is this PATH dirty across all surfaces?" lookup the
  // upcoming dirty-replace dialog will consult before silent-replacing
  // aux content. Both surfaces converge on path as the key (forward-
  // compatible with browser-in-aux too — file:// URLs land in the same
  // Set).
  const onTabDirtyChange = useCallback((id: string, dirty: boolean) => {
    // Resolve id → path. Main fileTabs use random uuids; aux tabs use
    // the `aux:${path}` synthesized form (see WorkingPane § buildAuxFileTab).
    let resolvedPath: string | null = null
    if (id.startsWith('aux:')) {
      resolvedPath = id.slice(4)
    }
    // For main tabs, find the path via fileTabs lookup. We also still
    // need to update fileTabs[i].dirty for the strip's unsaved dot, so
    // the lookup happens inside the setFileTabs setter to avoid a
    // stale-closure read on fileTabs.
    setFileTabs(prev => {
      const tab = prev.find(t => t.id === id)
      if (tab && resolvedPath === null) resolvedPath = tab.path
      if (!tab || (tab.dirty ?? false) === dirty) return prev
      return prev.map(t => t.id === id ? { ...t, dirty } : t)
    })
    // Mirror to the path-keyed Set. Aux tabs (no fileTabs entry) still
    // land here via the 'aux:' prefix path resolution above. Idempotent
    // adds/deletes mean redundant signals don't churn the Set.
    if (resolvedPath !== null) {
      setDirtyPaths(prev => {
        const isDirty = prev.has(resolvedPath!)
        if (isDirty === dirty) return prev
        const next = new Set(prev)
        if (dirty) next.add(resolvedPath!)
        else next.delete(resolvedPath!)
        return next
      })
    }
  }, [])

  // Stage 23 — host-side dispatcher for canvas data-duo-action clicks.
  // PageTab installs the listener, parses the action verb + args, and
  // calls back here. We translate to existing infrastructure:
  //   - claude:spawn   → mirror the `duo new-tab --claude` flow used by
  //                      the CLI route (makeTab + setTabs +
  //                      dispatchPostSpawnWrite). Surfaces the terminal
  //                      column so the new tab is visible immediately.
  //   - terminal:send  → pty.write into the active PTY, with optional
  //                      Enter via the data-enter="true" attribute (see
  //                      Stage 23b).
  //   - browser:open   → browser.addTab(url) — flips WorkingPane to the
  //                      browser slot first so the new tab is visible.
  //
  // Trust gating happens canvas-side in canvasActions.ts; this handler
  // is only called for trusted canvases (path under ~/.claude/duo/).
  const handlePlaygroundAction = useCallback(async (
    action: import('@shared/types').PlaygroundAction
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      switch (action.kind) {
        case 'claude:spawn': {
          const cwd = action.cwd && action.cwd.length > 0 ? action.cwd : pendingCwd
          const tab = makeTab(cwd, 'claude', home)
          setTabs(prev => [...prev, tab])
          setActiveTabId(tab.id)
          setLastTabKind('claude')
          saveLastTabKind('claude')
          setFocusedColumn('terminal')
          // Use the claude post-spawn write (claude\n) by default; if
          // the canvas supplied a `data-cmd`, use that instead so the
          // first thing the agent sees is the user's chosen prompt.
          void dispatchPostSpawnWrite(tab.id, 'claude', action.cmd)
          return { ok: true }
        }
        case 'terminal:send': {
          if (!activeTabId) {
            return { ok: false, error: 'no active terminal tab' }
          }
          const payload = action.enter ? `${action.text}\n` : action.text
          await window.electron.pty.write(activeTabId, payload)
          setFocusedColumn('terminal')
          return { ok: true }
        }
        case 'browser:open': {
          // Validate the URL minimally — empty string or whitespace
          // wouldn't help anyone. Don't enforce protocol; the browser
          // pane handles relative + bare hostnames gracefully.
          const url = action.url.trim()
          if (!url) return { ok: false, error: 'browser:open requires a non-empty URL' }
          setActiveWorking({ kind: 'browser' })
          setFocusedColumn('working')
          await window.electron.browser.addTab(url)
          return { ok: true }
        }
        // Stage 27 — `editor:open` opens an arbitrary file in whichever
        // surface fits. `data-mode` forces the surface; absent, defer
        // to openFileSmart which routes HTML to browser by default
        // (ENH-156 verb-driven; the `<meta duo-open-in>` declaration
        // is no longer consulted).
        case 'editor:open': {
          const trimmed = action.path.trim()
          if (!trimmed) return { ok: false, error: 'editor:open requires a non-empty data-path' }
          // Resolve `~/` and (best-effort) leave relative paths alone —
          // they resolve against the canvas's CWD on the renderer side
          // via openFile. openFileSmart accepts an absolute path; for
          // most authored canvases under ~/.claude/duo/ that's what
          // we'll get.
          const absPath = trimmed.startsWith('~/') ? `${home}/${trimmed.slice(2)}` : trimmed
          const title = absPath.slice(absPath.lastIndexOf('/') + 1) || absPath
          if (action.mode === 'browser') {
            // Force browser pane (HTML default under ENH-156).
            const fileUrl = absPath.startsWith('http://') || absPath.startsWith('https://')
              ? absPath
              : `file://${encodeURI(absPath)}`
            setActiveWorking({ kind: 'browser' })
            setFocusedColumn('working')
            await window.electron.browser.addTab(fileUrl)
            return { ok: true }
          }
          if (action.mode === 'canvas' || action.mode === 'editor') {
            // Force the file-tab path (canvas vs. editor is decided by
            // classifyFile from the extension; both routes go through
            // openFile which sets active surface to the file tab).
            openFile(absPath, title)
            return { ok: true }
          }
          // Default: verb-driven routing (HTML → browser per ENH-156;
          // non-HTML → natural surface via classifier).
          await openFileSmart(absPath, title)
          return { ok: true }
        }
        // Stage 27 — reveal a path in the file navigator. Mirrors the
        // file-tab context-menu "Reveal in Navigator" entry.
        case 'nav:reveal': {
          const trimmed = action.path.trim()
          if (!trimmed) return { ok: false, error: 'nav:reveal requires a non-empty data-path' }
          const absPath = trimmed.startsWith('~/') ? `${home}/${trimmed.slice(2)}` : trimmed
          // BUG-053 — single atomic action; previous two-call pattern
          // (navigateTo + selectItem) had a window where selected
          // was null in between, leaving the row un-highlighted.
          //
          // BUG-053 v2 (post-walk-3) — route to the correct navigator
          // pane based on whether the path is inside ~/.claude/
          // (user-claude pane) or elsewhere (project pane). Walk-3
          // FAIL was: target was ~/.claude/duo/priming.md but the
          // handler called `nav.actions.revealAndSelect` which is the
          // PROJECT navigator. Project-nav set its selected correctly
          // (verified via `duo nav-state`), but the visible tree was
          // showing project-root contents, so no row matched. The
          // visible USER-CLAUDE pane (showing ~/.claude/duo/) had its
          // own `selected` state untouched, so no highlight rendered.
          //
          // Fix: prefix-match against ~/.claude/ and dispatch to the
          // appropriate pane's `revealAndSelect`. The user-claude pane
          // is a fixed-root navigator (its navigateTo is a no-op), so
          // its revealAndSelect just sets selected — sufficient when
          // the file is already visible in the always-rooted-at-
          // ~/.claude tree.
          const claudeRoot = `${home}/.claude/`
          if (absPath.startsWith(claudeRoot)) {
            userClaudeNav.actions.revealAndSelect(absPath)
          } else {
            nav.actions.revealAndSelect(absPath)
          }
          setFocusedColumn('files')
          return { ok: true }
        }
        // Stage 27 — scroll-to-and-select. Renderer-internal CustomEvent
        // matches the duo-tree-start-rename pattern: the editor /
        // canvas tabs subscribe and consume. v1 handles editor + text
        // and canvas + anchor; line / cross-target combinations land
        // when callers exercise them (Stage 27.5 carve-out).
        case 'selection:set': {
          window.dispatchEvent(
            new CustomEvent('duo-canvas-selection-set', { detail: action })
          )
          return { ok: true }
        }
        // Stage 27 — flip the global theme. Matches the titlebar toggle
        // and `duo theme <mode>`; persists via useTheme's localStorage.
        case 'theme:set': {
          theme.setMode(action.mode)
          return { ok: true }
        }
        // Stage 27 — focus the active terminal (or a specific tab when
        // data-tab-id is set). Mirrors ⌘\` "go to terminal" behaviour.
        case 'terminal:focus': {
          if (action.tabId) {
            const exists = tabs.some(t => t.id === action.tabId)
            if (!exists) {
              return { ok: false, error: `no terminal tab with id "${action.tabId}"` }
            }
            setActiveTabId(action.tabId)
          }
          setFocusedColumn('terminal')
          // BUG-054 — `setFocusedColumn` only flips the React state
          // that drives the focus *indicator* (orange glow on the
          // terminal pane). It does NOT call `term.focus()` on the
          // xterm instance, so keystrokes still go to whatever had
          // OS focus before. Dispatch a CustomEvent that the active
          // TerminalPane listens for and calls termRef.focus() —
          // matches the find-open / find-next CustomEvent pattern
          // used elsewhere. The setActiveTabId(action.tabId) above
          // also fires the existing isActive-change effect that
          // calls term.focus(), so for tab-targeted calls the
          // CustomEvent is belt-and-braces; for the bare
          // terminal:focus call (no tabId), the CustomEvent is the
          // only path.
          window.dispatchEvent(new CustomEvent('duo-terminal-focus'))
          return { ok: true }
        }
        // Stage 27 — emit a named event into the duo event bus. Main
        // owns the bus; we push via `window.electron.events.emit`. The
        // CLI streams subscribers (`duo events --follow`).
        case 'duo:event': {
          window.electron.events.emit({
            source: 'canvas',
            name: action.event,
            payload: action.payload
          })
          return { ok: true }
        }
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }, [activeTabId, pendingCwd, home, dispatchPostSpawnWrite, openFile, openFileSmart, nav.actions, theme, tabs])

  // ENH-094 (Sprint 5) — subscribe to playground actions emitted from
  // BROWSER-PANE pages (parallel to canvas-iframe pages, which dispatch
  // through PageTab → WorkingPane → onPlaygroundAction). Main parses +
  // applies trust gate; we just call the same handler. Defensive guard
  // against a stale preload that doesn't expose `onPlaygroundAction`
  // yet — preload doesn't HMR, so a renderer reload without an Electron
  // restart leaves the binding undefined.
  useEffect(() => {
    const subscribe = window.electron.browser.onPlaygroundAction
    if (typeof subscribe !== 'function') {
      console.warn('[App] window.electron.browser.onPlaygroundAction missing — preload likely stale; restart Electron to enable browser-pane playground actions.')
      return
    }
    return subscribe((action) => {
      void handlePlaygroundAction(action)
    })
  }, [handlePlaygroundAction])

  // Stage 11 § D33a — \u2318N opens a new editor tab in the navigator's CWD.
  // Auto-pick `untitled.md`, fall back to `untitled-2.md`, etc., to dodge
  // collisions with already-open tabs. (Disk collisions are surfaced when
  // the user commits a name that already exists.)
  const newMarkdownFile = useCallback(() => {
    const dir = nav.state.cwd
    const taken = new Set(fileTabs.map(t => t.path))
    let candidate = `${dir}/untitled.md`
    let n = 2
    while (taken.has(candidate)) {
      candidate = `${dir}/untitled-${n}.md`
      n++
    }
    const id = crypto.randomUUID()
    const title = candidate.slice(candidate.lastIndexOf('/') + 1)
    setFileTabs(prev => [
      ...prev,
      { id, type: 'editor', path: candidate, title, mime: 'text/markdown', isNew: true }
    ])
    setActiveWorking({ kind: 'file', id })
    setFocusedColumn('working')
  }, [nav.state.cwd, fileTabs])

  // ENH-169 (Sprint 20 / v0.7.7) — ⌘⇧N OR File → New Folder… OR
  // breadcrumb right-click "New folder here…" all route through
  // FileTree's existing inline-rename handleNewFolder via the
  // `duo-tree-new-folder-here` window event (subscribed by
  // FileTree, which owns pickUniquePath + mkdir + auto-expand +
  // refresh + setRenamingPath). One source of truth for the
  // creation flow; this callback just dispatches the event with
  // the target parent dir. Default parent = navigator's cwd.
  const newFolder = useCallback((parentPath?: string) => {
    const target = parentPath ?? nav.state.cwd
    window.dispatchEvent(new CustomEvent('duo-tree-new-folder-here', { detail: { parentPath: target } }))
  }, [nav.state.cwd])

  // ENH-169 (Sprint 20) — same event-dispatch pattern for "New file
  // here…" on the breadcrumb / File menu — they route through
  // FileTree's inline-rename handleNewFile (creates untitled.md +
  // flips into rename mode), distinct from ⌘N's existing
  // `newMarkdownFile` which opens an unsaved tab interstitial. The
  // intent: breadcrumb / menu paths prefer in-tree creation; ⌘N
  // preserves muscle memory for the inline-tab flow shipped Stage 11.
  const newFileInTree = useCallback((parentPath?: string) => {
    const target = parentPath ?? nav.state.cwd
    window.dispatchEvent(new CustomEvent('duo-tree-new-file-here', { detail: { parentPath: target } }))
  }, [nav.state.cwd])

  // ENH-169 (Sprint 20) — File menu New File… / New Folder… push
  // these channels when their menu items fire. Same callbacks the
  // ⌘N / ⌘⇧N chords use; native menu accelerators own the chords
  // at the app-menu level (electron/main.ts).
  useEffect(() => {
    // File → New File… uses the existing inline-tab interstitial
    // (newMarkdownFile) — preserves muscle memory for ⌘N from
    // Stage 11. File → New Folder… routes through FileTree's
    // inline-rename pattern via the newFolder helper above. Both
    // default to the navigator's current cwd.
    const offNew = window.electron.nav.onNewFileRequest(() => { newMarkdownFile() })
    const offFolder = window.electron.nav.onNewFolderRequest(() => { newFolder() })
    return () => { offNew(); offFolder() }
  }, [newMarkdownFile, newFolder])

  // ENH-173 (Sprint 20 / v0.7.7) — UnknownFilePreview's "Navigate
  // here" button (rendered when the tab's path is a directory) fires
  // a CustomEvent that we route to nav.actions.navigateTo + close
  // the now-redundant dead-end tab. Closes the dead-end loop where
  // `duo view <folder>` lands users in the no-preview canvas.
  useEffect(() => {
    const onNavHere = (e: Event) => {
      const ce = e as CustomEvent<{ path: string; tabId: string }>
      const targetPath = ce.detail?.path
      const rawTabId = ce.detail?.tabId
      if (!targetPath || !rawTabId) return
      // WorkingPane wraps file-tab ids with an `f:` prefix when it
      // hands them to leaf renderers (see `stringifyFileId` in
      // WorkingPane.tsx). Our App-level fileTabs[] uses the raw
      // UUID without the prefix, so strip it before filtering.
      const tabId = rawTabId.startsWith('f:') ? rawTabId.slice(2) : rawTabId
      nav.actions.navigateTo(targetPath)
      // Close the canvas tab we just made redundant.
      setFileTabs(prev => prev.filter(t => t.id !== tabId))
      setActiveWorking(prev => {
        if (prev.kind === 'file' && prev.id === tabId) {
          // The closed tab WAS active — fall back to the browser pane
          // (the default ActiveWorking shape when no file tab is active).
          return { kind: 'browser' }
        }
        return prev
      })
      // Surface the reveal chip so the user knows the navigator moved
      // (consistent with the `duo reveal` CLI flow).
      setRevealChip(targetPath)
    }
    window.addEventListener('duo-navigate-here', onNavHere)
    return () => window.removeEventListener('duo-navigate-here', onNavHere)
  }, [nav.actions])

  // ENH-169 (Sprint 20) — breadcrumb right-click context menu.
  // Surfaced on either an empty area of the breadcrumb (target =
  // current cwd) OR on a specific segment button (target = that
  // segment's resolved path). Reuses the same window.electron.menu.
  // popup primitive FileTree uses, with a small folder-scoped
  // menu. The "new file" / "new folder" entries route through the
  // same callbacks ⌘N / ⌘⇧N use, but pre-set the navigator's cwd
  // to the right-clicked segment first so the new entry lands in
  // the right folder.
  const onBreadcrumbContextMenu = useCallback(async (folderPath: string, clientX: number, clientY: number) => {
    const items: { id: string; label: string }[] = [
      { id: 'new-file', label: 'New file here…' },
      { id: 'new-folder', label: 'New folder here…' }
    ]
    items.push({ id: 'sep1', label: '-' } as never) // separator placeholder; converted below
    items.push({ id: 'reveal-in-finder', label: 'Reveal in Finder' })
    items.push({ id: 'open-terminal-here', label: 'Open terminal here' })

    // Convert separator placeholder to the menu primitive's shape.
    type MenuItem = { id: string; label?: string; type?: 'separator' }
    const template: MenuItem[] = items.map(it =>
      it.id === 'sep1' ? { id: 'sep1', type: 'separator' } : { id: it.id, label: it.label }
    )

    const result = await window.electron.menu.popup({ items: template, x: clientX, y: clientY })
    if (!result.chosenId) return
    switch (result.chosenId) {
      case 'new-file': {
        // Breadcrumb path uses FileTree's inline-rename creation
        // (untitled.md + rename mode in-tree), scoped to the
        // right-clicked segment. Pass parent explicitly — no need
        // to navigate first.
        newFileInTree(folderPath)
        return
      }
      case 'new-folder': {
        newFolder(folderPath)
        return
      }
      case 'reveal-in-finder': {
        await window.electron.files.revealInFinder(folderPath)
        return
      }
      case 'open-terminal-here': {
        openTerminalHere(folderPath)
        return
      }
    }
  }, [newFileInTree, newFolder, openTerminalHere])

  // Finalize a new-file tab: write the seed bytes at the resolved path,
  // then update tab metadata so subsequent autosaves write through.
  //
  // Stage 17a — the audible from kickoff: ⌘N opens the new-file
  // interstitial; the typed extension dictates which canvas mounts.
  // .md (or no extension, defaulting to .md via the interstitial) keeps
  // the markdown editor; .html / .htm swaps the tab to `html-canvas`
  // and seeds the file with boilerplate so the iframe has something
  // to render. Other extensions fall through to whatever classifyFile
  // returns (image, pdf, unknown preview) — those surfaces already
  // expect bytes on disk so an empty seed is fine.
  const onCommitNewFile = useCallback(async (id: string, resolvedPath: string, title: string) => {
    const { type, mime } = classifyFile(resolvedPath)
    let seed: Uint8Array
    if (type === 'page') {
      seed = encodeUtf8(htmlBoilerplate(title.replace(/\.[^.]+$/, '')))
    } else if (type === 'json') {
      // ENH-110 — seed JSON-family files with a parseable empty doc so
      // the JsonView mounts cleanly into tree mode. YAML gets a
      // header comment; JSON gets `{}`.
      const ext = resolvedPath.includes('.') ? resolvedPath.slice(resolvedPath.lastIndexOf('.') + 1).toLowerCase() : ''
      const yamlSeed = '# YAML document\n'
      const jsonSeed = '{}\n'
      seed = encodeUtf8(ext === 'yml' || ext === 'yaml' ? yamlSeed : jsonSeed)
    } else {
      seed = new Uint8Array()
    }
    try {
      await window.electron.files.write(resolvedPath, seed)
    } catch (err) {
      console.error('[Duo] failed to create new file:', err)
      return
    }
    setFileTabs(prev => prev.map(t =>
      t.id === id
        ? { ...t, path: resolvedPath, title, type, mime, isNew: false }
        : t
    ))
  }, [])

  // Called by MarkdownPreview when the user clicks an internal link.
  // Routes through openFileSmart — HTML lands in the browser pane by
  // default (ENH-156); non-HTML routes via the classifier.
  const onOpenMarkdown = useCallback((path: string) => {
    const name = path.slice(path.lastIndexOf('/') + 1) || path
    void openFileSmart(path, name)
  }, [openFileSmart])

  // ENH-179 (Sprint 20 / v0.7.7) — pop the most-recently-closed tab
  // off the ring and restore. ⌘Z fires this via globalShortcuts (the
  // chord is gated on inAnyTextInput, so text undo still wins inside
  // contentEditables / inputs / dialogs). No-op when the ring is
  // empty.
  const reopenLastClosedTab = useCallback(() => {
    const ring = closedTabsRef.current
    const entry = ring.pop()
    if (!entry) return
    if (entry.kind === 'file') {
      const name = entry.path.slice(entry.path.lastIndexOf('/') + 1) || entry.path
      void openFileSmart(entry.path, name)
    } else if (entry.kind === 'browser') {
      void window.electron.browser.addTab(entry.url).then(async () => {
        // After the new tab lands, switch to it so the user actually
        // sees the restored URL. BrowserManager.addTab auto-activates,
        // but bring the working pane in front for the file/browser
        // mixed close case.
        setActiveWorking({ kind: 'browser' })
        setFocusedColumn('working')
      })
    } else if (entry.kind === 'terminal') {
      const tab = makeTab(entry.cwd, entry.ptyKind, home)
      setTabs(prev => [...prev, tab])
      setActiveTabId(tab.id)
      setFocusedColumn('terminal')
      if (entry.ptyKind === 'claude') {
        void dispatchPostSpawnWrite(tab.id, 'claude')
      }
    }
  }, [openFileSmart, home, dispatchPostSpawnWrite])

  // Stage 10 Phase 6: `duo reveal <path>` from the CLI. Move the navigator
  // to that path and surface a dismissible chip.
  useEffect(() => {
    return window.electron.nav.onReveal((p) => {
      nav.actions.navigateTo(p)
      setRevealChip(p)
    })
  }, [nav.actions])

  // Auto-dismiss the chip after 4 seconds.
  useEffect(() => {
    if (!revealChip) return
    const h = setTimeout(() => setRevealChip(null), 4000)
    return () => clearTimeout(h)
  }, [revealChip])

  // Stage 10 Phase 6: `duo view <path>` from the CLI. Open as a file tab.
  // Routes through openFileSmart — HTML lands in the browser pane by
  // default (ENH-156 verb-driven); non-HTML routes via the classifier.
  // `mode` carries the CLI flag override (`--canvas` / `--browser`).
  useEffect(() => {
    return window.electron.nav.onView((p, mode) => {
      const name = p.slice(p.lastIndexOf('/') + 1) || p
      void openFileSmart(p, name, mode)
    })
  }, [openFileSmart])

  // FOLLOWUP-020 — `duo close-tab` from the CLI. Closes the focused
  // working-pane tab (file/canvas/viewer or browser-mode HTML tab).
  // Mirrors the ⌘W chord on the working strip — same pinned-tab gate
  // applies because we call into the same closeFileTab / browser.closeTab
  // paths the keystroke uses.
  useEffect(() => {
    return window.electron.nav.onCloseActiveWorkingTab(() => {
      if (activeWorking.kind === 'file') {
        const ft = fileTabs.find(f => f.id === activeWorking.id)
        if (ft && pins.some(p => p.kind === 'file' && p.ref === ft.path)) {
          void (async () => {
            const result = await window.electron.dialog.confirm({
              title: `Close pinned tab "${ft.title}"?`,
              message: 'This tab is pinned. Closing it removes the pin and the tab.',
              buttons: ['Cancel', 'Close tab'],
              defaultId: 1,
              cancelId: 0,
              type: 'warning'
            })
            if (result.response === 1) closeFileTab(ft.id)
          })()
          return
        }
        closeFileTab(activeWorking.id)
      } else if (activeWorking.kind === 'browser') {
        void (async () => {
          const btabs = await window.electron.browser.getTabs()
          const active = btabs.find(t => t.isActive)
          if (!active) return
          if (active.url && pins.some(p => p.kind === 'browser' && p.ref === active.url)) {
            const label = active.title || active.url
            const result = await window.electron.dialog.confirm({
              title: `Close pinned tab "${label}"?`,
              message: 'This tab is pinned. Closing it removes the pin and the tab.',
              buttons: ['Cancel', 'Close tab'],
              defaultId: 1,
              cancelId: 0,
              type: 'warning'
            })
            if (result.response !== 1) return
          }
          await window.electron.browser.closeTab(active.id)
        })()
      }
    })
  }, [activeWorking, fileTabs, pins, closeFileTab])

  // FOLLOWUP-025 — File → Clone… modal trigger. Fires from the native
  // File menu entry's IPC push. ⌘⇧K hits the same modal via the
  // keyboard shortcut dispatch (useKeyboardShortcuts § openCloneModal).
  // v2: payload may carry a `path` to override the default parent
  // directory (right-click → "Clone GitHub repo here…" passes the
  // right-clicked folder). Falls back to Navigator's cwd, then to
  // ~/Documents per CloneModal's internal default.
  const [cloneModalDefaultParent, setCloneModalDefaultParent] = useState<string | null>(null)
  useEffect(() => {
    return window.electron.nav.onOpenCloneModal((payload?: { path?: string }) => {
      setCloneModalDefaultParent(payload?.path ?? null)
      setCloneModalOpen(true)
    })
  }, [])

  // FOLLOWUP-020 — `duo close-terminal-tab [<n>]` from the CLI.
  // n omitted → close the focused terminal tab; n supplied (1-indexed)
  // → close that specific tab. Mirrors the ⌘W chord when focusedColumn
  // === 'terminal'.
  useEffect(() => {
    return window.electron.nav.onCloseTerminalTab((n) => {
      let targetId: string
      if (typeof n === 'number') {
        // n is 1-indexed per the CLI verb's contract.
        const idx = n - 1
        if (idx < 0 || idx >= tabs.length) return
        targetId = tabs[idx].id
      } else {
        targetId = activeTabId
      }
      closeTab(targetId)
    })
  }, [tabs, activeTabId, closeTab])

  // Stage 11: `duo edit <path>` from the CLI. ENH-156 — verb-driven
  // mode: the CLI passes `mode: 'canvas'` for HTML by default (the new
  // semantic of `duo edit` is "edit the source"), or `mode: 'browser'`
  // on `--browser` override. Non-HTML files route via the classifier
  // (`.md` → TipTap editor; image → viewer) regardless of mode.
  //
  // BUG-106 (Sprint 10) — pre-flight existence so `duo edit
  // <non-existent-path>` doesn't ENOENT in the editor. Pre-create
  // empty bytes for the path, mirroring ⌘N's onCommitNewFile pre-write.
  // files.write mkdir-p's the parent dir (so `duo edit
  // /new/dir/Foo.md` creates `new/dir/` automatically — symmetric
  // with the wikilink-create path in ENH-108). The classifier
  // determines whether to seed with an HTML boilerplate or empty
  // bytes, matching the ⌘N seed convention.
  useEffect(() => {
    return window.electron.nav.onEdit(async (p, mode) => {
      const name = p.slice(p.lastIndexOf('/') + 1) || p
      try {
        const exists = await window.electron.files.exists(p)
        if (!exists) {
          const { type } = classifyFile(p)
          const seed = type === 'page'
            ? encodeUtf8(htmlBoilerplate(name.replace(/\.[^.]+$/, '')))
            : new Uint8Array()
          await window.electron.files.write(p, seed)
        }
      } catch (err) {
        // Don't block the open on pre-flight failure — the editor's
        // existing error path will surface a useful message if the
        // problem persists at read time.
        console.warn('[BUG-106 pre-flight failed]', { path: p, err })
      }
      void openFileSmart(p, name, mode)
    })
  }, [openFileSmart])

  // Sprint 6 BUG-081 — bridge the canvas right-click "Comment" menu
  // item from main → renderer. Main fires PAGE_COMMENT_REQUEST when
  // the user picks Comment; we re-broadcast as a window CustomEvent
  // so the active PageTab's listener (also driven by ⌘⌥M and the
  // toolbar Comment button) handles it identically.
  useEffect(() => {
    return window.electron.canvas.onCommentRequest(() => {
      window.dispatchEvent(new CustomEvent('duo-start-comment', { detail: { pane: 'working' } }))
    })
  }, [])

  // Sprint 6 BUG-084 — ⌘R reloads the active browser tab when the
  // working pane shows a browser tab. Gated here (rather than at the
  // matcher) so terminal / editor / canvas focus → ⌘R still no-ops.
  // No reload chord on editor / canvas — that would lose unsaved
  // local-file state.
  useEffect(() => {
    const handler = () => {
      if (activeWorking.kind !== 'browser') return
      window.electron.browser.reload()
    }
    window.addEventListener('duo-reload-active-browser', handler)
    return () => window.removeEventListener('duo-reload-active-browser', handler)
  }, [activeWorking.kind])

  // ENH-080 — toggle the tab-search palette when ⌘⇧A fires.
  useEffect(() => {
    const handler = () => setTabSearchOpen((open) => !open)
    window.addEventListener('duo-open-tab-search', handler)
    return () => window.removeEventListener('duo-open-tab-search', handler)
  }, [])

  // ENH-080 walk-1 fix — mute the browser WebContentsView(s) while the
  // palette is open. Without this the WCV composites over the renderer
  // overlay (the palette's z-50 doesn't beat the WCV — that's why
  // setOverlayMuted exists for context menus too). Symptom pre-fix:
  // user saw the dim backdrop bleeding into pane edges but the palette
  // body was hidden behind the still-visible page content.
  //
  // Sprint 11 ENH-096 B.4 — VaultQuickSwitcher (⌘O) gets the same
  // treatment. Either overlay open → mute WCVs.
  useEffect(() => {
    window.electron.browser.setOverlayMuted(tabSearchOpen || vaultQuickSwitcherOpen)
  }, [tabSearchOpen, vaultQuickSwitcherOpen])

  // Sprint 11 ENH-096 B.4 — vault index for the ⌘O quick switcher.
  // Keyed off the active file's path; recomputes only on vault-root
  // change (so navigating within a vault doesn't re-walk). When the
  // active surface isn't a file tab, falls back to null which the
  // overlay handles with the "open a file inside a vault" hint.
  const vaultIndexForSwitcher = useVaultIndex((() => {
    if (activeWorking.kind !== 'file') return null
    const tab = fileTabs.find((t) => t.id === activeWorking.id)
    return tab?.path ?? null
  })())

  // ENH-096 (B1) — Wikilink resolver. The WikilinkDecorations plugin
  // fires `duo-wikilink-open` on cmd+click; we walk up from the active
  // file's directory to find an `.obsidian/` (vault root), then search
  // the vault for a file whose basename (without extension) matches
  // the target. Opens via openFileSmart. Falls back to navigator CWD
  // if no `.obsidian/` ancestor exists.
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent<{ target: string }>).detail
      console.debug('[ENH-096 receive]', detail)
      const wikilinkTarget = detail?.target?.trim()
      if (!wikilinkTarget) return
      // Strip block-ref / heading suffix; v1 doesn't resolve those —
      // we just open the base file. Obsidian-compat in a future stage.
      const cleanTarget = wikilinkTarget.replace(/[#^].*$/, '').trim()
      // Use the active file tab's path to find the vault root, falling
      // back to the navigator CWD.
      const activeFile = activeWorking.kind === 'file'
        ? fileTabs.find((t) => t.id === activeWorking.id)
        : null
      const startPath = activeFile?.path ?? null
      const vaultRoot = await findVaultRoot(startPath)
      if (!vaultRoot) {
        console.warn('[ENH-096] No vault root found; cannot resolve wikilink:', wikilinkTarget)
        return
      }
      const resolved = await resolveWikilinkInVault(vaultRoot, cleanTarget)
      if (!resolved) {
        // Sprint 10 ENH-108 — Obsidian-parity create-on-cmd+click.
        // No existing file matched, so create one at the requested
        // path within the vault root and open it. files.write()
        // mkdir-p's the parent (so [[notes/Foo]] creates notes/ on
        // demand). Empty seed mirrors the ⌘N markdown new-file flow.
        const createPath = buildWikilinkCreatePath(vaultRoot, cleanTarget)
        try {
          await window.electron.files.write(createPath, new Uint8Array())
        } catch (err) {
          console.warn(
            '[ENH-108] Failed to create wikilink target:',
            wikilinkTarget,
            'createPath:', createPath,
            'err:', err
          )
          return
        }
        const newName = createPath.slice(createPath.lastIndexOf('/') + 1) || createPath
        void openFileSmart(createPath, newName)
        return
      }
      const name = resolved.slice(resolved.lastIndexOf('/') + 1) || resolved
      void openFileSmart(resolved, name)
    }
    window.addEventListener('duo-wikilink-open', handler)
    return () => window.removeEventListener('duo-wikilink-open', handler)
  }, [activeWorking, fileTabs, openFileSmart])

  // ENH-080 — derive the search entries from open tabs. Includes both
  // file tabs (markdown editor / canvas / image / pdf) and browser
  // tabs. Aux tabs (split-view) are tagged `inAux: true` and labeled
  // with a "Split" badge in the palette UI. Walk-1 fix: aux browser
  // tabs were filtered out entirely pre-fix; aux file tabs were
  // included but indistinguishable from main-pane file tabs.
  const tabSearchEntries: TabSearchEntry[] = useMemo(() => {
    const auxFilePaths = new Set(auxState?.paths ?? [])
    const fileEntries: TabSearchEntry[] = fileTabs.map((t) => ({
      id: `f:${t.id}`,
      title: t.title,
      subtitle: t.path,
      kind: t.type,
      inAux: auxFilePaths.has(t.path)
    }))
    const browserEntries: TabSearchEntry[] = browserTabs.map((t) => ({
      id: `b:${t.id}`,
      title: t.title || t.url,
      subtitle: t.url,
      kind: 'browser' as const,
      inAux: t.inAux
    }))
    return [...fileEntries, ...browserEntries]
  }, [fileTabs, browserTabs, auxState])

  // Stage 19c D27 — `duo new-tab` from the CLI. The renderer is the
  // authoritative tab state, so we add the tab here and reply with
  // {id, kind, cwd, title} for the socket to return. Defaults: kind →
  // persisted last-kind (D28); cwd → navigator pending CWD (D25); cmd →
  // none (kind-default spawn flow runs).
  useEffect(() => {
    return window.electron.terminal.onNewTabRequest((req) => {
      const reply = (result: NewTabResult) => window.electron.terminal.replyNewTab(result)
      void (async () => {
        try {
          const kind = req.kind ?? lastTabKind
          // ENH-187 — when the caller didn't pass --cwd, mirror the
          // chord's behavior: inherit the focused terminal's live shell
          // cwd, falling back to its launch cwd, then to pendingCwd.
          let cwd: string
          if (req.cwd && req.cwd.length > 0) {
            cwd = req.cwd
          } else {
            cwd = pendingCwd
            if (activeTab) {
              const liveCwd = await window.electron.pty.liveCwd(activeTab.id)
              cwd = liveCwd ?? activeTab.cwd ?? pendingCwd
            }
          }
          const tab = makeTab(cwd, kind, home)
          setTabs(prev => [...prev, tab])
          setActiveTabId(tab.id)
          if (req.kind !== undefined) {
            // Explicit --kind flag → also bump persisted last-kind so
            // subsequent flagless calls follow the agent's recent choice.
            setLastTabKind(kind)
            saveLastTabKind(kind)
          }
          void dispatchPostSpawnWrite(tab.id, kind, req.cmd)
          reply({ reqId: req.reqId, ok: true, id: tab.id, kind, cwd, title: tab.title })
        } catch (err) {
          reply({
            reqId: req.reqId,
            ok: false,
            error: err instanceof Error ? err.message : String(err)
          })
        }
      })()
    })
  }, [pendingCwd, lastTabKind, home, dispatchPostSpawnWrite, activeTab])

  // ── Cozy mode (Stage 9) ────────────────────────────────────────────────────

  // Listen for View → Cozy mode menu clicks. Flip the active tab's cozy
  // state, update the "remember last choice" default, persist, and push
  // the new value back so the menu checkmark tracks it.
  //
  // Guard the electron.cozy API: in dev, preload only loads once per window
  // creation. A stale preload (from before Stage 9) has no `cozy` surface,
  // so the effect would throw and crash the component tree. Silently
  // no-oping here means cozy is just inert until Electron is restarted.
  useEffect(() => {
    if (!window.electron.cozy) return
    return window.electron.cozy.onToggle(() => {
      if (!activeTab) return
      const current = cozyByTab[activeTab.id] ?? cozyDefault
      const next = !current
      setCozyByTab(prev => {
        const updated = { ...prev, [activeTab.id]: next }
        try { localStorage.setItem(COZY_BY_TAB_KEY, JSON.stringify(updated)) } catch { /* quota */ }
        return updated
      })
      setCozyDefault(next)
      try { localStorage.setItem(COZY_LAST_KEY, next ? '1' : '0') } catch { /* quota */ }
      window.electron.cozy?.pushState(next)
    })
  }, [activeTab, cozyByTab, cozyDefault])

  // Keep the menu checkmark aligned with the active tab whenever it changes.
  useEffect(() => {
    window.electron.cozy?.pushState(activeCozy)
  }, [activeCozy])

  // Drop stale cozy + font-bump entries when tabs close so the persisted
  // maps can't grow unbounded across sessions.
  //
  // ENH-191 P4 (seam 3b) — prune via the pure pruneByTab helper against THIS
  // window's live tab ids, writing to the per-window key. Because each window
  // owns its OWN byTab map + key, this prune structurally cannot delete
  // another window's entries (the C13 fix — proven by perTabPrune.test.ts).
  useEffect(() => {
    const liveIds = new Set(tabs.map(t => t.id))
    setCozyByTab(prev => {
      const pruned = pruneByTab(prev, liveIds)
      if (Object.keys(pruned).length === Object.keys(prev).length) return prev
      try { localStorage.setItem(COZY_BY_TAB_KEY, JSON.stringify(pruned)) } catch { /* quota */ }
      return pruned
    })
    setFontBumpByTab(prev => {
      const pruned = pruneByTab(prev, liveIds)
      if (Object.keys(pruned).length === Object.keys(prev).length) return prev
      try { localStorage.setItem(FONT_BUMP_BY_TAB_KEY, JSON.stringify(pruned)) } catch { /* quota */ }
      return pruned
    })
  }, [tabs])

  // ⌘` — cycle focus between the terminal column and the working pane.
  // Files column is a toggle with ⌘B and intentionally not in this cycle.
  //
  // BUG-004 fix: this MUST move actual OS-level focus, not just flip the
  // React `focusedColumn` state. The renderer-side focus calls below only
  // work because the menu accelerator's main-process click handler has
  // already called `mainWindow.webContents.focus()` to reclaim OS focus
  // from any active WebContentsView (see electron/main.ts § installAppMenu).
  //
  // Per destination:
  //   - terminal → focus the visible xterm helper textarea (so PTY
  //     keystrokes route in)
  //   - working+browser → focusActive() on the BrowserManager (returns
  //     OS focus to the active WebContentsView's webContents)
  //   - working+editor (or any non-browser file tab) → focus the
  //     contenteditable prose, falling back to the wrapper. The wrapper
  //     alone has tabIndex=0 but isn't a typing target — typing into
  //     a focused tabIndex wrapper is a no-op for the editor.
  // ENH-102 (Sprint 9) — ⌘⇧⌫ deletes the active working-pane file
  // (move-to-trash with confirm). Mirrors the right-click → Move to
  // Trash flow on the WorkingTabStrip but adds the confirm dialog
  // (the strip's own dialog lives inside its handler). No-op when
  // active surface is a browser tab or terminal.
  const deleteCurrentFile = useCallback(async () => {
    if (activeWorking.kind !== 'file') {
      // No-op for browser / terminal panes. ⌘W already exists for
      // tab close; the chord is specifically for FILE deletion.
      console.info('[ENH-102] no-op: active surface is not a file tab')
      return
    }
    const tab = fileTabs.find(t => t.id === activeWorking.id)
    if (!tab) return
    const result = await window.electron.dialog.confirm({
      title: `Move "${tab.title}" to Trash?`,
      message: 'This file will be moved to the macOS Trash. You can recover it from Finder.',
      buttons: ['Cancel', 'Move to Trash'],
      defaultId: 1,
      cancelId: 0,
      type: 'warning'
    })
    if (result.response !== 1) return
    // Sprint 7 rev6 follow-up applied here too — if the file's
    // already gone, the user's intent is still "close this tab,"
    // so ENOENT lands as a soft-success and we proceed to close.
    try {
      await window.electron.files.trash(tab.path)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!/doesn['’]?t exist|ENOENT|no such file/i.test(msg)) {
        window.alert(`Move to Trash failed: ${msg}`)
        return
      }
    }
    closeFileTab(tab.id)
  }, [activeWorking, fileTabs, closeFileTab])

  // ENH-098 (Sprint 9) — pane-jump focus action. ⌘⌥L/;/' chord set
  // and the `duo focus-pane` CLI verb both route here. Distinct from
  // togglePaneFocus (⌘`) which CYCLES; this function jumps DIRECTLY
  // to the named target.
  //
  // Implementation per target:
  //   - 'terminal'  : same shape as togglePaneFocus's terminal branch.
  //   - 'main'      : focus the main working pane (NOT aux). For
  //                   browser tabs this is browser.focusActive(); for
  //                   file tabs (markdown / canvas / image / pdf) it's
  //                   the wrapper or its contenteditable.
  //   - 'aux'       : focus the split-view aux pane. No-op if neither
  //                   a file aux nor a browser aux is open. For file
  //                   aux: focus its contenteditable. For browser
  //                   aux: route the active WCV's focus (we do NOT
  //                   have a dedicated focusAux IPC today; the WCV
  //                   inside the aux slot picks up keyboard focus
  //                   when its host element is focused).
  const focusPane = useCallback((target: 'terminal' | 'main' | 'aux') => {
    if (target === 'terminal') {
      setFocusedColumn('terminal')
      window.electron.keyboard.reclaimFocus()
      queueMicrotask(() => {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          '.xterm-host:not([style*="display: none"]) .xterm-helper-textarea'
        )
        textarea?.focus()
      })
      return
    }
    if (target === 'main') {
      setFocusedColumn('working')
      queueMicrotask(() => {
        if (activeWorking.kind === 'browser') {
          window.electron.browser.focusActive()
          return
        }
        // ENH-098 (Sprint 9 walk-2 fix). Pre-fix used
        // `document.querySelector('[data-duo-workingpane]')` — picks
        // the FIRST in DOM order. But BUG-046 keeps every file-tab
        // renderer mounted (display-toggled), so when the user has
        // multiple file tabs open the selector hits the FIRST tab's
        // editor (often invisible) instead of the active one. .focus()
        // on a `display:none` ancestor's contenteditable silently
        // fails — DOM focus stays where it was (xterm), keyboard
        // caret never moves. Walk-1 owner: "focus shifts to main pane,
        // but carat stays on the terminal." Fix: filter by visibility
        // (offsetParent !== null) AND exclude any editor inside the
        // aux subtree.
        const ce = findVisibleWorkingPaneCE('main')
        if (ce) ce.focus()
      })
      return
    }
    // target === 'aux'
    const hasFileAux = !!(auxState && auxState.paths.length > 0)
    const hasBrowserAux = !!auxBrowserTab
    if (!hasFileAux && !hasBrowserAux) {
      // No-op when split view is closed. Surface a console hint so
      // a user wondering why nothing happened can find an explanation.
      // (Toast/banner UI deferred — out of scope for this chord ship.)
      console.info('[ENH-098] focusAux: split view is not open')
      return
    }
    setFocusedColumn('working')
    queueMicrotask(() => {
      if (hasBrowserAux) {
        // Aux holds a browser tab. We don't have a dedicated
        // focusAux IPC today — focusActive() targets the active
        // MAIN browser tab, not the aux WCV. Tracked as a
        // FOLLOWUP for Phase 3c-iv (browser-aux WCV focus IPC);
        // for now best-effort fall through to no-op.
        // TODO: file follow-up to add an aux-targeting browser
        // focus IPC; until then, keyboard activation of the aux
        // browser pane requires the user to click into it.
        console.info('[ENH-098] focusAux: aux holds a browser tab; programmatic focus of the aux WCV is not yet supported (FOLLOWUP needed). Click into the aux pane to focus.')
        return
      }
      // File aux — find the contenteditable scoped to the aux
      // subtree (the new [data-duo-workingpane-aux] marker added
      // in WorkingPane.tsx).
      const ce = findVisibleWorkingPaneCE('aux')
      if (ce) ce.focus()
      else console.info('[ENH-098] focusAux: no contenteditable found inside aux subtree')
    })
  }, [activeWorking, auxState, auxBrowserTab, setFocusedColumn])

  const togglePaneFocus = useCallback(() => {
    // BUG-048 v3 — read direction from the REF, which holds the
    // user's last-deliberate column choice (untouched by the xterm
    // focus listener's silent state updates). Main no longer fires a
    // pre-IPC focus reclaim, so the ref is also fresh from the
    // most recent BROWSER_FOCUS_GAINED / click / etc. when the toggle
    // arrives.
    const prev = focusedColumnRef.current
    const next = prev === 'working' ? 'terminal' : 'working'
    setFocusedColumn(next)
    if (next === 'terminal') {
      // Need OS focus on the renderer to focus xterm. Ask main now;
      // the reclaim's resulting xterm-focus event will land AFTER
      // we've committed `next` to state + ref, so the silent setter's
      // re-set is idempotent.
      window.electron.keyboard.reclaimFocus()
    }
    queueMicrotask(() => {
      if (next === 'terminal') {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          '.xterm-host:not([style*="display: none"]) .xterm-helper-textarea'
        )
        textarea?.focus()
      } else if (activeWorking.kind === 'browser') {
        window.electron.browser.focusActive()
      } else {
        const wrapper = document.querySelector<HTMLElement>('[data-duo-workingpane]')
        if (!wrapper) return
        // Editor tab: prose is `.ProseMirror[contenteditable=true]`.
        // Other file types (image / pdf / unknown preview) have no
        // contenteditable; fall back to focusing the wrapper so arrow
        // keys can scroll the pane.
        const ce = wrapper.querySelector<HTMLElement>('[contenteditable="true"]')
        if (ce) ce.focus()
        else wrapper.focus()
      }
    })
  }, [activeWorking, setFocusedColumn])

  // Sprint 3 Phase 3b + 3c-iii — Split View entry points.
  //
  // splitViewMoveTabByPath is the inner mutation primitive shared by
  // every "move/open in split view" surface (chord, right-click on
  // tab, right-click on FileTree row, right-click on PinnedNav row).
  // Mirrors the workingAux.onOpen IPC handler.
  //
  // SWAP semantics (Sprint 3 Phase 3b owner clarification, 2026-05-03
  // afternoon): when aux already holds a DIFFERENT path, that existing
  // aux content is PROMOTED back to main as a new file tab — NOT
  // discarded. The new path takes the aux slot. Single-source-of-truth
  // still holds (the new path drops from main fileTabs before landing
  // in aux), but the OLD aux path doesn't disappear; it lives on in
  // main. This is the natural "swap" gesture: aux ↔ main exchange,
  // not aux replace + main untouched.
  //
  // Phase 3c-iii dirty-replace gate (v0.6.4): when the swap would
  // promote a dirty aux back to main, the editor unmounts in aux
  // and remounts as a fresh main tab — losing unsaved edits during
  // the pane move (the editor reloads from disk on remount). v1
  // dialog has Discard / Cancel — no Save button (saves are per-
  // editor + async; the user can save manually first if they want
  // to keep the work). Discard → proceed (loses unsaved aux work);
  // Cancel → bail. Same path being moved INTO aux is a no-op below.
  // Empty aux (paths.length === 0 / null) goes straight to silent
  // open with no swap (no existing aux to promote).
  const splitViewMoveTabByPath = useCallback(async (path: string) => {
    // BUG-093 instrumentation (v0.6.7) — structured trace at every
    // decision point so the next renderer crash during a split-view
    // move leaves a forensic breadcrumb in the console BEFORE the
    // ErrorBoundary catches the throw. Each entry tags itself with
    // `[BUG-093]` so it's grep-able from a captured devtools log.
    // Cheap when no crash happens (one console.log per move); the
    // logs let us tell exactly which step preceded the error when
    // it does.
    // eslint-disable-next-line no-console
    console.log('[BUG-093] splitViewMoveTabByPath ENTRY', {
      path,
      auxState,
      dirtyCount: dirtyPaths.size,
      fileTabsCount: fileTabs.length
    })
    // Sprint 7 Phase 3c — file-aux and browser-aux are mutually
    // exclusive. If a browser tab is currently pinned, release it
    // back to main first so the file move lands in a clean slot.
    if (auxBrowserTab) {
      try {
        await window.electron.browser.releaseAuxTab()
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[Phase 3c] releaseAuxTab failed during file-aux move:', err)
      }
      setAuxBrowserTab(null)
    }
    if (auxState && auxState.paths.includes(path)) {
      // eslint-disable-next-line no-console
      console.log('[BUG-093] no-op: path already in aux')
      return
    }
    // Capture the existing aux path BEFORE any mutations so the swap
    // logic below can promote it back to main.
    const existingAuxPath = auxState && auxState.paths.length > 0
      ? (auxState.paths[auxState.activeIndex] ?? auxState.paths[0])
      : null
    // Phase 3c-iii dirty-replace gate. Fires when aux is currently
    // holding a different path AND that path is dirty (the swap will
    // unmount its editor, losing unsaved edits during the pane move).
    if (existingAuxPath && dirtyPaths.has(existingAuxPath)) {
      // eslint-disable-next-line no-console
      console.log('[BUG-093] dirty-replace gate firing', { existingAuxPath })
      const filename = existingAuxPath.split('/').pop() ?? existingAuxPath
      const newFilename = path.split('/').pop() ?? path
      const result = await window.electron.dialog.confirm({
        title: `"${filename}" has unsaved changes`,
        message: `Moving "${newFilename}" into Split View will swap "${filename}" back into main, but the editor unmounts during the pane swap and unsaved edits will be lost. Save "${filename}" first if you want to keep them.`,
        buttons: ['Cancel', 'Discard changes'],
        defaultId: 0,
        cancelId: 0,
        type: 'warning'
      })
      if (result.response !== 1) {
        // eslint-disable-next-line no-console
        console.log('[BUG-093] dirty-replace gate CANCELLED')
        return
      }
      // Discard chosen — clear the dirty flag for the path being
      // remounted as a fresh main tab. The editor's in-memory dirty
      // state resets to clean on the unmount/remount cycle anyway;
      // this just keeps the renderer's path-keyed dirty registry in
      // sync.
      setDirtyPaths(prev => {
        if (!prev.has(existingAuxPath)) return prev
        const next = new Set(prev)
        next.delete(existingAuxPath)
        return next
      })
    }
    // eslint-disable-next-line no-console
    console.log('[BUG-093] beginning swap', { existingAuxPath, movingIn: path })
    // Drop the new path from main fileTabs (single-source-of-truth).
    setFileTabs(prev => prev.filter(t => t.path !== path))
    // Promote the existing aux path back to main as a new file tab
    // (the swap's other half). Skip when aux was empty.
    let promotedId: string | null = null
    if (existingAuxPath) {
      const { type, mime } = classifyFile(existingAuxPath)
      promotedId = `f:${crypto.randomUUID()}`
      const title = existingAuxPath.split('/').pop() ?? existingAuxPath
      setFileTabs(curr => [...curr, { id: promotedId!, type, path: existingAuxPath, title, mime }])
    }
    // If the moved-IN path was the active main tab, swap activeWorking
    // to the newly-promoted main tab (keeps focus on file work — falling
    // back to browser would be surprising when there's literally a fresh
    // file tab right there). When aux was empty there's no promote, so
    // fall back to browser as before.
    setActiveWorking(prev => {
      if (prev.kind === 'file') {
        const wasMoved = fileTabs.find(t => t.id === prev.id && t.path === path)
        if (wasMoved) {
          return promotedId ? { kind: 'file', id: promotedId } : { kind: 'browser' }
        }
      }
      return prev
    })
    setAuxState({
      paths: [path],
      activeIndex: 0,
      // ENH-126 — opening a file in split view always snaps the inner
      // main/aux divider to 50/50. Pre-fix this preserved the prior
      // aux split, which was usually some hand-dragged ratio from a
      // previous session — surprised the user every time.
      splitPct: 0.5
    })
    // ENH-126 — outer terminal/working snaps to 33% terminal / 67%
    // working when terminal is visible (so net visual is ~33/33/33
    // across all three columns). When terminal is collapsed
    // (splitPct === 0), we leave it collapsed and rely on the inner
    // 50/50 to give main/split a clean even split.
    if (splitPct !== 0 && splitPct !== 100) {
      setSplitPct(33)
    }
    // eslint-disable-next-line no-console
    console.log('[BUG-093] splitViewMoveTabByPath COMMITTED', { path, promotedId })
  }, [auxState, fileTabs, dirtyPaths, auxBrowserTab, splitPct])

  // ⌘\ — move the ACTIVE main file tab into the aux slot. Resolves the
  // active tab's path then routes through splitViewMoveTabByPath so the
  // chord and the right-click menus converge on identical state.
  //
  // No-ops (don't fire if):
  // - Active surface isn't a file tab (browser-in-aux is Phase 3c)
  // - Active file tab's path is already the aux's only path (already
  //   in split — nothing to move)
  const splitViewToggle = useCallback(() => {
    if (activeWorking.kind !== 'file') return
    const active = fileTabs.find(t => t.id === activeWorking.id)
    if (!active) return
    // Phase 3c-iii — splitViewMoveTabByPath is now async (may show a
    // dirty-replace dialog). Fire-and-forget; the chord handler returns
    // immediately and the user interacts with the dialog if it surfaces.
    void splitViewMoveTabByPath(active.path)
  }, [activeWorking, fileTabs, splitViewMoveTabByPath])

  // ⌘⇧\ — promote aux back to main (close the split AND keep the
  // file open). Mirrors the aux header's ⇤ button (workingAux.onPromote
  // handler). Same state mutation: aux's active path becomes a fresh
  // main file tab; auxState clears to null. Sprint 7 Phase 3c — also
  // handles browser-in-aux: a pinned browser tab is released back to
  // the main strip via BrowserManager.releaseAuxTab(). No-op if no
  // split is open. For pure-close (discard the split entirely), the
  // aux header's ✕ button is the affordance.
  const splitViewPromote = useCallback(() => {
    if (auxBrowserTab) {
      void window.electron.browser.releaseAuxTab().then(() => {
        setAuxBrowserTab(null)
      })
      return
    }
    setAuxState(prev => {
      if (!prev || prev.paths.length === 0) return null
      const path = prev.paths[prev.activeIndex] ?? prev.paths[0]
      const { type, mime } = classifyFile(path)
      const newId = `f:${crypto.randomUUID()}`
      const title = path.split('/').pop() ?? path
      setFileTabs(curr => [...curr, { id: newId, type, path, title, mime }])
      setActiveWorking({ kind: 'file', id: newId })
      return null
    })
  }, [auxBrowserTab])

  // Sprint 7 Phase 3c — pin a browser tab into the aux slot. Mutually
  // exclusive with file-aux: if a file is currently pinned to aux,
  // it's released back to main first (via splitViewPromote's file
  // path) so the aux slot only holds one thing at a time.
  // BrowserManager.moveTabToAux returns the tab's url/title for the
  // aux header. The browser tabs broadcast (onTabsChange) will mark
  // the moved tab `inAux: true` so the main strip filters it out.
  const splitViewMoveBrowserTab = useCallback(async (browserTabId: number) => {
    // If a file is currently in aux, release it back to main first.
    // We can't share the slot. Re-uses the existing promote logic.
    setAuxState(prev => {
      if (!prev || prev.paths.length === 0) return null
      const path = prev.paths[prev.activeIndex] ?? prev.paths[0]
      const { type, mime } = classifyFile(path)
      const newId = `f:${crypto.randomUUID()}`
      const title = path.split('/').pop() ?? path
      setFileTabs(curr => [...curr, { id: newId, type, path, title, mime }])
      return null
    })
    const result = await window.electron.browser.moveTabToAux(browserTabId)
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.warn('[Phase 3c] moveTabToAux failed:', result.error)
      return
    }
    setAuxBrowserTab({
      id: browserTabId,
      url: result.url ?? '',
      title: result.title ?? '',
      // ENH-126 — same canonical 50/50 inner split on browser-aux open
      // as on file-aux open. See splitViewMoveTabByPath for the rationale.
      splitPct: 0.5
    })
    // ENH-126 — outer terminal/working snaps to 33/67 when terminal is
    // visible. See splitViewMoveTabByPath for the full rationale.
    if (splitPct !== 0 && splitPct !== 100) {
      setSplitPct(33)
    }
  }, [auxState, splitPct])

  // ⌘+ / ⌘- / ⌘0 handler for terminal font bump. Flips the active tab's
  // bump value, updates the "remember last choice" default (so new tabs
  // inherit the user's preferred size), and persists both.
  const adjustFontBump = useCallback((delta: number | 'reset') => {
    if (!activeTab) return
    const current = fontBumpByTab[activeTab.id] ?? fontBumpDefault
    const next = delta === 'reset'
      ? 0
      : Math.max(FONT_BUMP_MIN, Math.min(FONT_BUMP_MAX, current + delta))
    setFontBumpByTab(prev => {
      const updated = { ...prev, [activeTab.id]: next }
      try { localStorage.setItem(FONT_BUMP_BY_TAB_KEY, JSON.stringify(updated)) } catch { /* quota */ }
      return updated
    })
    setFontBumpDefault(next)
    try { localStorage.setItem(FONT_BUMP_LAST_KEY, String(next)) } catch { /* quota */ }
  }, [activeTab, fontBumpByTab, fontBumpDefault])

  // ── Split-pane resize (middle/right) ───────────────────────────────────────

  const onDividerMouseDown = useCallback(() => {
    isDragging.current = true
    setIsDraggingSplit(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current || !splitContainerRef.current) return
      const { left, width } = splitContainerRef.current.getBoundingClientRect()
      const pct = ((e.clientX - left) / width) * 100
      setSplitPct(Math.min(Math.max(pct, 20), 80))
    }
    const onUp = () => {
      if (!isDragging.current) return
      isDragging.current = false
      setIsDraggingSplit(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // ── Window-width auto-collapse for Files column ────────────────────────────

  useEffect(() => {
    const check = () => {
      const narrow = window.innerWidth < AUTO_COLLAPSE_WIDTH
      if (narrow !== lastAutoCollapseState.current) {
        lastAutoCollapseState.current = narrow
        if (narrow) setFilesCollapsed(true)
      }
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  useKeyboardShortcuts({
    // Stage 19c D18 — `⌘T` from terminal focus opens a *claude* tab
    // (the new opinionated default). The hook handles the focus-aware
    // routing — from non-terminal focus, ⌘T still goes to a new
    // browser tab (D20, today's behavior). ⌘⇧T anywhere opens a
    // vanilla shell (D19, today's behavior, now explicitly typed).
    newClaudeTab: () => {
      newTab('claude')
      setLastTabKind('claude')
      saveLastTabKind('claude')
    },
    newShellTab: () => {
      newTab('shell')
      setLastTabKind('shell')
      saveLastTabKind('shell')
    },
    newBrowserTab: () => {
      // Stage 11 \u00a7 D33e \u2014 \u2318T must foreground a new browser tab even when
      // the active WorkingPane tab is an editor (or any non-browser type).
      // Three steps in order:
      //   1) flip the WorkingPane's active slot to `browser` so the editor
      //      tab releases the renderer surface
      //   2) add the tab (BrowserManager activates it on creation)
      //   3) focus the address bar after a microtask so the user can type
      //      a URL immediately
      setActiveWorking({ kind: 'browser' })
      setFocusedColumn('working')
      void window.electron.browser.addTab().then(() => {
        // BUG-019 fix — the previous queueMicrotask scheduled the
        // focus call BEFORE React had finished re-rendering the
        // working pane (which holds the address bar). Two nested
        // requestAnimationFrames push us past the React commit AND
        // past the paint cycle, so the address-bar DOM node is
        // guaranteed mounted + visible when we focus().
        // BUG-103 fix (Sprint 9 walk-1, 2026-05-07) — owner saw the
        // address bar marked focused at the DOM level
        // (document.activeElement.tagName === 'INPUT', dataset
        // duoAddressbar === 'true'), BUT the input's caret rendered
        // grey/inactive instead of blue/active — meaning the OS-level
        // keyboard focus was on the new browser tab's WCV, not the
        // renderer that owns the input. New tab creation moves OS
        // focus to the WCV by default. Reclaim it BEFORE the rAF
        // chain so by the time .focus() runs, the renderer owns OS
        // focus and the input's caret renders active.
        window.electron.keyboard.reclaimFocus()
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const addr = document.querySelector<HTMLInputElement>('[data-duo-addressbar]')
            addr?.focus()
            addr?.select()
          })
        })
      })
    },
    newMarkdownFile,
    // ENH-169 (Sprint 20) — ⌘⇧N creates a folder in the navigator's
    // cwd (or selected folder). Inline-rename pattern via mkdir +
    // refresh + reveal chip. Same pattern as FileTree right-click.
    newFolder,
    closeTab: () => {
      if (focusedColumn === 'working') {
        // § D29 — close whichever working-pane tab is currently active.
        // Stage 24 — gate pinned tabs behind a confirm. ENH-050 (v0.6.3)
        // — confirm via system sheet instead of in-renderer modal so it
        // composites natively above the WCV (the in-renderer modal was
        // sibling-occluded by the WebContentsView for browser tabs).
        if (activeWorking.kind === 'file') {
          const ft = fileTabs.find(f => f.id === activeWorking.id)
          if (ft && pins.some(p => p.kind === 'file' && p.ref === ft.path)) {
            void (async () => {
              const result = await window.electron.dialog.confirm({
                title: `Close pinned tab "${ft.title}"?`,
                message: 'This tab is pinned. Closing it removes the pin and the tab.',
                buttons: ['Cancel', 'Close tab'],
                defaultId: 1,
                cancelId: 0,
                type: 'warning'
              })
              if (result.response === 1) closeFileTab(ft.id)
            })()
            return
          }
          closeFileTab(activeWorking.id)
        } else {
          void (async () => {
            const btabs = await window.electron.browser.getTabs()
            const active = btabs.find(t => t.isActive)
            if (!active) return
            if (active.url && pins.some(p => p.kind === 'browser' && p.ref === active.url)) {
              const label = active.title || active.url
              const result = await window.electron.dialog.confirm({
                title: `Close pinned tab "${label}"?`,
                message: 'This tab is pinned. Closing it removes the pin and the tab.',
                buttons: ['Cancel', 'Close tab'],
                defaultId: 1,
                cancelId: 0,
                type: 'warning'
              })
              if (result.response === 1) {
                await window.electron.browser.closeTab(active.id)
              }
              return
            }
            await window.electron.browser.closeTab(active.id)
          })()
        }
      } else {
        closeTab(activeTabId)
      }
    },
    // ENH-182 Phase 2 — Ctrl-Tab respects the project filter. With
    // no focus active, this is identical to `tabs`; while focused,
    // cycle skips hidden tabs entirely (D8).
    tabs: visibleTerminals,
    activeTabId,
    setActiveTabId,
    toggleFilesColumn: () => setFilesCollapsed(prev => !prev),
    // FOLLOWUP-025 — ⌘⇧K opens the File → Clone… modal. Pure-UI
    // complement to ENH-151's CLI (`duo clone <url>`). Same handler
    // backs the native File menu entry's IPC push.
    openCloneModal: () => setCloneModalOpen(true),
    // ⌘+ / ⌘- / ⌘0 — bump / shrink / reset terminal font size for the
    // active tab. Browser-focus forwarding intentionally skips these so
    // ⌘+/- keeps its native page-zoom behavior inside a browser tab.
    adjustTerminalFontBump: adjustFontBump,
    // ⌘` — fallback for platforms where the key isn't intercepted by
    // a menu accelerator. On macOS the system shortcut intercepts ⌘`
    // before this handler sees it; see `onPaneToggleFocus` below.
    togglePaneFocus,
    // ENH-098 (Sprint 9) — pane-jump chords. Same `focusPane` core
    // routes the chord callbacks AND the CLI `duo focus-pane` verb
    // (wired in core/socket-server.ts § case 'focus-pane' →
    // PANE_JUMP IPC → renderer below).
    focusTerminalPane: () => focusPane('terminal'),
    focusMainPane: () => focusPane('main'),
    focusAuxPane: () => focusPane('aux'),
    // ENH-102 (Sprint 9) — ⌘⇧⌫ deletes the active file with confirm.
    deleteCurrentFile,
    // Sprint 11 ENH-096 B.4 — ⌘O opens the vault quick switcher.
    openVaultQuickSwitcher: () => setVaultQuickSwitcherOpen(true),
    // ENH-172 (Sprint 20) — ⌘⇧. toggles show-hidden-files. The View
    // menu accelerator owns this at the app-menu level; this is the
    // renderer-side fallback. nav.toggleShowDotfiles flips the hook
    // state, the localStorage-persist effect fires, and the
    // NAV_STATE_PUSH effect carries the new value back to main.
    toggleHiddenFiles: nav.actions.toggleShowDotfiles,
    // ENH-179 — ⌘Z pop + restore. Chord matcher gates on
    // inAnyTextInput so we won't clobber text undo.
    reopenLastClosedTab,
    // Sprint 3 Phase 3b — ⌘\ moves the active main file tab into the
    // aux slot; ⌘⇧\ promotes aux back to main (closes the split AND
    // keeps the file open — mirrors the ⇤ button in the aux header).
    // Both delegate to the same state mutations the CLI verbs and the
    // right-click menus produce.
    splitViewToggle,
    splitViewPromote,
    // BUG-001 fix — pane-aware ⌃Tab routing. Without this, ⌃Tab from
    // terminal focus cycles browser tabs instead of terminal tabs.
    activePaneFocus: focusedColumn,
    // Stage 26 PR 3 item 8 — ⌘⇧G ("Go to folder", Finder parity)
    // flips the navigator breadcrumb into an editable input. Brings
    // focus to the files column too — the breadcrumb edit is most
    // useful when the user can immediately see the resolved tree.
    focusBreadcrumbEdit: () => {
      setFocusedColumn('files')
      filesPaneRef.current?.focusBreadcrumbEdit()
    },
    // ENH-023 + ENH-028 — find-in-document / find-in-page. Branch
    // by active surface: browser pane uses `webContents.findInPage`
    // via BrowserRenderer's local find bar; markdown editor uses
    // ProseMirror's text-search via MarkdownEditor's find bar; canvas
    // (kind: 'page') uses PageFindBar's iframe text-walker + CSS Custom
    // Highlight API (BUG-126). Preview / image surfaces still no-op.
    //
    // The activeWorking discriminator is the PANE type ('file' vs.
    // 'browser'); the tab-level type ('editor', 'page', 'image', etc.)
    // lives on the file tab itself. Look it up to branch correctly.
    openFind: () => {
      const activeFileType = activeWorking.kind === 'file'
        ? fileTabs.find(f => f.id === activeWorking.id)?.type
        : null
      const evt = activeWorking.kind === 'browser'
        ? 'duo-browser-find-open'
        : activeFileType === 'page'
        ? 'duo-page-find-open'
        : 'duo-editor-find-open'
      window.dispatchEvent(new CustomEvent(evt))
    },
    findNext: () => {
      const activeFileType = activeWorking.kind === 'file'
        ? fileTabs.find(f => f.id === activeWorking.id)?.type
        : null
      const evt = activeWorking.kind === 'browser'
        ? 'duo-browser-find-next'
        : activeFileType === 'page'
        ? 'duo-page-find-next'
        : 'duo-editor-find-next'
      window.dispatchEvent(new CustomEvent(evt))
    },
    findPrev: () => {
      const activeFileType = activeWorking.kind === 'file'
        ? fileTabs.find(f => f.id === activeWorking.id)?.type
        : null
      const evt = activeWorking.kind === 'browser'
        ? 'duo-browser-find-prev'
        : activeFileType === 'page'
        ? 'duo-page-find-prev'
        : 'duo-editor-find-prev'
      window.dispatchEvent(new CustomEvent(evt))
    }
  })

  // ⌘` menu-accelerator path. The app menu registers the same
  // accelerator at the Electron level so it beats macOS's built-in
  // "cycle windows of the same app" shortcut — which swallows the
  // keydown before the renderer can see it.
  useEffect(() => {
    return window.electron.keyboard?.onPaneToggleFocus?.(togglePaneFocus)
  }, [togglePaneFocus])

  // ENH-098 (Sprint 9) — `duo focus-pane <name>` CLI verb routes here
  // through main → PANE_FOCUS_JUMP → preload's onPaneFocusJump. Same
  // focusPane() core that the ⌘⌥L/;/' chord set fires.
  useEffect(() => {
    return window.electron.keyboard?.onPaneFocusJump?.(focusPane)
  }, [focusPane])

  // BUG-042 — when the user clicks into the browser WebContentsView,
  // the click happens in a separate process and the renderer's
  // column-wrapper onMouseDown never fires. Main forwards a focus
  // signal here so we can flip focusedColumn = 'working'. Closes
  // the symmetric gap to the BUG-037 canvas mousedown forwarder
  // and unblocks BUG-038's recurring repro shape (cycle keystrokes
  // routing to the wrong pane because focus tracking was stuck).
  useEffect(() => {
    return window.electron.keyboard?.onBrowserFocusGained?.((payload) => {
      // ENH-036 (v0.6.4) — when `duo open <url>` lands on the browser
      // path (i.e. URL went to BrowserManager.openTab, NOT smart-routed
      // to the editor), the working pane needs to flip to browser kind
      // OR the new tab is added invisibly (it's in the browser strip
      // but the working pane is still showing a canvas/editor tab).
      // socket-server.ts's `case 'open'` already pushes browser:focus-
      // gained for browser-routed opens; mirror Stage 23 canvas-action
      // browser:open's effect by setting activeWorking too. Idempotent
      // on click-into-browser (BUG-042 source) — activeWorking is
      // already 'browser' when the user clicks the browser pane.
      //
      // Phase 3c BUG-095 — when the focus event came from the AUX-
      // pinned tab (slot === 'aux'), only flip focusedColumn to
      // 'working'. Do NOT touch activeWorking: the aux tab is
      // ALREADY in the aux pane and doesn't represent a main-strip
      // intent. Pre-fix, clicking into the aux'd tab kicked the
      // main pane's active markdown / canvas out and replaced it
      // with whatever non-aux browser tab BrowserManager had as
      // activeIndex — surprise tab switching the user reported as
      // "main pane focus stolen."
      //
      // BUG-101 (Sprint 10) — defensive null-guard. The supplemental
      // event from socket-server.ts now sends a proper {tabId, slot}
      // payload, but legacy callers / future refactors might forget
      // and pass `null`. Treat a missing/malformed payload as a
      // "main-strip intent" since that was the historic semantic
      // before Phase 3c added the slot discriminator.
      setFocusedColumn('working')
      const slot = (payload as { slot?: 'main' | 'aux' } | null | undefined)?.slot ?? 'main'
      if (slot === 'main') {
        setActiveWorking({ kind: 'browser' })
      }
    })
  }, [])

  // Stage 12 close — whisper-level "Claude is reading here" cue.
  // Main pushes which pane the resolved selection came from when
  // the agent calls `duo selection`. We toggle data-claude-reading
  // on the corresponding pane wrapper for 1.2s; the CSS keyframe
  // in globals.css paints a soft accent halo that fades. Each pane
  // wrapper carries a stable data-pane attribute so this lookup is
  // O(1) and lives entirely in App.
  useEffect(() => {
    return window.electron.keyboard?.onClaudeReadSelection?.((e) => {
      // Map the resolved-selection kind back to the pane wrapper's
      // data-pane attribute. Editor + canvas both live in the
      // working pane → flash the working column; browser also lives
      // in working but the WebContentsView occludes the inner DOM,
      // so the column-level halo is what reads visually.
      const paneAttr = e.pane === 'editor' || e.pane === 'page' ? 'working' : 'working-browser'
      // Both kinds collapse to the working pane wrapper for v1.
      // (Editor lives there when MarkdownEditor is the active
      // renderer; canvas there when PageTab is active; browser
      // there when BrowserRenderer is active.) A future polish
      // could glow only the active sub-surface.
      void paneAttr
      const el = document.querySelector<HTMLElement>('[data-pane="working"]')
      if (!el) return
      // Drop any in-flight glow so a back-to-back read re-triggers
      // the keyframe. Re-add via rAF after a tick so the browser
      // restarts the animation.
      el.removeAttribute('data-claude-reading')
      requestAnimationFrame(() => {
        el.setAttribute('data-claude-reading', '1')
        // Self-clear after the keyframe duration so the attribute
        // doesn't linger on the DOM (idempotent; re-fire just
        // resets it).
        window.setTimeout(() => el.removeAttribute('data-claude-reading'), 1300)
      })
    })
  }, [])

  // ENH-014 — View → Pane size menu items, ⌘⌥1/2/3/0/9, and `duo
  // split <pct>` all land here. Main clamps to 20–80 before pushing;
  // we re-clamp defensively in case of contract drift.
  useEffect(() => {
    return window.electron.layout?.onSplitSet?.((pct) => {
      setSplitPct(Math.min(Math.max(pct, 20), 80))
    })
  }, [])

  // ENH-099 — `⌘⌥4` chord / View → Pane size → 3-way even / `duo split
  // 3way`. Sets the canonical 3-pane layout: outer 33/67 + inner aux
  // 50/50. Same target shape as ENH-126's auto-redistribute on aux-
  // open, but on-demand. When aux isn't currently open, only the outer
  // ratio gets set.
  //
  // Walk-3 fix: aux's effective splitPct is read from EITHER auxState
  // (file-aux) OR auxBrowserTab (browser-aux) — see WorkingPane §
  // activeSplitPct. The chord must reset BOTH so the inner divider
  // honors the new 50/50 regardless of which aux kind is currently
  // pinned. Pre-fix the chord only touched file-aux's splitPct, so when
  // a browser tab was in the aux slot (the most common case during the
  // walk's smoke-walk-page review pattern), the inner divider stayed at
  // whatever ratio the previous drag had left it.
  useEffect(() => {
    return window.electron.layout?.onLayout3wayEven?.(() => {
      setSplitPct(33)
      setAuxState(prev => (prev && prev.paths.length > 0
        ? { ...prev, splitPct: 0.5 }
        : prev
      ))
      setAuxBrowserTab(prev => (prev ? { ...prev, splitPct: 0.5 } : prev))
    })
  }, [])

  // FOLLOWUP-015 (ENH-117 v2) — View → View source menu fires this
  // IPC. Re-dispatch as the existing `'duo-view-source'` window event
  // so MarkdownEditor + PageTab listeners (already handling the ⌘⌥V
  // chord and the tab-strip right-click) respond identically. Single
  // event-funnel keeps the toggle / isActive logic in one place.
  useEffect(() => {
    return window.electron.layout?.onViewSourceRequest?.(() => {
      window.dispatchEvent(new CustomEvent('duo-view-source'))
    })
  }, [])

  // ENH-124 — `duo layout` reads this function via main's
  // executeJavaScript. Re-bound on every render so the closure
  // captures the latest state (cheaper than threading 8+ refs).
  // Schema: WorkingPane state (active main + aux) + terminal slice
  // (tab list + active + collapse hint) + navigator slice (cwd /
  // selection / pinned / collapsed). See core/socket-server.ts
  // case 'layout' for the contract.
  // Walk-1 fix (2026-05-10): owner reported the terminal + navigator
  // slices were too thin compared to the working-pane detail. v2
  // includes the full terminal tab list (kind / cwd / title) + nav
  // selection so the snapshot answers "what's the user looking at"
  // across all three columns symmetrically.
  useEffect(() => {
    const activeFileTab = activeWorking.kind === 'file'
      ? fileTabs.find(t => t.id === activeWorking.id)
      : null
    const activeBrowserTab = activeWorking.kind === 'browser'
      ? browserTabs.find(t => t.isActive)
      : null
    const main: Record<string, unknown> | null =
      activeFileTab
        ? { kind: activeFileTab.type, path: activeFileTab.path, title: activeFileTab.title, id: activeFileTab.id }
        : activeBrowserTab
          ? { kind: 'browser', url: activeBrowserTab.url, title: activeBrowserTab.title, id: `b:${activeBrowserTab.id}` }
          : null
    let aux: Record<string, unknown> | null = null
    if (auxBrowserTab) {
      aux = {
        kind: 'browser',
        url: auxBrowserTab.url,
        title: auxBrowserTab.title,
        splitPct: auxBrowserTab.splitPct
      }
    } else if (auxState && auxState.paths.length > 0) {
      const idx = Math.max(0, Math.min(auxState.activeIndex, auxState.paths.length - 1))
      const auxPath = auxState.paths[idx]
      const auxFileTab = fileTabs.find(t => t.path === auxPath)
      aux = {
        kind: 'file',
        path: auxPath,
        title: auxFileTab?.title ?? auxPath.split('/').pop() ?? auxPath,
        type: auxFileTab?.type ?? 'unknown',
        splitPct: auxState.splitPct
      }
    }
    const activeTerminal = tabs.find(t => t.id === activeTabId) ?? null
    const snapshot = {
      // Working pane (main + aux)
      active: activeWorking.kind,
      main,
      aux,
      splitPct,
      focusedColumn,
      fileTabsCount: fileTabs.length,
      browserTabsCount: browserTabs.length,
      // Terminal column — walk-1 expansion. Mirrors `duo nav-state`'s
      // depth: full list of tabs, active id, kind / cwd / title each.
      // `collapsed` derived from splitPct (≥ 80 = canvas hidden;
      // ≤ 20 = terminal hidden — mirror of the `setSplit` chord set).
      terminal: {
        activeTabId,
        activeKind: activeTerminal?.kind ?? null,
        activeCwd: activeTerminal?.cwd ?? null,
        activeTitle: activeTerminal?.title ?? null,
        collapsed: splitPct <= 20,
        tabs: tabs.map(t => ({ id: t.id, kind: t.kind, cwd: t.cwd, title: t.title }))
      },
      // Navigator column — walk-1 expansion. Mirrors `duo nav-state`
      // shape (cwd / selected / pinned) so callers can introspect
      // navigator state without a separate verb.
      navigator: {
        cwd: nav.state.cwd,
        selected: nav.state.selected,
        pinned: nav.state.pinned,
        collapsed: filesCollapsed,
        expandedCount: nav.state.expanded.size ?? 0
      },
      timestamp: Date.now()
    }
    ;(window as unknown as { __duoGetLayout?: () => unknown }).__duoGetLayout = () => snapshot
    return () => {
      delete (window as unknown as { __duoGetLayout?: () => unknown }).__duoGetLayout
    }
  })

  // ENH-195 — `duo status` reads this function via main's
  // executeJavaScript (getStatusSnapshot). Re-bound on every render so
  // the closure captures the latest React state — same always-fresh,
  // no-cache pattern as __duoGetLayout above. Coarser than layout: a
  // flat list of EVERY open tab (file + browser) with per-tab dirty /
  // active / pinned, plus the active working tab summary, focused
  // column, theme, and terminal-tab count. The keystone agent-
  // orientation verb. Field names mirror the WorkingTab vocabulary.
  useEffect(() => {
    const tabSnapshots = [
      ...fileTabs.map(ft => ({
        kind: ft.type as string,
        path: ft.path,
        title: ft.title,
        dirty: (dirtyPaths.has(ft.path) || ft.dirty === true),
        active: (activeWorking.kind === 'file' && activeWorking.id === ft.id),
        pinned: pinnedFileTabPaths.has(ft.path)
      })),
      ...browserTabs.filter(bt => !bt.inAux).map(bt => ({
        kind: 'browser' as const,
        url: bt.url,
        title: bt.title,
        dirty: false,
        active: bt.isActive === true,
        pinned: pinnedBrowserUrls.has(bt.url)
      }))
    ]
    const activeFileTab = activeWorking.kind === 'file'
      ? fileTabs.find(t => t.id === activeWorking.id)
      : null
    const activeBrowserTab = activeWorking.kind === 'browser'
      ? browserTabs.find(t => t.isActive && !t.inAux)
      : null
    const active: Record<string, unknown> | null =
      activeFileTab
        ? { kind: activeFileTab.type, path: activeFileTab.path, title: activeFileTab.title }
        : activeBrowserTab
          ? { kind: 'browser', url: activeBrowserTab.url, title: activeBrowserTab.title }
          : null
    const statusSnapshot = {
      tabs: tabSnapshots,
      active,
      focusedColumn,
      theme: theme.mode,
      effectiveTheme: theme.effective,
      terminalTabsCount: tabs.length,
      timestamp: Date.now()
    }
    ;(window as unknown as { __duoGetStatus?: () => unknown }).__duoGetStatus = () => statusSnapshot
    return () => {
      delete (window as unknown as { __duoGetStatus?: () => unknown }).__duoGetStatus
    }
  })

  // ENH-041 / Sprint 3 — Split View IPC subscribers. CLI verbs `duo
  // split-view open|close|promote|resize` route through main →
  // preload → here. App.tsx is the source of truth for aux state;
  // every change pushes a snapshot back to main via the
  // `pushState` effect below so the CLI's no-arg state query has
  // a cache to read.
  //
  // v1 single-slot semantics (locked spec § 5):
  //   - onOpen: if path is in main fileTabs, MOVE it (drop from main,
  //     set as aux's only tab). Else just open in aux. Replacement
  //     of existing aux content is silent in v1; dirty-prompt is
  //     Phase 3c.
  //   - onClose: setAuxState(null); main pane reclaims width.
  //   - onPromote: aux's active tab moves back to main; aux closes.
  //   - onResize: clamp pct to [0.20, 0.80] (mirror divider drag).
  // Sprint 3 Phase 3c-iii (v0.6.5 prep) — keep splitViewMoveTabByPath
  // accessible from the workingAux.onOpen handler below WITHOUT making
  // the useEffect re-subscribe on every fileTabs/auxState/dirtyPaths
  // change (which would defeat the deliberate `[]` deps below). The
  // ref always reads the latest implementation; calls from inside
  // the IPC handler get the dirty-replace gate for free.
  const splitViewMoveTabByPathRef = useRef(splitViewMoveTabByPath)
  splitViewMoveTabByPathRef.current = splitViewMoveTabByPath

  // Phase 3c — ref pattern for the browser-aux mutation primitive so the IPC
  // handlers read the latest closure without re-subscribing on every change.
  // (BUG-195: the aux close/promote handlers no longer gate on an auxBrowserTab
  // ref — they call releaseAuxTab UNCONDITIONALLY, the no-op-or-reconcile that
  // survives a renderer-reload state desync.)
  const splitViewMoveBrowserTabRef = useRef(splitViewMoveBrowserTab)
  splitViewMoveBrowserTabRef.current = splitViewMoveBrowserTab

  useEffect(() => {
    const offOpen = window.electron.workingAux?.onOpen?.((path) => {
      // Sprint 3 Phase 3b + 3c-iii — delegate to the shared mutation
      // primitive so the CLI / page-link / chord / right-click paths
      // all converge on identical state mutations AND the same dirty-
      // replace dialog gate. Async-fire-and-forget: the IPC handler
      // doesn't need to await the dialog response.
      void splitViewMoveTabByPathRef.current(path)
    })
    // Phase 3c — CLI `duo split-view open-browser <id>` parity.
    const offOpenBrowser = window.electron.workingAux?.onOpenBrowser?.((browserTabId) => {
      void splitViewMoveBrowserTabRef.current(browserTabId)
    })
    const offClose = window.electron.workingAux?.onClose?.(() => {
      // Sprint 7 Phase 3c — close clears BOTH file-aux and browser-aux.
      // BUG-195: release UNCONDITIONALLY (releaseAuxTab is a no-op when main
      // holds no aux tab) rather than gating on `auxBrowserTabRef`. A renderer
      // reload clears that ref while the BrowserManager keeps `auxTabId`; the
      // stale gate then skipped the reconcile, leaving the aux WebContentsView
      // orphaned over the UI (the ghost). Always releasing reconciles main even
      // when the renderer's view of aux is stale.
      void window.electron.browser.releaseAuxTab().then(() => {
        setAuxBrowserTab(null)
      })
      setAuxState(null)
    })
    const offPromote = window.electron.workingAux?.onPromote?.(() => {
      // Phase 3c — promote handles BOTH file-aux and browser-aux.
      // BUG-195: release UNCONDITIONALLY (no-op when main holds no browser aux)
      // so a stale `auxBrowserTabRef` after a renderer reload can't skip the
      // reconcile and orphan the WCV. The file-aux re-home below is itself a
      // no-op when there's no file aux (prev === null), so both run safely.
      void window.electron.browser.releaseAuxTab().then(() => {
        setAuxBrowserTab(null)
      })
      setAuxState(prev => {
        if (!prev || prev.paths.length === 0) return null
        const path = prev.paths[prev.activeIndex] ?? prev.paths[0]
        // Re-add to main as a new file tab. classifyFile derives type
        // + mime from extension; the navigator-click path uses the
        // same helper.
        const { type, mime } = classifyFile(path)
        const newId = `f:${crypto.randomUUID()}`
        const title = path.split('/').pop() ?? path
        setFileTabs(curr => [...curr, { id: newId, type, path, title, mime }])
        setActiveWorking({ kind: 'file', id: newId })
        return null
      })
    })
    const offResize = window.electron.workingAux?.onResize?.((pct) => {
      setAuxState(prev => {
        const clamped = Math.min(Math.max(pct, 0.20), 0.80)
        if (!prev) {
          // Resize on closed split is a no-op (clamping a non-existent
          // splitPct). Could also choose to "remember the size for
          // next open" but that's pre-optimization; defer.
          return null
        }
        return { ...prev, splitPct: clamped }
      })
    })
    return () => {
      offOpen?.()
      offOpenBrowser?.()
      offClose?.()
      offPromote?.()
      offResize?.()
    }
    // fileTabs is read inside the onOpen handler; intentionally NOT
    // a dep so we don't re-subscribe on every fileTabs change. The
    // closure captures the latest fileTabs via the stale-closure
    // pattern + functional setState. setFileTabs's prev arg gives
    // us the current value at fire time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ENH-041 / Sprint 3 — push aux snapshot to main on every change.
  // Main caches the latest snapshot (workingAuxSnapshot in main.ts)
  // so the CLI's no-arg `duo split-view` state query can answer
  // without a renderer round-trip.
  useEffect(() => {
    // Phase 3c — snapshot reflects the active aux slot (file OR
    // browser). The activePath field carries the file path for files
    // and the URL for browser tabs; activeKind disambiguates. The CLI
    // consumer (`duo split-view` reflection) only has these two
    // fields to work with, so a "browser tab in aux" shows up as
    // activeKind: 'browser' + activePath: <url>.
    let snapshot: { aux: { activePath: string; activeKind: import('@shared/types').WorkingTabType; splitPct: number } | null }
    if (auxBrowserTab) {
      snapshot = {
        aux: {
          activePath: auxBrowserTab.url,
          activeKind: 'browser',
          splitPct: auxBrowserTab.splitPct
        }
      }
    } else if (auxState && auxState.paths.length > 0) {
      const activePath = auxState.paths[auxState.activeIndex] ?? auxState.paths[0]
      snapshot = {
        aux: {
          activePath,
          activeKind: classifyFile(activePath).type,
          splitPct: auxState.splitPct
        }
      }
    } else {
      snapshot = { aux: null }
    }
    window.electron.workingAux?.pushState?.(snapshot)
  }, [auxState, auxBrowserTab])

  // ENH-040 — cache the previous non-collapsed split for restore.
  // Whenever splitPct is in the user's drag range (20–80), remember
  // it so a future collapse → restore returns there. Keeps the
  // collapse buttons feeling like "hide / show" rather than "snap
  // to default."
  useEffect(() => {
    if (splitPct >= 20 && splitPct <= 80) {
      setPrevSplitPct(splitPct)
    }
  }, [splitPct])

  // ENH-040 — collapse-pane toggles. Each side is its own toggle:
  // first click hides that pane (snaps splitPct to 0 or 100); second
  // click restores to prevSplitPct (the last user-set drag value, or
  // 55 on first launch). The titlebar buttons drive these; the
  // keyboard analog rides on existing ⌘⌥0 / ⌘⌥9 (20/80 today —
  // future enhancement to graduate them to 0/100, or wire a new
  // ⌘⌥⇧0/9 chord; documented but not in this commit).
  const isTerminalCollapsed = splitPct === 0
  const isCanvasCollapsed = splitPct === 100
  const toggleCollapseTerminal = useCallback(() => {
    setSplitPct(isTerminalCollapsed ? prevSplitPct : 0)
  }, [isTerminalCollapsed, prevSplitPct])
  const toggleCollapseCanvas = useCallback(() => {
    setSplitPct(isCanvasCollapsed ? prevSplitPct : 100)
  }, [isCanvasCollapsed, prevSplitPct])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-surface-0">
      {/* Top chrome row. Window drag surface; small no-drag controls on the
          right (theme toggle) escape the drag via .titlebar-nodrag. macOS
          traffic lights are positioned over this row by
          `trafficLightPosition` without a DOM spacer. */}
      <div className="h-10 shrink-0 bg-surface-1 border-b border-border titlebar-drag flex items-center pr-2 gap-1">
        {/* ENH-167 v1.2 + ENH-171 (Sprint 20) — workspace-name badge.
            macOS traffic lights sit at x=16 (96px reserved); the badge
            floats next to them and is now a click target that opens
            the workspace switcher dropdown (ENH-171). When untitled,
            still shows a clickable "Workspaces ▾" affordance so the
            user can switch / open / create from the cold-launch state
            (no active workspace yet). */}
        <div className="flex items-center pl-[96px] flex-1 min-w-0">
          <button
            ref={workspaceBadgeRef}
            type="button"
            // ENH-184 (Sprint 23 / v0.8.0) — gate ENH-171's dropdown
            // gesture behind a localStorage flag (default OFF). Pill
            // renders as a passive label by default; workspace ops
            // route through the File menu. DevTools toggle:
            //   localStorage.setItem('duo.workspacePillMenu', 'true')
            //   window.dispatchEvent(new CustomEvent('duo:workspacePillMenuFlagChanged'))
            // or via CLI: `duo workspace-pill-menu on`.
            onClick={workspacePillMenuEnabled ? () => setWorkspaceMenuOpen(o => !o) : undefined}
            className={[
              'titlebar-nodrag text-[12px] text-zinc-600 select-none truncate px-2 py-0.5 rounded',
              workspacePillMenuEnabled ? 'hover:bg-accent/10 cursor-pointer' : 'cursor-default'
            ].join(' ')}
            title={
              workspacePillMenuEnabled
                ? (activeWorkspace
                  ? `Workspace: ${activeWorkspace.name} — ${activeWorkspace.path}`
                  : 'No workspace loaded — click to open or create one')
                : (activeWorkspace
                  ? `Workspace: ${activeWorkspace.name} — ${activeWorkspace.path}\nUse the File menu for workspace operations.`
                  : 'No workspace loaded — use the File menu to open or create one.')
            }
          >
            {activeWorkspace ? activeWorkspace.name : 'Workspaces'}
            {workspacePillMenuEnabled && <span className="ml-1 text-zinc-400">▾</span>}
          </button>
        </div>
        {workspacePillMenuEnabled && (
          <WorkspaceSwitcherDropdown
            open={workspaceMenuOpen}
            anchorRef={workspaceBadgeRef}
            activeWorkspace={activeWorkspace}
            onClose={() => setWorkspaceMenuOpen(false)}
          />
        )}
        {/* ENH-182 Phase 2 — title-bar focus chip. Renders ONLY when
            a project focus is active; click × (or anywhere on the
            chip) to release. Confirms "you're filtered" + provides
            an always-visible release affordance independent of the
            rail's All tile. */}
        {focusedProjectName && (
          <button
            type="button"
            onClick={() => setFocusedProject(null)}
            className="titlebar-nodrag inline-flex items-center gap-1 text-[11px] font-semibold text-accent bg-accent/10 hover:bg-accent/20 transition-colors rounded-full px-2 py-0.5 mr-1"
            title={`Focused on ${focusedProjectName} — click to show all projects`}
            aria-label={`Release focus (${focusedProjectName})`}
          >
            <span>Focused: {focusedProjectName}</span>
            <span aria-hidden="true" className="text-accent/70">×</span>
          </button>
        )}
        {/* v0.5.4 sprint — running version badge. Glanceable confirmation
            for "am I smoke-walking the build I think I am?" — surfaced
            after a v0.5.4-final walk where it was non-trivial to tell
            whether a fix had landed in the running dev process or not.
            Dev builds tag with " · dev"; prod builds show the version
            alone. Hover gives the full label including build kind. */}
        <span
          className="titlebar-nodrag text-[11px] tabular-nums text-zinc-500 select-none px-1"
          title={`Duo ${window.electron.env.appVersion}${window.electron.env.isDev ? ' (dev)' : ''}`}
        >
          {window.electron.env.appVersion}
          {window.electron.env.isDev && (
            <span className="text-accent ml-1">·dev</span>
          )}
        </span>
        {/* Stage 12 close — whisper-level Claude presence. Soft accent
            dot when the front terminal has a live Claude session.
            titlebar-nodrag so the dot itself isn't a drag affordance. */}
        <div className="titlebar-nodrag">
          <ClaudePresenceDot active={claudeLive} />
        </div>
        {/* ENH-083 (v0.6.5) — the two collapse-pane buttons (terminal +
            canvas) moved out of the titlebar and into each surface's
            new-tab cluster (TabBar + WorkingTabStrip). Titlebar now
            holds version badge + Claude presence + theme toggle only,
            keeping the chrome focused on session-wide state.
            Underlying state (splitPct, isTerminalCollapsed,
            isCanvasCollapsed, toggleCollapseTerminal,
            toggleCollapseCanvas) is unchanged — only the button
            location changed. */}
        <ThemeToggle mode={theme.mode} onCycle={theme.cycleMode} />
      </div>

      {/* Stage 18 — first-launch self-install banner. Renders only
          when ~/.claude/duo/installed.json is absent or the recorded
          version is stale; auto-hides on success / dismissal. */}
      <FirstLaunchBanner />

      {/* v0.4.0 — GitHub Releases upgrade-available banner. Renders
          only when api.github.com says a newer Duo tag is published
          and the user hasn't dismissed THIS upstream version yet. */}
      <UpdateAvailableBanner />

      {/* Stage 25 (v0.4.0) — post-redirect chrome banner. Auto-
          dismisses after ~6s; only renders briefly after `duo
          external` (or another shell.openExternal call) routes a
          URL to the system browser. */}
      <ExternalRedirectedBanner />

      {/* FOLLOWUP-025 — File → Clone… modal (⌘⇧K). Pure-UI complement
          to ENH-151's CLI. On successful clone, navigate the navigator
          to the new folder so the user lands there. */}
      <CloneModal
        open={cloneModalOpen}
        defaultParent={cloneModalDefaultParent ?? nav.state.cwd ?? null}
        onClose={() => {
          setCloneModalOpen(false)
          setCloneModalDefaultParent(null)
        }}
        onCloned={(clonedTo) => {
          nav.actions.navigateTo(clonedTo)
        }}
      />
      {/* BUG-137 walk-3 follow-up — replacement for window.prompt
          (Electron renderers throw on the native prompt API). Self-
          contained; listens for 'duo-link-prompt-request' events. */}
      <LinkPromptModal />

      <div className="flex flex-1 overflow-hidden min-w-0">
        {/* ENH-182 Phase 1 + Phase 2 — project rail with focus
            filter. Hidden by the component itself when no projects
            have surfaced yet. Phase 2: clicking a tile sets
            `focusedProject` which gates `visibleTerminals` +
            `visibleFileTabIds`, the navigator re-root effect, and
            the title-bar focus chip. */}
        <ProjectRail
          projects={railProjects}
          focusedProject={focusedProject}
          onFocus={handleProjectFocus}
          counts={projectCounts}
          onTogglePin={handleTogglePin}
          onCloseProject={handleCloseProject}
        />
        <div
          className="h-full shrink-0 min-w-0"
          onMouseDown={() => setFocusedColumn('files')}
          aria-label="Files column"
        >
          <FilesPane
            ref={filesPaneRef}
            collapsed={filesCollapsed}
            focused={focusedColumn === 'files'}
            home={home}
            state={nav.state}
            actions={nav.actions}
            userClaudeNav={userClaudeNav}
            navPins={navPins}
            onOpenFile={onOpenFile}
            onOpenTerminalHere={openTerminalHere}
            onOpenClaudeIn={openClaudeIn}
            revealChip={revealChip}
            onDismissRevealChip={() => setRevealChip(null)}
            onToggleCollapsed={() => setFilesCollapsed(prev => !prev)}
            onSetCollapsed={(v) => setFilesCollapsed(v)}
            // Stage 26 PR 3 item 2 — front terminal's launch CWD,
            // surfaced to FileTree as an ambient highlight on the
            // matching folder row. Resolves to the active tab's
            // launch CWD (live cwd post-`cd` is not tracked yet —
            // OSC 7 hook is its own follow-up enhancement).
            activeTerminalCwd={tabs.find(t => t.id === activeTabId)?.cwd ?? null}
            // Stage 26 PR 3 item 3 — open / active file signals for
            // the project tree. `openFilePaths` is the set of every
            // file currently in fileTabs (any WorkingPane tab);
            // `activeFilePath` is the path of the front-most tab if
            // it's a file (browser tabs resolve to null).
            openFilePaths={new Set(fileTabs.map(t => t.path))}
            activeFilePath={
              activeWorking.kind === 'file'
                ? fileTabs.find(t => t.id === activeWorking.id)?.path ?? null
                : null
            }
            // Stage 26 PR 3 item 8 — when the editable breadcrumb
            // resolves to a FILE, navigate to its parent folder and
            // open the file in the working pane. Mirrors the `duo
            // reveal <path>` CLI verb's same-shape behavior.
            onRevealFile={(path) => {
              const dir = path.slice(0, path.lastIndexOf('/')) || '/'
              nav.actions.navigateTo(dir)
              // The file open uses onOpenFile's existing classifier
              // path, so synthesize a minimal DirEntry for it.
              const fileName = path.slice(path.lastIndexOf('/') + 1)
              onOpenFile({
                kind: 'file',
                name: fileName,
                path
              })
            }}
            onOpenInSplit={splitViewMoveTabByPath}
            // ENH-169 (Sprint 20) — breadcrumb right-click context
            // menu. Folder-scoped: New file/folder here…, Reveal in
            // Finder, Open terminal here.
            onBreadcrumbContextMenu={onBreadcrumbContextMenu}
          />
        </div>

        <div
          ref={splitContainerRef}
          className="flex flex-1 overflow-hidden min-w-0"
        >
          <div
            className={[
              // Stage 12 — Atelier layout depth: terminal column sits on
              // `paper-deep`, working pane on `paper`. The 1px right
              // border (paper-rule) is the seam between them.
              //
              // BUG-003 fix (rev 2): primary focus indicator now lives in
              // the tab strip (TabBar tints to accent-soft when
              // focused={true}) — strip is renderer DOM and never
              // occluded, unlike the column wrapper which xterm canvas
              // paints over. Seam border still flips to full-opacity
              // accent as a secondary cue.
              //
              // ENH-066 (v0.6.3) — when isTerminalCollapsed (split = 0%),
              // the wrapper renders a fixed-width CollapsedPaneRail
              // INSTEAD of the regular tab strip + xterm. The rail is a
              // clickable vertical bar with a terminal glyph; click
              // restores the prior split. Mirrors the CollapsedRail
              // pattern in FilesPane.tsx.
              //
              // ENH-066 layout note: when EITHER pane is collapsed, the
              // OTHER pane needs to fill the remaining space — using a
              // fixed % width on terminal AND a 36px width on canvas
              // overflows the parent (both shrink-0). So when canvas is
              // collapsed, terminal flips to flex-1 (no width prop);
              // canvas keeps its 36px rail. When terminal is collapsed,
              // canvas keeps flex-1 and terminal is the 36px rail.
              'flex flex-col h-full bg-surface-1 border-r transition-colors min-w-0 overflow-hidden',
              focusedColumn === 'terminal' ? 'border-accent' : 'border-border',
              isCanvasCollapsed ? 'flex-1' : ''
            ].join(' ')}
            style={
              isTerminalCollapsed
                ? { width: '36px', flexShrink: 0 }
                : isCanvasCollapsed
                  ? undefined
                  : { width: `${splitPct}%`, flexShrink: 0 }
            }
            onMouseDown={() => setFocusedColumn('terminal')}
            onDragOver={(e) => {
              // ENH-207 — drop a navigator file/folder here to insert its path
              // at the active terminal's cursor. preventDefault on EVERY drag
              // over this column is mandatory: without it, a dropped file://
              // (including a stray Finder drag) navigates the window and blanks
              // the app. Only our own navigator drags actually insert (onDrop);
              // foreign drags are swallowed harmlessly — dropEffect 'none'
              // shows the no-drop cursor.
              const ours = e.dataTransfer.types.includes(DUO_FS_PATH_MIME)
              e.preventDefault()
              e.dataTransfer.dropEffect = ours ? 'copy' : 'none'
            }}
            onDrop={(e) => {
              // preventDefault unconditionally so a foreign file drop can't
              // navigate the window; only OUR navigator drags insert.
              e.preventDefault()
              if (!e.dataTransfer.types.includes(DUO_FS_PATH_MIME)) return
              const payload = e.dataTransfer.getData(DUO_FS_PATH_MIME) || e.dataTransfer.getData('text/plain')
              if (!payload || !activeTabId) return
              // D3c — expand a collapsed terminal so the insertion is visible
              // rather than a dead gesture on the 36px rail.
              if (isTerminalCollapsed) toggleCollapseTerminal()
              void window.electron.pty.write(activeTabId, payload)
              setFocusedColumn('terminal')
            }}
            aria-label="Terminal column"
          >
            {isTerminalCollapsed ? (
              <CollapsedPaneRail
                kind="terminal"
                onExpand={toggleCollapseTerminal}
              />
            ) : (
              <>
                <TabBar
                  // ENH-182 Phase 2 — only render visible (= focused-
                  // project member) tabs in the strip. The full `tabs`
                  // array stays passed to TerminalPane below so PTYs
                  // for hidden tabs aren't unmounted.
                  tabs={visibleTerminals}
                  activeTabId={activeTabId}
                  onSelect={setActiveTabId}
                  // Stage 19c D17 — split button. `+` = claude (primary,
                  // opinionated); `>` = shell. Both update the persisted
                  // last-kind so `duo new-tab` without --kind follows the
                  // user's most recent manual selection (D28).
                  onNewClaude={() => {
                    newTab('claude')
                    setLastTabKind('claude')
                    saveLastTabKind('claude')
                  }}
                  onNewShell={() => {
                    newTab('shell')
                    setLastTabKind('shell')
                    saveLastTabKind('shell')
                  }}
                  onClose={closeTab}
                  pendingCwd={pendingCwd}
                  focused={focusedColumn === 'terminal'}
                  // ENH-083 (v0.6.5) — collapse-pane button moved
                  // from titlebar into the new-tab cluster.
                  isTerminalCollapsed={isTerminalCollapsed}
                  onToggleTerminalCollapsed={toggleCollapseTerminal}
                  // ENH-115 (Sprint 12) — right-click → "Reveal in
                  // navigator" reuses the same nav navigateTo + chip
                  // path that `duo reveal <path>` triggers.
                  onRevealCwd={(cwd) => {
                    nav.actions.navigateTo(cwd)
                    setRevealChip(cwd)
                  }}
                  // ENH-188 — terminal-tab reorder (drag + move-left/right
                  // menu) and "Close other tabs", parity with canvas tabs.
                  onReorderTab={reorderTerminalTab}
                  onCloseOthers={closeOtherTabs}
                />
                <div className="flex-1 overflow-hidden">
                  <TerminalPane
                    tabs={tabs}
                    activeTabId={activeTabId}
                    onTitleChange={updateTabTitle}
                    cozyByTab={cozyByTab}
                    cozyDefault={cozyDefault}
                    fontBumpByTab={fontBumpByTab}
                    fontBumpDefault={fontBumpDefault}
                    themeEffective={theme.effective}
                    // BUG-038 — xterm focus events flip focusedColumn so
                    // ⌃Tab cycles terminal tabs (not whatever pane the
                    // synthetic-event path last touched). xterm manages
                    // its own DOM heavily and clicks on it sometimes
                    // miss the column wrapper's onMouseDown.
                    onTerminalFocus={() => setFocusedColumnSilent('terminal')}
                  />
                </div>
              </>
            )}
          </div>

          <div
            className={['split-divider', isDraggingSplit ? 'dragging' : ''].join(' ')}
            onMouseDown={onDividerMouseDown}
          >
            {/* ENH-190 — hover-reveal grip-pill affordance (shared with the
                navigator's right-border handle). */}
            <span className="resize-grip" aria-hidden="true"><i /><i /><i /></span>
          </div>

          {/* BUG-031 — drag overlay. While the divider is being dragged,
              this transparent layer sits over iframes/canvases so
              mousemove keeps bubbling to the window listener instead of
              being trapped inside an iframe's contentDocument. Pattern
              matches VS Code / Figma's resize handles. */}
          {isDraggingSplit && (
            <div
              className="fixed inset-0 z-50 cursor-col-resize"
              aria-hidden="true"
            />
          )}

          <div
            className={[
              // BUG-003 fix (rev 2): see Terminal column. Inset shadow
              // dropped — the WebContentsView occludes 3 of 4 sides, so
              // the ring was misleading. Focus indicator is now inside
              // WorkingTabStrip (renderer DOM, never covered by the
              // WebContentsView).
              //
              // ENH-066 (v0.6.3) — when isCanvasCollapsed (split = 100%),
              // render a fixed-width CollapsedPaneRail INSTEAD of the
              // WorkingPane. The rail is a clickable vertical bar with a
              // canvas glyph; click restores the prior split.
              isCanvasCollapsed ? 'overflow-hidden border-l transition-colors shrink-0' : 'flex-1 overflow-hidden border-l transition-colors min-w-0',
              focusedColumn === 'working' ? 'border-accent' : 'border-transparent'
            ].join(' ')}
            style={isCanvasCollapsed ? { width: '36px' } : undefined}
            onMouseDown={() => setFocusedColumn('working')}
            aria-label="Working pane"
            data-pane="working"
          >
            {isCanvasCollapsed ? (
              <CollapsedPaneRail
                kind="canvas"
                onExpand={toggleCollapseCanvas}
              />
            ) : (
            // BUG-093 instrumentation (v0.6.7) — inline ErrorBoundary
            // scopes WorkingPane render-error containment so a canvas
            // / editor crash leaves the rest of the app (terminal
            // column, file tree, banners, menu) alive instead of
            // dropping the entire renderer to the app-level error
            // page. The "Try again" button remounts WorkingPane via
            // the boundary's retryKey bump; if the underlying state
            // has settled (e.g. mid-mount race resolved), recovery is
            // free. The label "WorkingPane" prefixes the captured
            // console error so post-mortem can tell this fired vs.
            // the app-level boundary.
            <ErrorBoundary inline label="WorkingPane">
            <WorkingPane
              fileTabs={fileTabs}
              // ENH-182 Phase 2 — when a project focus is active,
              // tells the internal WorkingTabStrip to filter to the
              // member set. Hidden tabs stay mounted (via the full
              // `fileTabs` array above) so editor state persists.
              visibleFileTabIds={visibleFileTabIds}
              visibleBrowserTabIds={visibleBrowserTabIds}
              activeWorking={activeWorking}
              setActiveWorking={setActiveWorking}
              closeFileTab={closeFileTab}
              onOpenMarkdown={onOpenMarkdown}
              onTabDirtyChange={onTabDirtyChange}
              onCommitNewFile={onCommitNewFile}
              onNewFile={newMarkdownFile}
              focused={focusedColumn === 'working'}
              // BUG-037 — clicking inside the canvas iframe doesn't
              // bubble out to the column wrapper's onMouseDown, so
              // the canvas explicitly tells us when the user has
              // chosen it. Flips focusedColumn → 'working' so
              // subsequent ⌃Tab / ⌘T fire against the right pane.
              onPageFocusGained={() => setFocusedColumn('working')}
              // Stage 15.1 — Send → Duo pill: pipe the formatted payload
              // into the active terminal's PTY. PRD G11: no Enter
              // appended — the user confirms by pressing Enter
              // themselves. Focus moves to the active terminal so the
              // user can immediately type their verb without an extra
              // click. We need both the React-side `focusedColumn`
              // flip (drives the focus-ring CSS) AND OS-level focus on
              // the xterm helper-textarea so PTY keystrokes route in —
              // mirrors togglePaneFocus's terminal branch.
              //
              // ENH-176 — pill firing is now governed by two
              // independent localStorage flags (see useSendPillFlags).
              // When both could fire (claude live AND both flags on),
              // AGENT wins per owner-locked design 2026-05-23. When
              // only the terminal flag is on (no claude), pill shows
              // 'Send → Terminal' instead of 'Send → agent' but the
              // wire is otherwise identical (PTY write, focus shift).
              onSendToDuo={
                activeTabId && ((claudeLive && sendPillFlags.agent) || (sendPillFlags.terminal && !claudeLive))
                  ? (payload) => {
                      void window.electron.pty.write(activeTabId, payload)
                      setFocusedColumn('terminal')
                      queueMicrotask(() => {
                        const textarea = document.querySelector<HTMLTextAreaElement>(
                          '.xterm-host:not([style*="display: none"]) .xterm-helper-textarea'
                        )
                        textarea?.focus()
                      })
                    }
                  : null
              }
              pillLabel={claudeLive && sendPillFlags.agent ? 'Send → agent' : 'Send → Terminal'}
              pins={pins}
              onTogglePin={togglePin}
              onPlaygroundAction={handlePlaygroundAction}
              homeDir={home}
              // ENH-026 — right-click on WorkingPane tab. Reveal
              // navigates the tree to the file's parent dir + selects
              // the file (the FileTree row scrolls into view, expands
              // ancestors as needed). Trash confirms in the strip's
              // own dialog, then runs files.trash + closes the tab.
              // Rename reveals + dispatches a custom DOM event that
              // FileTree listens to, transitioning the row to
              // rename mode without lifting state.
              onRevealInNavigator={(filePath) => {
                // BUG-053 — atomic reveal (single state update);
                // see nav.actions.revealAndSelect for the rationale.
                nav.actions.revealAndSelect(filePath)
                setFocusedColumn('files')
              }}
              onTrashTabFile={async (id, filePath) => {
                // Sprint 7 rev6 follow-up — if the file is already
                // gone (deleted in Finder, by another tool, or never
                // existed), the trash IPC throws "doesn't exist".
                // The user's intent is unambiguous: close the tab.
                // Treat ENOENT as a no-op success and proceed to the
                // close path; surface other errors via alert.
                let trashed = true
                try {
                  await window.electron.files.trash(filePath)
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err)
                  // Match both ASCII (') and Unicode (’) apostrophes —
                  // Apple's file-not-found errors use the curly quote.
                  if (/doesn['’]?t exist|ENOENT|no such file/i.test(msg)) {
                    trashed = false
                  } else {
                    window.alert(`Move to Trash failed: ${msg}`)
                    return
                  }
                }
                // Strip-id encoding: file tabs are "f:<uuid>",
                // browser tabs are "b:<numericId>". BUG-045 — a
                // file:// browser tab can also reach this handler
                // (Reveal/Trash now exposed for them too) so we
                // need to close whichever kind it actually is.
                if (id.startsWith('f:')) {
                  closeFileTab(id.slice(2))
                } else if (id.startsWith('b:')) {
                  const numericId = parseInt(id.slice(2), 10)
                  if (Number.isFinite(numericId)) {
                    void window.electron.browser.closeTab(numericId)
                  }
                }
                void trashed
              }}
              onStartRenameFromTab={(filePath) => {
                const dir = filePath.slice(0, filePath.lastIndexOf('/')) || '/'
                nav.actions.navigateTo(dir)
                nav.actions.selectItem(filePath, 'file')
                setFocusedColumn('files')
                // Custom event picked up by FileTree's effect; the
                // path is the absolute file path to put into rename
                // mode. requestAnimationFrame defers until the tree
                // has rendered the row.
                requestAnimationFrame(() => {
                  window.dispatchEvent(
                    new CustomEvent('duo-tree-start-rename', { detail: { path: filePath } })
                  )
                })
              }}
              // ENH-041 / Sprint 3 — Split View aux state. CLI verbs
              // (`duo split-view *`) drive auxState via IPC subscribers
              // earlier in this file; the in-renderer ✕ / promote
              // buttons + divider drag flow through these prop
              // callbacks (no IPC round-trip needed when the user
              // clicks a button in their own renderer).
              auxState={auxState}
              auxBrowserTab={auxBrowserTab}
              onAuxClose={splitViewPromote}
              onAuxPromote={splitViewPromote}
              onAuxResize={(pct) => {
                // Phase 3c — divider-drag updates splitPct on whichever
                // slot is active. Mutually exclusive: at most one of
                // auxState / auxBrowserTab is non-null.
                if (auxBrowserTab) {
                  setAuxBrowserTab(prev => prev ? { ...prev, splitPct: pct } : null)
                } else {
                  setAuxState(prev => prev ? { ...prev, splitPct: pct } : null)
                }
              }}
              onMoveTabToSplit={splitViewMoveTabByPath}
              onMoveBrowserTabToSplit={splitViewMoveBrowserTab}
              // ENH-097 — "Edit in canvas" on file:// browser tabs.
              // Closes the browser tab and re-opens the file in
              // canvas mode (forces canvas mount even if the file
              // declares duo-open-in: browser, so the user can edit
              // playground source while scripts stay inert).
              onEditBrowserTabInCanvas={(browserTabId, filePath) => {
                void window.electron.browser.closeTab(browserTabId)
                const name = filePath.slice(filePath.lastIndexOf('/') + 1) || filePath
                void openFileSmart(filePath, name, 'canvas')
              }}
              // ENH-131 — inverse direction. Right-click on a canvas
              // tab → "Open in browser" closes the canvas tab and
              // re-opens the file as a browser tab so scripts run /
              // buttons fire. Mirrors onEditBrowserTabInCanvas.
              onOpenCanvasTabInBrowser={(fileTabId, filePath) => {
                closeFileTab(fileTabId)
                const name = filePath.slice(filePath.lastIndexOf('/') + 1) || filePath
                void openFileSmart(filePath, name, 'browser')
              }}
              // ENH-083 (v0.6.5) — collapse-canvas button moved from
              // titlebar into the new-tab cluster.
              isCanvasCollapsed={isCanvasCollapsed}
              onToggleCanvasCollapsed={toggleCollapseCanvas}
              // ENH-085 (v0.6.5) — Move to Trash from aux header
              // right-click. AuxHeader handles confirmation; this
              // callback runs the actual file operation + clears the
              // aux state. No need to close a tab (the aux's only
              // path IS the file we just trashed, so dropping
              // auxState completes the workflow).
              onAuxTrash={async (filePath) => {
                try {
                  await window.electron.files.trash(filePath)
                  setAuxState(null)
                } catch (err) {
                  window.alert(`Move to Trash failed: ${err instanceof Error ? err.message : String(err)}`)
                }
              }}
            />
            </ErrorBoundary>
            )}
          </div>
        </div>
      </div>
      {/* Sprint 11 ENH-096 B.4 — VaultQuickSwitcher overlay (⌘O).
          Mounted parallel to TabSearchPalette so the same z-index
          rules apply. Sources its file list from the vault index
          keyed off the active file's path. */}
      <VaultQuickSwitcher
        open={vaultQuickSwitcherOpen}
        files={vaultIndexForSwitcher.files}
        loading={vaultIndexForSwitcher.loading}
        vaultRoot={vaultIndexForSwitcher.vaultRoot}
        onPick={(file) => {
          setVaultQuickSwitcherOpen(false)
          const name = file.basename + (file.ext ? '.' + file.ext : '')
          void openFileSmart(file.absPath, name)
          // Sprint 11 walk-3 fix — when ⌘O Enter picks a file, the
          // overlay's input loses focus on unmount. Without an
          // explicit reclaim, OS-level focus can land on document.
          // body before openFile's rAF chain runs, so the contenteditable.
          // focus() succeeds at the DOM layer but the user perceives
          // the new tab as "background." Same fix shape as BUG-103
          // (⌘T URL-bar focus).
          window.electron.keyboard?.reclaimFocus?.()
        }}
        onDismiss={() => setVaultQuickSwitcherOpen(false)}
      />
      {/* ENH-080 — tab-search palette overlay. Mounted at the top of
          the app so its z-50 sits above the working pane and titlebar.
          The palette dismisses on Esc / backdrop-click / pick. */}
      <TabSearchPalette
        open={tabSearchOpen}
        entries={tabSearchEntries}
        onPick={(entry) => {
          setTabSearchOpen(false)
          // ENH-080 walk-1 fix — for aux entries, just dismiss + focus
          // the working column. The picked tab is already the aux
          // pane's active tab; calling switchTab / setActiveWorking
          // would route it to the main pane and break the split.
          if (entry.inAux) {
            setFocusedColumn('working')
            return
          }
          if (entry.id.startsWith('f:')) {
            setActiveWorking({ kind: 'file', id: entry.id.slice(2) })
          } else if (entry.id.startsWith('b:')) {
            const numericId = parseInt(entry.id.slice(2), 10)
            if (Number.isFinite(numericId)) {
              void window.electron.browser.switchTab(numericId)
              setActiveWorking({ kind: 'browser' })
            }
          }
          setFocusedColumn('working')
        }}
        onDismiss={() => setTabSearchOpen(false)}
      />
    </div>
  )
}
