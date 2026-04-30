# Tonight's verification checklist — Phases 5, 6, 6.5

Walk this top to bottom. Each step has a clear "expected" outcome
and a "what to tell Claude" if it fails. Total time: ~10 minutes.

---

## 0 — Pre-flight (1 minute)

The exploration's `phase0/` directory only exists in the worktree
(not on `main`), so use the absolute path so this works from any cwd:

```bash
bash ~/Documents/GitHub/duo/.claude/worktrees/elegant-sanderson-05aa7a/phase0/helper/install.sh iheckmlfnjoppacjalemgdhhlejmgmod
```

Expected output ends with:
```
✓ Native Messaging manifest installed
  ...
  cli symlink: /Users/geoffreydudgeon/.claude/bin/duo-ext -> ...
```

Then **reload the extension at `chrome://extensions/`** (toggle off
and on, or hit the circular reload arrow on the Duo card).

> Chrome will re-prompt for the new permissions added since you last
> reloaded: `tabs`, `scripting`, `<all_urls>`, `debugger`. Grant all.

---

## 1 — Phase 5 (chrome.tabs / chrome.scripting)

Open the side panel from the Chrome toolbar. You should see four
icons stacked in the left rail (top → bottom):

1. **Folder** — file navigator drawer (existing, ⌘B)
2. **Clock** — Phase-0 ping diagnostic (existing)
3. **Tabs (rectangle/window glyph)** — NEW, Phase 5 tabs:list
4. **Script (chevron pair `‹›`)** — NEW, Phase 5 scripting:title
5. **Gear** — NEW, Phase 6 cdp:eval

> If you see only 2 icons (folder + clock), the extension didn't
> reload. Force-reload at `chrome://extensions/` and retry.

### Test 1a — agent:tabs:list

Click the **Tabs** icon.

**Expected banner:** `✓ N tabs — active: <truncated title>`

(N matches your actual tab count; the title is whichever tab is
currently focused in Chrome.)

**If it fails:** screenshot the banner + open the SW console at
`chrome://extensions/` → "service worker" → paste any red errors.

### Test 1b — agent:scripting:title

Switch to a non-extension Chrome tab (gmail, news, anything). Make
sure that tab is **active** (clicked into).

Click the **Script** icon.

**Expected banner:** `✓ tab #<id>: <document.title of the tab>`

**If it fails:** same diagnostics as 1a.

---

## 2 — Phase 6 (chrome.debugger CDP)

Make sure you have a **non-extension tab active** (any regular
website). Watch for the yellow "Duo started debugging this tab" bar
that Chrome will flash at the top of that tab.

Click the **Gear** icon.

**Expected sequence:**
1. Banner: `→ CDP eval (1+1)... (yellow "Duo started debugging" bar will flash)`
2. Yellow Chrome bar appears briefly at the top of the active tab
3. Banner: `✓ tab #<id> CDP eval → number 2`
4. Yellow bar disappears (auto-detach in `finally`)

**If the yellow bar persists:** click somewhere on the page; it
should clear. If it sticks, click the gear icon again — the
re-attach + re-detach will reset it.

---

## 3 — Phase 6.5 (CLI bridge — the load-bearing test)

This proves the extension can be driven from a terminal, including
inside a sandboxed Claude Code session. Run from any normal
terminal first:

### Test 3a — doctor

```bash
~/.claude/bin/duo-ext doctor
```

**Expected output (something like):**
```
duo-ext doctor
  socket path: /Users/geoffreydudgeon/Library/Application Support/Duo/duo-helper.sock
  port file:   /Users/geoffreydudgeon/Library/Application Support/Duo/duo-helper.port
  unix socket: OK
  tcp port:    127.0.0.1:<random-port>
  tcp socket:  OK
```

**If `unix socket: FAIL`:** the helper isn't running. Click any of
the rail buttons in the side panel to wake the SW, then retry.
**If both fail:** extension wasn't reloaded.

### Test 3b — list tabs

```bash
~/.claude/bin/duo-ext tabs
```

**Expected:** JSON array of your open Chrome tabs. Try with the
human format too:

```bash
DUO_FORMAT=human ~/.claude/bin/duo-ext tabs
```

Should print one line per tab, asterisk on the active one.

### Test 3c — title

```bash
~/.claude/bin/duo-ext title
```

**Expected:** active tab's `document.title` as JSON. Switch the
active Chrome tab and rerun — output should change.

### Test 3d — CDP eval

```bash
~/.claude/bin/duo-ext eval '1+1'
```

**Expected:** `2` (and the yellow CDP bar flashes on the active
tab, same as Test 2).

### Test 3e — the sandbox question

**Open a Claude Code session in a new terminal.** From inside that
session, run:

```bash
~/.claude/bin/duo-ext doctor
```

**Expected:** `unix socket: FAIL` (sandbox blocks Unix sockets) but
`tcp socket: OK`, and a final line: `→ falling back to TCP (Unix
socket blocked, likely sandboxed)`.

Then:
```bash
~/.claude/bin/duo-ext tabs
```

**Expected:** same JSON output as Test 3b. The TCP fallback heals
the sandbox transparently.

**This is the critical test.** If 3e works, the architecture is
fully proven for Duo's "agent in any terminal drives the browser"
premise.

---

## 4 — Report back

Tell me which tests passed and any banner/log output for failures.
Format suggestion:

```
1a tabs:list → ✓
1b scripting:title → ✓
2 cdp:eval → ✓
3a doctor → ✓ (unix + tcp both OK)
3b tabs → ✓
3c title → ✓
3d eval → ✓
3e sandboxed doctor → ✓ (unix FAIL, tcp OK, fallback line printed)
3e sandboxed tabs → ✓
```

Anything ✗, drop the banner text or the duo-ext stderr.

---

## 5 — Once everything's green

I'll flip the build-roadmap rows from 🟡 → ✅ and we'll move into
Phase 7 (the NM-shim refactor). Plan is at
[`docs/research/duo-as-chrome-extension/phase7-implementation-plan.md`](../docs/research/duo-as-chrome-extension/phase7-implementation-plan.md).

Stage A merge to main is the gating step before any Phase 7 code —
that needs your time on the Electron app for a smoke walk per
`docs/dev/smoke-checklist.md`.
