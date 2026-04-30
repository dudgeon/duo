# Duo Phase 0 — Native Messaging keep-alive proof

The load-bearing test from
[`docs/research/duo-as-chrome-extension/build-roadmap.md` § Stage B](../docs/research/duo-as-chrome-extension/build-roadmap.md#stage-b--phase-0-keep-alive-proof-the-load-bearing-gate).

**The question:** does an MV3 service worker + Native Messaging
helper survive 30 minutes of zero user interaction without the SW
going idle and killing the native host?
[claude-code#16350](https://github.com/anthropics/claude-code/issues/16350)
documents the failure mode for Anthropic's own Claude Code browser
extension; this test reproduces the same architecture and checks
whether a `chrome.alarms` keep-alive at 25-second cadence dodges it.

If this passes, Stage C MVP is unblocked. If this fails after
exhausting the keep-alive options, the entire Chrome-extension shape
needs to be reconsidered.

## What's here

```
phase0/
├── extension/                 ← load this as an unpacked extension
│   ├── manifest.json          ← MV3 manifest, nativeMessaging + alarms
│   ├── sw.js                  ← service worker; connects helper, keeps alive
│   ├── popup.html             ← single "Send ping" button
│   └── popup.js
└── helper/
    ├── duo-helper.js          ← Native Messaging stdio host (Node)
    └── install.sh             ← drops the NM manifest in Chrome's path
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
