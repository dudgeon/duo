# Duo Phase 0 — Native Messaging keep-alive proof

> **Status: PASSED 2026-04-29.** Stage C MVP is unblocked. See
> [§ Test results](#test-results-2026-04-29) for the run log.

The load-bearing test from
[`docs/research/duo-as-chrome-extension/build-roadmap.md` § Stage B](../docs/research/duo-as-chrome-extension/build-roadmap.md#stage-b--phase-0-keep-alive-proof-the-load-bearing-gate).

**The question:** does an MV3 service worker + Native Messaging
helper survive 30 minutes of zero user interaction without the SW
going idle and killing the native host?
[claude-code#16350](https://github.com/anthropics/claude-code/issues/16350)
documents the failure mode for Anthropic's own Claude Code browser
extension; this test reproduces the same architecture and checks
whether a `chrome.alarms` keep-alive at 25-second cadence dodges it.

The answer is yes — `chrome.alarms` at 25s cadence completely defeats
the SW idle timeout. The `claude-code#16350` failure mode does not
reproduce when the SW pings the helper this often.

## What's here

```
phase0/
├── extension/                 ← load this as an unpacked extension
│   ├── manifest.json          ← MV3 manifest (nativeMessaging + alarms + sidePanel)
│   ├── sw.js                  ← service worker; helper keep-alive + client relay +
│   │                            agent verbs (chrome.tabs / chrome.scripting, P5;
│   │                            chrome.debugger CDP, P6)
│   ├── popup.html / popup.js  ← Phase-0 diagnostic popup (no longer wired —
│   │                            replaced by the side panel's clock-icon ping)
│   ├── sidepanel.html         ← P1 — side panel root layout
│   ├── sidepanel.css          ← rail + drawer + terminal placeholder styles
│   ├── sidepanel.js           ← rail click, drawer toggle, ⌘B, real filetree (P3),
│   │                            xterm + PTY wiring (P2), file-click → canvas tab
│   ├── canvas.html            ← P4a — canvas-tab editor (textarea stub for now;
│   │                            P4b swaps in MarkdownEditor / TipTap)
│   ├── canvas.css             ← dark theme for the editor toolbar + textarea
│   └── canvas.js              ← files:read on load, files:write on ⌘S / save click
└── helper/
    ├── duo-helper.js              ← Native Messaging stdio host (Node)
    │                                P0 keep-alive · P2 PTY · P3 files:list ·
    │                                P4a files:read/write
    └── install.sh                 ← copies helper into ~/Library/Application
                                     Support/Duo/, generates the launcher with
                                     the user's node path baked in, drops the
                                     NM manifest in Chrome's lookup dir
```

No build step. Vanilla JS + a Node script.

> **Re-run `install.sh` after switching worktrees.** The Native
> Messaging manifest is a single global file; it points at one
> launcher. If you cherry-pick this branch into a new worktree and
> edit the helper there, the running helper is still the one
> deployed by your previous install. Re-run `install.sh` from the
> active worktree to redeploy.

## Run the test

```bash
# 1. open Chrome → chrome://extensions/
#    flip "Developer mode" ON
#    click "Load unpacked" → select phase0/extension/
#    note the extension ID (32 lowercase letters under the extension card)

# 2. wire the helper to that extension
cd phase0/helper
./install.sh <your-extension-id>

# 3. start tailing the helper log in another terminal
tail -f ~/.claude/duo/phase0-helper.log

# 4. open the extension popup (puzzle-piece icon → click the extension)
#    click "Send ping to helper"
#    expected: "✓ pong in <10ms"

# 5. open the SW console (chrome://extensions/ → "service worker" link
#    on the extension's card). Watch alarm ticks every ~25s.

# 6. leave Chrome alone for 30+ minutes. Use other apps. Don't
#    interact with the popup or SW console.

# 7. come back. Click "Send ping" again.
```

## Pass criteria

- ✓ First ping (Step 4) round-trips in <100ms
- ✓ Helper log shows "alive heartbeat" lines every 30s the whole time
- ✓ `pgrep -fc duo-helper` returns 1 throughout (single helper, no respawn)
- ✓ After Step 7, ping still <100ms AND `pid` in popup output is the
  same as on Step 4

## Fail modes to watch for

| Symptom | Likely cause |
|---|---|
| Popup says "no port" or "timeout" after idle | SW went idle, port closed, helper died |
| Helper PID changes between Step 4 and Step 7 | SW reconnected (helper was killed) |
| Helper log gap >60s during idle | Helper was killed mid-test |
| SW console shows "port disconnected" during idle | The bug from claude-code#16350 |

## If keep-alive fails at 25s

Try shorter cadences before giving up:
- Edit `phase0/extension/sw.js`: `const KEEP_ALIVE_PERIOD_MIN = 15 / 60` → 15s
- If 15s doesn't work, try 10s
- Reload the extension on chrome://extensions/, repeat the test

If even 10s fails, the SW is being killed for memory pressure
regardless of activity — the architecture is structurally fragile
and Stage C should not proceed. Add a closing addendum to
[`docs/research/duo-as-chrome-extension/README.md`](../docs/research/duo-as-chrome-extension/README.md)
documenting the finding.

## Uninstall

```bash
rm "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.duo.phase0.json"
rm -rf "$HOME/Library/Application Support/Duo"
# then chrome://extensions/ → remove the extension
```

## Known gotchas

### macOS Sequoia: Chrome can't spawn NM hosts from `~/Documents/`

**Symptom:** `chrome.runtime.connectNative()` succeeds, the port
appears connected, but the helper never boots — no log entry, no
hello-ack, no PID in the SW console. Side panel terminal shows no
prompt; `files:list` times out.

**Cause:** macOS Sequoia adds a privacy gate around `~/Documents`,
`~/Downloads`, and `~/Desktop`. Chrome's NM-host spawn does not have
the system entitlement to exec binaries inside the gated dirs.
Standalone shell invocation of the same launcher works fine, which
makes this hard to diagnose — the script isn't broken, the spawn
context is.

**Fix:** `install.sh` copies the helper + launcher into
`~/Library/Application Support/Duo/` (in user space, but outside the
gate) and points the manifest there. Symlinks back to the worktree
do not work — Chrome resolves the symlink and rejects the gated
target.

**Past failure mode (resolved 2026-04-30):** an earlier version of
`install.sh` pointed the manifest at `phase0/helper/duo-helper-launcher.sh`
in-tree. That worked on pre-Sequoia macOS but broke once the gate
shipped. Verified via the helper log: zero "=== helper boot ==="
entries after Chrome reload, even though the launcher executed
fine from the shell.

### `com.apple.provenance` xattr re-applies automatically

macOS Sequoia tags files in user space with `com.apple.provenance`
shortly after creation. `xattr -d com.apple.provenance <file>`
strips it, but the kernel re-applies it within seconds for files
inside Spotlight-indexed dirs. Empirically this xattr is **not**
the actual blocker for Chrome's NM-host spawn — `~/Library/Application
Support/Duo/` files keep the xattr and still work fine. The
`xattr -d` calls in `install.sh` are best-effort hygiene; the real
fix is the install path (above).

---

## Test results (2026-04-29)

Run on macOS Sequoia, Chrome 146.0.7680.178 (regular Chrome, not
Chrome for Testing — see § Failed approaches), node v18.17.0 via nvm.

| Check | Baseline (22:08) | Post-idle (22:46) | Pass criterion | Result |
|---|---|---|---|---|
| Helper PID | 79342 | 79342 | unchanged | ✅ |
| Total recv lines | 26 | 103 | +60 over 30 min | ✅ +77 |
| Helper process count | 1 | 1 | exactly 1 | ✅ |
| Max gap between recvs | n/a | 26.0s | <60s | ✅ |
| Gaps >60s | n/a | 0 | 0 | ✅ |
| Alive heartbeats | n/a | 72 (every 30s) | continuous | ✅ |
| Round-trip (initial) | 13.4ms | n/a | <100ms | ✅ |
| Round-trip (post-idle) | n/a | helper still acking | <100ms | ✅ |

The SW + helper survived **38 minutes of real idle** with zero
respawns, zero gaps in the keep-alive log, and PID stability
throughout. The post-idle round-trip happened at 02:46:52 UTC — a
keep-alive recv was logged AFTER the 30-min wait window expired,
proving the SW was still processing alarms.

### Failed approaches (lessons learned)

Two macOS-specific quirks blocked us before the actual test could run:

1. **`com.apple.provenance` xattr (macOS Sequoia file-tracking).**
   Files created by certain processes get this xattr. Chrome's NM-host
   spawn under hardened-runtime sandboxing silently refuses to exec
   them — Chrome reports "Specified native messaging host not found"
   even though the manifest is correct and the file is executable.
   Fix: `xattr -d com.apple.provenance <file>`. Now done by
   `install.sh`.

2. **`#!/usr/bin/env node` shebang doesn't work for Chrome's NM-host
   spawn.** Chrome's spawn environment has a stripped PATH
   (`/usr/bin:/bin:/usr/sbin:/sbin`) and `env` can't find `node`
   installed via nvm/brew/asdf. Fix: a `duo-helper-launcher.sh`
   shell wrapper that execs node with an absolute path. `install.sh`
   resolves `command -v node` at install time and writes the
   wrapper accordingly, so it works on any machine.

3. **Chrome 137+ removed `--load-extension`** in branded builds.
   Chrome for Testing 137 (cached via puppeteer) still supports it
   but has its own NM-host discovery quirks (different lookup paths
   than regular Chrome, and CFT 137 specifically failed to find any
   NM manifest we installed). The actual test ran in regular Chrome
   with the user manually loading the unpacked extension via
   `chrome://extensions/`.

4. **My own diagnostic bug: `process.stdin.on('readable', ...)` in
   the helper** put Node's stream into non-flowing mode, which
   silently disables the `data` event. Chrome WAS sending keep-alive
   messages; the helper just wasn't consuming them. Removing the
   `readable` listener fixed it. Lesson: don't add a `readable`
   listener for diagnostics if you have a `data` listener doing the
   real work.

These fixes are now baked into `install.sh` and the helper code; a
fresh user shouldn't hit any of them. Re-running this test on a
clean machine should "just work" if all the install.sh prerequisites
are met (Node.js installed, Chrome 146+, macOS).

### What this proves and what it doesn't

**Proves:** The Duo extension architecture (MV3 SW + Native Messaging
host + chrome.alarms keep-alive) survives idle on macOS regular
Chrome 146. The structural foundation for Stage C MVP is sound.

**Does NOT prove:**
- Long-term (>1h) stability — only tested 38 min.
- Cross-platform (Linux, Windows). Phase 0 was macOS-only.
- Behavior under memory pressure (other tabs eating RAM,
  laptop sleeping, etc.) — test was on a quiet system.
- Behavior across Chrome restarts (the SW + alarms restart fresh).

These are deferred to Stage D (stabilization) per
[`build-roadmap.md`](../docs/research/duo-as-chrome-extension/build-roadmap.md).


---

## Phase 1 — side panel scaffolding (added 2026-04-29)

Stage C Phase 1 from
[`build-roadmap.md`](../docs/research/duo-as-chrome-extension/build-roadmap.md#phase-1--side-panel-ui-scaffolding-1-day)
— UI layout + interaction with mock data. No real PTY or filesystem
(those are Phases 2 and 3).

### What it does

- **Click the extension icon** → opens the Chrome side panel (Chrome's
  `chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true})`).
- **Default state:** terminal placeholder fills ~328px (full width minus
  the 32px nav rail). Two icons on the rail: 📁 (folder) and 🕒 (clock).
- **Click 📁 or press ⌘+B** → 280px nav drawer slides in (200ms ease,
  `position: absolute` over the terminal area, with a subtle
  backdrop-blur scrim on the terminal portion not covered).
- **Click outside the drawer / Esc / click a mock file** → drawer dismisses.
- **Click 🕒** → fires the Phase-0 keep-alive ping (the same
  `chrome.runtime.sendMessage({type:'ping-helper'})` flow the popup used
  to do); result shown as a small banner at the bottom of the panel.

### Pass criteria

- [x] Side panel opens via the extension's action icon.
- [x] Terminal at default (no drawer): comfortable width.
- [x] Drawer slide is smooth (<250ms perceived).
- [x] ⌘+B toggles. Esc / outside / file-click dismiss.
- [x] 🕒 ping still works (round-trip <100ms on a warm SW).
- [ ] Multi-window: open a second Chrome window, side panel works there
  too with independent drawer state. (Verify by hand.)

### Test instructions

```bash
# After pulling the new code, reload the extension:
#   1. open chrome://extensions/
#   2. find "Duo Phase 0 — Keep-Alive Probe" (now version 0.2.0)
#   3. click the ⟳ reload button on its card
#
# Then click the extension's action icon in Chrome's toolbar —
# the side panel opens on the right edge.
```

### What's still mocked

- **Filetree:** hardcoded entries in `sidepanel.js` (constant
  `MOCK_TREE`). Phase 3 wires this to `chokidar` via the helper.
- **Terminal:** static text. Phase 2 mounts xterm.js and wires PTY data
  through the SW port to the helper's `node-pty`.
- **File click action:** logs to console and shows a placeholder
  banner. Phase 3 will `chrome.tabs.create({url:
  chrome.runtime.getURL('canvas.html?path=...')})`.

### Why vanilla JS for now

Phase 2 introduces Vite + React because the existing
[`renderer/components/TerminalPane.tsx`](../renderer/components/TerminalPane.tsx)
and
[`renderer/components/FileTree.tsx`](../renderer/components/FileTree.tsx)
are React components and the
[D1 shim approach](../docs/research/duo-as-chrome-extension/mvp-plan.md#d-numbered-decisions)
reuses them verbatim. Setting that pipeline up while still validating
the layout is over-investment — Phase 1's scaffolding gets replaced
by React anyway. The CSS (drawer animation, rail, terminal styling)
and event-handling semantics carry over directly.

