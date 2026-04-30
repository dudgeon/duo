# Duo-as-Chrome-extension exploration — research project

**Status:** Proposed 2026-04-29. **Pre-walk feasibility analysis** — no
prototype built yet. This document scopes a walking skeleton and
makes a preliminary call on whether to actually walk it.

**Sibling research:** [`../duo-in-browser/README.md`](../duo-in-browser/README.md)
explored a related-but-distinct shape (Duo as a local web app served
from a Node daemon, viewed in a normal browser tab). That one was
walked and shelved. The Chrome-extension variant differs along three
axes (rendering surface, transport, ability to drive other tabs)
significant enough to warrant its own analysis.

---

## TL;DR

The shape under test: **Duo ships as a Chrome extension + a local
helper daemon, with no Electron app at all.** The extension's side
panel hosts the file navigator and terminal; canvas surfaces (markdown
+ HTML) live in regular browser tabs the extension opens; agents drive
the user's *real* Chrome tabs via `chrome.debugger`, eliminating the
embedded-browser problem entirely.

**Three blocking-class facts** before any code is written:

1. **Side panel minimum width is 360px**, fixed by Chrome, not
   adjustable by the extension. Users can drag wider but it doesn't
   persist across sessions ([chromium issue 40926440](https://issues.chromium.org/issues/40926440)).
   A 360px column hosting both a file tree (~280–320px feels right)
   AND a terminal (xterm at 360px is roughly 50 columns of monospace —
   tight for any real code) is structurally cramped. Stacking
   vertically inside that 360px works but gives each surface ~half
   the screen height.
2. **A local helper daemon is unavoidable.** Chrome extensions cannot
   spawn PTYs, watch arbitrary filesystem paths, or own long-lived
   processes. The terminal pane needs `node-pty` running outside the
   browser. Communication path: extension service worker
   ↔ Native Messaging stdio ↔ Node helper. This is well-supported
   ([chrome.runtime.connectNative](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging))
   and bidirectional in MV3.
3. **The MV3 service worker idle / native-host death problem is a
   real, documented papercut.** Anthropic's *own* Claude Code browser
   extension hit exactly this:
   [anthropics/claude-code#16350](https://github.com/anthropics/claude-code/issues/16350)
   — "the MV3 service worker appears to go idle, which closes the
   native messaging port and terminates the native host." The 30-second
   idle timeout is mitigable with keep-alive traffic (extension API
   calls and active WebSocket / Native Messaging port traffic both
   reset the timer per
   [the lifecycle docs](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)),
   but the mitigation is constant ambient effort, and a single 5-minute
   blocking handler still gets killed regardless.

**Preliminary call:** **Worth a walking skeleton, with a tight scope.**
The architecture has at least three forks where a 30-minute experiment
collapses an unknown into a fact (SW lifetime under realistic idle,
side-panel ergonomics at 360px, distribution friction of the
extension + helper pair). Pre-committing to the full re-platform on
desk research alone would be irresponsible; refusing to walk it
because it *might* not work would skip past leverage that's already
visible (no embedded-browser headache, native session capture in the
user's real Chrome, no notarization gauntlet for the renderer surface).

The "embedded browser" question the user raised — *can the right pane
hold a browser tab without inception?* — has a clean answer. **No
inception needed.** The extension drives the user's existing Chrome
tabs via `chrome.debugger`; there's no embedded right-pane browser to
recreate. The right pane goes away in this shape. See § Surface map.

---

## Why explore this in the first place

Three forces compound:

1. **The Electron build carries weight that an extension wouldn't.**
   Notarization, code signing, auto-update, DMG distribution, app
   bundle ID gymnastics — every release of the Duo Electron app has to
   go through this gauntlet ([Stage 21 cert procurement](../../dev/cert-procurement.md)
   exists for a reason). A Chrome extension distributes through the
   Web Store with a single signed package and has zero macOS
   notarization surface. This is the strongest "obvious win" on offer.
2. **The user's authenticated browser session is right there.**
   Walk 4 of [`../duo-in-browser/README.md`](../duo-in-browser/README.md)
   already proved that an agent driving the user's real Chrome via
   CDP-over-TCP captures the user's full SaaS session surface. A
   Chrome extension makes this even cleaner — no separate Chrome
   instance, no `--remote-debugging-port` flag, no separate user-data-dir.
   `chrome.debugger.attach({tabId})` and you're driving the tab the
   user is currently logged into.
3. **The renderer code is mostly portable.** `duo-in-browser` proved
   the `window.electron` shim approach (D1 in that exploration's
   design doc) lets every component under
   [`renderer/components/`](../../../renderer/components/) host
   verbatim if the shim forwards calls to a daemon. The same trick
   transposes to an extension: the shim forwards over
   `chrome.runtime.connect` ports to the service worker, which
   forwards over Native Messaging to the helper. Same renderer code,
   different transport.

These do not yet demonstrate that the extension shape is *better*
than the Electron shape — only that it might be cheaper to maintain
and might unlock the user's session surface natively. Walking
skeleton needs to test whether the cost of MV3 service-worker
ergonomics outweighs those wins.

---

## Surface map

The user's question — "side panel hosts navigator + terminal, right
pane hosts canvas + browser, can we sub-tab the canvases, do we get
browser-tab inception?" — translates surface-by-surface as follows.

```
┌──────────────────────── Chrome window (the user's actual Chrome) ─────────────────────┐
│                                                                                        │
│  ┌─ regular tabs ──────────────┐  ┌─ canvas tab #1 ─┐  ┌─ canvas tab #2 ─┐  ┌─ … ─┐  │
│  │ gmail, jira, docs, etc.     │  │ foo.md          │  │ deck.html       │  │     │  │
│  │ ← extension drives these    │  │ MarkdownEditor  │  │ HtmlCanvas      │  │     │  │
│  │   via chrome.debugger        │  │ (full surface)  │  │ (full surface)  │  │     │  │
│  └──────────────────────────────┘  └─────────────────┘  └─────────────────┘  └─────┘  │
│                                                                                        │
│  ┌──────────── side panel (360px min, attached to right edge) ──────────────────────┐ │
│  │ [📁]                                                                              │ │
│  │ [⚙ ]   ← 32px icon rail (always visible)                                         │ │
│  │ [ ]                                                                               │ │
│  │ [ ]    [ TerminalPane                                                            ]│ │
│  │ [ ]    [   xterm at ~44 columns wide (full width minus rail)                     ]│ │
│  │ [ ]    [   click 📁 or press ⌘+B → drawer slides in over terminal                ]│ │
│  │ [ ]    [                                                                         ]│ │
│  │                                                                                   │ │
│  │   ┌─ NavDrawer (overlays terminal when open) ─┐                                  │ │
│  │   │  FileTree                                  │                                 │ │
│  │   │   project files, click → opens in new tab  │                                 │ │
│  │   │   click outside / Esc / file click → close │                                 │ │
│  │   └────────────────────────────────────────────┘                                 │ │
│  └───────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                          ▲
                          chrome.runtime.connect (port)
                                          │
                                  ┌───────┴────────┐
                                  │ service worker │  ← extension SW (ephemeral, 30s idle)
                                  └───────┬────────┘
                                          │
                                Native Messaging (stdio JSON)
                                          │
                                  ┌───────┴────────┐
                                  │  Node helper   │  ← long-lived only while SW alive
                                  │  · node-pty    │
                                  │  · chokidar    │
                                  │  · fs r/w      │
                                  └────────────────┘
```

### Side panel: terminal first, navigator on demand

- **Width: 360px minimum, Chrome-imposed.** Confirmed:
  [chrome.sidePanel docs](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
  and the [chromium tracker](https://issues.chromium.org/issues/40926440).
  The extension cannot set a custom min/max. Users drag, doesn't
  persist.
- **The default state is terminal-only.** A 32px icon rail on the
  leading edge stays put; the rest of the panel (~328px ≈ ~44
  columns of monospace) is the terminal. That's still tight for
  `git diff`, but enough for the agent's command surface and for
  reading short outputs.
- **The navigator is a hover drawer**, not a stacked top half.
  Click the folder icon on the rail (or press ⌘+B) → a 280px
  filetree drawer slides in `position: absolute` over the terminal,
  200ms ease, with a backdrop blur so the terminal stays partially
  visible. Click outside / Esc / file click → drawer collapses.
  This buys back the terminal's full real estate at default and
  accepts a one-click cost when the user wants to navigate.
- The drawer pattern is tracked as **D3** in
  [`./mvp-plan.md`](./mvp-plan.md).
  [`renderer/components/FileTree.tsx`](../../../renderer/components/FileTree.tsx)
  hosts inside the drawer with no behavioral changes.
- **Stretching wider stays available** — the user can still drag the
  panel out for a session (lost on restart). Document the gesture;
  the hover drawer makes it less load-bearing than it would be
  otherwise.
- **One terminal at a time** in MVP. Multi-PTY tab strip is deferred
  (see `mvp-plan.md` D7).

### Canvas surfaces: tabs, not sub-tabs

- **Each canvas opens in its own Chrome tab.** `duo edit foo.md` →
  `chrome.tabs.create({url: chrome.runtime.getURL('canvas.html?path=foo.md')})`.
  Each tab hosts a full-bleed copy of either
  [`renderer/components/editor/MarkdownEditor.tsx`](../../../renderer/components/editor/)
  or [`renderer/components/HtmlCanvas/`](../../../renderer/components/HtmlCanvas/),
  same renderer code as today, talking to the SW over a port.
- **The user gets native tab affordances for free** — Chrome's tab
  strip, ⌘+1/2/3 navigation, drag-to-reorder, drag-out-to-new-window,
  right-click pin. No need to build any of this.
- **Sub-tabs inside a single canvas tab are not necessary.** The user
  asked about it; the answer is the canvas-per-tab model gives the
  same affordance with less complexity.
- **State coordination:** the tree view and the open canvas tabs all
  hit the helper daemon for file I/O. The daemon is the single source
  of truth. Tabs subscribe to file-change events through the SW.

### Browser surface: no inception, no embedded browser

- **The right pane goes away.** The user's regular Chrome tabs
  *are* the browser surface. The agent drives them through
  Chrome's existing tab APIs and, where needed, the in-process CDP
  gateway exposed to extensions.
- **No `WebContentsView` to replicate.** Today's
  [`electron/browser-manager.ts`](../../../electron/browser-manager.ts)
  + [`electron/cdp-bridge.ts`](../../../electron/cdp-bridge.ts) become
  unnecessary in this shape.

#### Control mechanism: still CDP at the protocol layer, not at the transport layer

A clarification worth saying out loud: even with no embedded browser
of our own, agents *still* drive Chrome tabs via the Chrome DevTools
Protocol — but the *transport* changes materially.

- **Protocol layer — still CDP.** `Page.navigate`,
  `Page.captureScreenshot`, `Runtime.evaluate`,
  `Accessibility.getFullAXTree`, `Input.dispatchKeyEvent` — same
  command surface
  [`electron/cdp-bridge.ts`](../../../electron/cdp-bridge.ts) drives
  today. The skill ports almost line-for-line.
- **Transport layer — `chrome.debugger.attach({tabId})`, not
  `--remote-debugging-port`.** This is Chrome's *internal* CDP
  gateway, exposed to extensions that hold the `debugger`
  permission ([API ref](https://developer.chrome.com/docs/extensions/reference/api/debugger)).
  No TCP port flag, no separate Chrome instance, no user-data-dir
  gymnastics, no Seatbelt sandbox crossing. Chrome routes the
  protocol in-process. **Materially better than the
  CDP-over-TCP path** that
  [`../duo-in-browser/README.md` Walk 4](../duo-in-browser/README.md)
  validated; the recommended-next-step "fork chrome-cdp-skill, swap
  Unix sockets for TCP+token" becomes *unnecessary* in this shape —
  the extension *is* the bridge.
- **The yellow infobar UX papercut.** Whenever an extension calls
  `chrome.debugger.attach`, Chrome displays a non-dismissable yellow
  banner across the top of the affected tab: *"Duo started debugging
  this browser. Cancel"*. Extensions cannot suppress it. The user
  can click Cancel and force-detach. For agent workflows running
  ambient in the background, this is a constant visual reminder and
  a one-click kill switch a user might hit by accident. Tolerable
  for some workflows, painful for others.
- **One MV3 caveat:** "Service workers may terminate after the tab
  is created, breaking debugger.attach" — same SW-lifetime problem
  applies to debugger sessions. Keep-alive matters here too. Also,
  Chrome auto-detaches the debugger when the user opens DevTools on
  the same tab.

#### Hybrid: use the lighter APIs first, attach the debugger only when CDP is genuinely needed

Not every operation requires the full CDP surface. The cleanest
design is to route through `chrome.tabs` / `chrome.scripting` for
the common case (no yellow banner) and only attach the debugger
when we need a CDP-only capability:

| Operation | `chrome.debugger` (yellow banner) | Lighter API (no banner) |
|---|---|---|
| Screenshot | `Page.captureScreenshot` | `chrome.tabs.captureVisibleTab` |
| Click / fill form | `Input.dispatchMouseEvent` | `chrome.scripting.executeScript` |
| Read DOM text | `Runtime.evaluate` | `chrome.scripting.executeScript` |
| Navigate | `Page.navigate` | `chrome.tabs.update({url})` |
| Read page URL / title | `Target.getTargetInfo` | `chrome.tabs.get(tabId)` |
| AX tree | `Accessibility.getFullAXTree` | *(no equivalent — needs CDP)* |
| Network capture | `Network.*` | *(no equivalent — needs CDP)* |
| Console / errors | `Runtime.consoleAPICalled` | *(no equivalent — needs CDP)* |
| Long-lived CDP session | needed | n/a |

Implication: the agent-facing CLI verbs that map cleanly onto
lighter APIs (`duo navigate`, `duo click`, `duo type`,
`duo screenshot`, `duo url`, `duo title`) run debugger-banner-free.
Verbs that need CDP-only surfaces (`duo ax`, `duo network`,
`duo console`, `duo errors`) attach the debugger explicitly,
banner appears for the duration. Document this asymmetry in the
agent help and CLI verbs themselves so the user-facing surface
makes the trade-off legible.

---

## One coordinator per profile

Chrome MV3 gives the extension exactly **one service worker per
Chrome profile**. That singleton is the architectural pivot for the
whole shape: every UI surface (each side panel in each window, each
canvas tab) is a client of the same SW, and the SW holds the only
Native Messaging port to the only helper process.

```
              ┌──────────── service worker (singleton per profile) ──────────────┐
              │   ↑ connectNative once → one helper process                       │
              │   ↑ port routing, file watches, dirty-buffer registry             │
              └──────────────────┬─────────────────────┬─────────────────┬────────┘
                       chrome.runtime.connect (many)
                                 │                     │                 │
                  ┌──────────────┴────┐    ┌───────────┴─────┐    ┌──────┴───────┐
                  │ side panel        │    │ canvas tab #1   │    │ canvas tab #2│
                  │ (one per window)  │    │ foo.md          │    │ deck.html    │
                  └───────────────────┘    └─────────────────┘    └──────────────┘
```

What this gets us — and what it doesn't:

- **One helper, one coordinator.** No N-way fan-out at the helper.
  The helper sees a single port from the SW and dispatches PTY data,
  file I/O, and watch events through it. The SW splits messages out
  to whichever UI surface owns each PTY session / file path.
- **Multi-window is free.** Two Chrome windows → two side panels,
  same SW, same helper. File tree state stays consistent because
  it's read from the helper, not held per-window.
- **Two tabs of the same file is solved by the helper, not by the
  tabs.** Both `canvas.html?path=foo.md` documents subscribe to the
  same file-watch event and read from the same dirty-buffer record.
  No different in shape from how Electron *would* handle it if we
  ever allowed multi-window — single source of truth lives below the
  UI layer.
- **Same-origin pubsub for UI-only sync.** All extension pages
  (side panel + canvas tabs) share an origin
  (`chrome-extension://<id>/`), so a `BroadcastChannel` lets them
  push lightweight UI events (focus, theme changes, "the user is
  typing in tab N") directly to each other without round-tripping
  through the SW. Useful escape hatch for keystroke routing across
  surfaces — one of the soft blockers above gets cheaper because of
  this.
- **One profile is one instance.** A user running work + personal
  Chrome profiles gets two SWs and two helper processes — fully
  isolated. This is almost certainly what you want.

Two caveats inherited from MV3:

1. **The SW's in-memory state evaporates on idle.** Any state we'd
   want to recall on resume has to live in `chrome.storage.local`
   (persistent, async) or in the helper (the source of truth
   anyway). Don't store transient session state in SW memory and
   expect it to be there 60 seconds later.
2. **The SW is the only thing that can hold the Native Messaging
   port.** Side panel and canvas tabs cannot `connectNative`
   themselves — they can only relay through the SW. So when the SW
   dies, every UI surface's helper-bound traffic is interrupted.
   This is the structural reason
   [claude-code#16350](https://github.com/anthropics/claude-code/issues/16350)
   matters so much: the SW isn't *one of* the coordinators, it's
   *the* coordinator.

Implication for Phase 0: the keep-alive test isn't just "does the
helper survive" — it's "does the SW stay warm enough that *every*
client port the user opens (side panel + N canvas tabs) gets a live
helper without reconnect dance."

---

## What the walking skeleton tests

Five phases, each ~half-day to one day. Land each one fully before
proceeding — early phases collapse the highest-uncertainty unknowns.

### Phase 0 — Hello-world Native Messaging + idle survival

**Question:** Does the SW + Native-Messaging-host pair survive a
realistic user idle pattern (read docs for 30 minutes, come back,
type into terminal)?

**Build:** Minimal extension with one button "ping helper." Helper
echoes back. Extension also schedules a `chrome.alarms` keep-alive
at 25-second intervals (mitigation for the 30s idle timeout).

**Pass criteria:** After 30 minutes of zero user interaction, the
button still works on first click without re-establishing the port.
Track: how many times the helper process restarted during the idle
window. Goal: zero. Failure mode predicted by
[claude-code#16350](https://github.com/anthropics/claude-code/issues/16350)
is "helper dies silently after ~30s." Reproduce, then fix.

**Decision:** If keep-alive doesn't keep the helper alive across
realistic idles, the entire shape is suspect. Stop here.

### Phase 1 — Real PTY in the side panel

**Question:** Does an xterm.js terminal in a 360px side panel with
real `node-pty` over Native Messaging feel like a terminal?

**Build:** Side panel hosts xterm. Helper spawns shell, pipes
stdin/stdout through Native Messaging. Re-use
[`renderer/components/TerminalPane.tsx`](../../../renderer/components/TerminalPane.tsx)
behind a thin shim.

**Pass criteria:** `vim`, `less`, `htop` render correctly. Resize
events propagate. Backspace doesn't lag. ⌘+C / ⌘+V work.

**Watch for:** Native Messaging messages are JSON-encoded with a
4-byte length prefix and capped at 1MB per message
([docs](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)).
A full-screen `cat` of a 5MB log file generates many small frames —
fine. A single binary blob > 1MB needs chunking. Document either way.

### Phase 2 — Filetree + canvas-per-tab

**Question:** Does opening a markdown file in a new tab (instead of
a side-panel-adjacent right pane) feel coherent or disjointed?

**Build:** FileTree above terminal in side panel. Click a `.md` file
→ extension opens a new tab pointing at the canvas page. Canvas page
hosts MarkdownEditor, talks to SW over port for file r/w.

**Pass criteria:** Subjective. Edit the file in the canvas tab, see
the FileTree's "modified" badge update. Save in the canvas tab,
modify the file from the terminal (`echo foo >> file`), see the
canvas tab pick up the change.

**Watch for:** The canvas tab has no privileged access to the
filesystem. All file I/O routes SW → helper. Latency of round-trips
matters; the editor is currently designed against a synchronous
shim (Electron IPC is fast). Need to measure.

### Phase 3 — Drive a real Chrome tab via chrome.debugger

**Question:** Can an agent in the side-panel terminal drive the
user's gmail tab (or any auth'd tab) via chrome.debugger?

**Build:** Add a "drive this tab" picker. CLI verb `duo nav <url>`
calls `chrome.debugger.attach({tabId}, '1.3')`, sends
`Page.navigate`, `Page.captureScreenshot`. Returns the screenshot
to the requesting CLI invocation.

**Pass criteria:** Works against gmail.com on the user's actual
account. Returns the same kind of full-render screenshot Walk 4 of
the duo-in-browser exploration produced.

**Watch for:** Chrome auto-detaches the debugger when the user
opens DevTools on the same tab. Show a banner in the side panel.

### Phase 4 — Distribution dry-run

**Question:** Can a Trailblazer install the extension + helper
without hand-holding?

**Build:** A README with: "(1) install extension from Web Store, (2)
download `duo-helper-darwin.pkg`, (3) run installer." Helper
installer drops a Native Messaging manifest at
`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.duo.helper.json`
pointing at the helper binary, plus the binary itself.

**Pass criteria:** A friend who isn't a developer can complete the
flow. Compare to "drag Duo.dmg to Applications" — is the friction
materially higher?

**Watch for:** The Native Messaging manifest's `allowed_origins`
field has to list the extension ID, which means the manifest is
generated post-Web-Store-publication. Two-step install. The current
Electron app installer is one step; extension + helper is two.

---

## Hard blockers, soft blockers, and open questions

### Hard blockers (would kill the shape)

- **Service-worker idle / helper death** ([claude-code#16350](https://github.com/anthropics/claude-code/issues/16350))
  — if keep-alive can't reliably keep the helper alive across
  realistic user idle patterns, the architecture is unstable by
  design. Phase 0 collapses this.
- **Enterprise extension policies.** Many corporate Chrome deployments
  block or audit extensions requesting `debugger`, `nativeMessaging`,
  and `tabs` together — that combination is a credible facsimile of a
  remote-access trojan from a security-tooling perspective. Audit
  whether any meaningful Trailblazer audience can install this
  extension without a permission-policy battle.

### Soft blockers (livable but documented)

- **Side panel 360px minimum.** Terminal is cramped. Detach-to-popup
  mitigation works but adds UX surface.
- **No privileged keyboard surface across windows.** The current
  global-shortcut registry in
  [`renderer/keyboard/globalShortcuts.ts`](../../../renderer/keyboard/globalShortcuts.ts)
  fires inside one renderer process. Across multiple Chrome tabs +
  side panel, the shim has to forward keystrokes through the SW.
  Possible, but the four-pattern keyboard escape doc in
  [`CLAUDE.md`](../../../CLAUDE.md) needs a fifth pattern entry.
- **Native Messaging 1MB per-message ceiling.** Streaming chunked
  payloads is fine; one-shot large reads need chunking.
- **Two-step installer.** Web Store listing + helper PKG.

### Open questions

- **Single-user assumption.** The extension is per-Chrome-profile.
  Users with multiple profiles get N helpers. Acceptable?
- **Headless mode.** Today the Electron app launches its own window;
  agent-only "headless" use isn't supported. The extension shape
  forces the user to have Chrome open. Forcing-function or constraint?
- **Where does the
  [`docs/design/atelier/`](../../design/atelier/) visual identity
  apply?** Chrome's side-panel chrome (header, expand button) is
  immutable. Atelier owns inside-the-panel; outside is Chrome's.
- **Auto-update.** Web Store handles extension auto-update. Helper
  binary needs its own update mechanism — Sparkle? In-app prompt
  delivered via SW? Easier than Electron's full-bundle update, harder
  than no-thinking-required.

---

## Why this is *not* a successor to duo-in-browser

[`../duo-in-browser/README.md`](../duo-in-browser/README.md) was about
"can the renderer run inside a regular browser tab against a daemon."
It walked, it worked, and the recommendation was *not* to ship it
because the install dance wasn't materially easier than the Electron
app and the auth-blocking premise was narrower than expected.

This exploration is shaped differently:

| | duo-in-browser | duo-as-chrome-extension |
|---|---|---|
| Renderer | One browser tab → SPA | Side panel + N tabs (one per canvas) |
| Helper | Standalone daemon, user-launched | Native Messaging host, Chrome-launched |
| Embedded browser | Removed (D5) | Removed (drives real tabs instead) |
| Distribution | Daemon binary download | Web Store + helper PKG |
| Auth surface | Same as Electron (separate tabs in user's Chrome) | The user's actual Chrome tabs, drivable |
| Notarization | Daemon needs signing | Helper PKG needs signing; renderer doesn't |

The most interesting differentiator: **the extension's right "pane"
is the user's actual Chrome.** That gets us the auth-pinning win
that duo-in-browser couldn't deliver, *and* relegates the
embedded-browser machinery to the trash.

---

## Recommendation

**Walk Phase 0 first.** It's a half-day investment that collapses the
biggest unknown (does the SW + helper actually survive realistic
idle?). The MV3 service-worker idle bug is well-attested at
[claude-code#16350](https://github.com/anthropics/claude-code/issues/16350)
and the lifecycle docs admit the constraint is real. Either keep-alive
holds, in which case proceed to Phase 1, or it doesn't, in which case
the entire shape is structurally fragile and we close out the research
with a one-paragraph addendum here.

**Do not build any of Phases 1–4 until Phase 0 passes.** Each
subsequent phase compounds investment on top of the keep-alive bet.
If Phase 0 fails, Phases 1–4 build on sand.

**Estimated cost to a Phase-0-pass-or-fail signal:** half a day,
maybe a full day. **Estimated cost to a full walking skeleton through
Phase 4:** 4–6 days. **Compare to:** Stage 21 (DMG + notarization +
auto-update) absorbed somewhere north of two weeks across Stages
21a/c. The extension shape, if it works, retires that ongoing cost
and replaces it with a Web Store submission + a much smaller helper-
binary-update problem. The arithmetic is favorable *if and only if*
Phase 0 passes.

**Out of scope for now (don't build until the question is asked):**
keystroke-routing across windows, multi-terminal tab strip in the
side panel, theme synchronization across tabs, SSO-pinned-EDR
empirical test (same as duo-in-browser — needs managed hardware).

---

## Artifacts

- [`build-roadmap.md`](./build-roadmap.md) — **the unified plan.**
  Sequences the refactor, the MVP build, stabilization, cross-platform,
  feature parity, distribution, and the long-term strategic
  decision into one execution sequence with explicit gates. Read this
  first if you're picking up the work.
- [`README.md`](./README.md) — this document (feasibility analysis).
- [`mvp-plan.md`](./mvp-plan.md) — concrete MVP build plan with
  D-numbered decisions, phase-by-phase pass criteria, and a ~10-day
  effort estimate. Reads on top of this README.
- [`refactor-analysis.md`](./refactor-analysis.md) — what the
  codebase would look like under a committed dual-target
  (Electron app + Chrome extension), filtered for which changes
  are no-regrets even if we abandon the extension. Identifies
  ~2.5 days of refactor work that pays off either way.
- *(Phase 0+ prototypes will land here as `phase-N/` subdirectories
  if/when walked. Currently empty — no prototype yet.)*

---

## Walk methodology notes (for whoever picks this up)

- **Read [`../duo-in-browser/README.md`](../duo-in-browser/README.md)
  first.** It has load-bearing precedent for the `window.electron`
  shim approach (D1) and the CDP-over-TCP fallback (Walk 4). Don't
  re-derive what's already in there.
- **Test the SW idle pattern with a real human idle.** Don't simulate
  with `setTimeout` — the kernel's SW scheduler interacts with system
  idle hints and wall-clock time in ways `setTimeout` can't capture.
  Use the extension for half an hour while doing real work in another
  app, then come back.
- **Helper binary should reuse the existing `cli/duo` esbuild bundle
  pattern.** A second binary, same build pipeline as
  [`cli/duo`](../../../cli/duo). One source of truth for the protocol
  shape in [`shared/types.ts`](../../../shared/types.ts).
- **Do not refactor `renderer/` to be host-agnostic.** Same lesson as
  duo-in-browser: the shim approach is faster than the abstraction
  refactor. If the extension shape ships, *then* maybe abstract.
- **Stage 21d (Trailblazers) is the natural distribution gate to
  evaluate against.** If the extension shape's install friction is
  meaningfully higher than the DMG, Trailblazers is the wrong
  audience to test it on.
