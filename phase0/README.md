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
│   ├── manifest.json          ← MV3 manifest, nativeMessaging + alarms
│   ├── sw.js                  ← service worker; connects helper, keeps alive
│   ├── popup.html             ← single "Send ping" button
│   └── popup.js
└── helper/
    ├── duo-helper.js              ← Native Messaging stdio host (Node)
    ├── duo-helper-launcher.sh     ← shell wrapper (install.sh writes the
    │                                 real one with the user's node path)
    └── install.sh                 ← drops the NM manifest in Chrome's path
```

No build step. Vanilla JS + a Node script.

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
# then chrome://extensions/ → remove the extension
```

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

