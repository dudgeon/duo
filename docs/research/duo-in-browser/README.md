# Duo-in-browser exploration — research report

**Status:** Explored 2026-04-28. **Not pursuing** the endpoint-hosted variant. Possible future investigation in a different shape (see § Future avenue).

**Source PR:** [duo#31](https://github.com/dudgeon/duo/pull/31) — open, not merged. Design doc on that branch at `docs/prd/stage-web-distro.md`.

---

## TL;DR

We built and walked a working prototype of "Duo running as a local
web app served inside the user's regular browser" (PR #31) to test
whether that distribution shape solves problems the Electron
desktop app can't. The walking skeleton walks — terminal + editor
+ canvas + file tree all run in Chrome via a `window.electron`
shim that lets the existing `renderer/` components host without
modification. **The technical viability is real.**

But four counter-tests during the same walk reframed the value
proposition:

1. **Gmail (and similar SaaS) loads + auths fine inside the Electron
   app's existing browser pane** on a personal Mac. The premise
   "Google's bot detection blocks embedded browsers" is false at
   the level the design assumed.
2. **Embedding a SaaS site as an iframe in the web variant's right
   pane is structurally impossible** — every modern SaaS sets
   `X-Frame-Options: SAMEORIGIN` + `frame-ancestors 'self'`. Chrome
   refuses the embed at the network layer. So the web variant has
   no path to "drop the embedded browser BUT keep some flavour of
   in-app SaaS view."
3. **The endpoint-hosted variant is not meaningfully easier to
   install than the existing app.** Both require the user to
   download something to their machine and run it. The "user
   experience win" was the central justification, and it doesn't
   hold up to inspection.
4. **A different higher-leverage path emerged from the same walk:**
   an agent inside any Duo PTY can drive the user's *real* Chrome
   via Chrome DevTools Protocol over pure TCP, through the macOS
   Seatbelt sandbox. This works for both the existing Electron app
   and any future web variant. ~2 days of work to fork the
   `chrome-cdp-skill` and replace its Unix-socket transport with
   TCP+token (the same Stage 20 pattern Duo already proved out).

We're not pursuing the endpoint-hosted Duo-in-browser variant. The
PR can stay open as exploration history or be closed; either way,
this report and the artifacts in `./artifacts/` capture what we
learned.

---

## Why we explored this in the first place

In enterprise environments where SSO + endpoint security policy
gate authentication into browser-based SaaS apps (mail, docs,
issue trackers, intranet) to a specific approved browser binary,
the Electron build is a different binary than the user's approved
browser. The hypothesis: if Duo's UI ran *inside* the user's
already-approved browser, the auth problem evaporates. The user
opens a tab to `http://localhost:<duo-port>` and gets the agent +
editor + canvas in one tab; their other tabs still hold their
authenticated SaaS sessions, untouched.

That's a real-sounding bet for a specific enterprise context, and
worth a walking-skeleton test rather than just reasoning about it.

---

## What we built (PR #31)

A second distribution target living under `web/` alongside the
existing `electron/` and `renderer/` trees — not a replacement.

```
                 Browser tab (Chrome)                       Local daemon (Node)
   ┌─────────────────────────────────────────┐     ┌────────────────────────────────────┐
   │  WebApp.tsx                             │     │  HTTP /          → static bundle   │
   │  ├── TerminalPane (xterm)               │     │  WS   /ws/renderer ◄──────────────┐│
   │  ├── FileTree                           │     │  TCP  127.0.0.1:<port> + token   │ │
   │  └── WorkingPane                        │     │       (existing duo CLI)         │ │
   │      ├── MarkdownEditor (TipTap)        │     │                                  │ │
   │      └── CanvasTab (iframe)             │     │  CommandBus                      │ │
   │                                         │     │   ├── PtyDriver (node-pty)       │ │
   │  window.electron shim ◄─────────────────┴──ws─┤   ├── FilesService (chokidar)    │ │
   │  (request/response + event bus)         │     │   ├── State cache (theme, etc.) │ │
   └─────────────────────────────────────────┘     │   └── RendererBridge (WS push)  │ │
                                                   │                                  │ │
                                  duo CLI ◄────────┘  (NDJSON DuoRequest/Response) ◄─┘ │
```

**Key D-numbered decisions** (full list in the PR's design doc):

- **D1** Compatibility shim, not abstraction refactor — `window.electron` shim in the web client forwards each method to the daemon over WebSocket. `renderer/` code reuses verbatim.
- **D2** Reuse the existing CLI protocol verbatim — daemon publishes the same TCP+token NDJSON surface the Electron app does. Unmodified `cli/duo` works against the web daemon when pointed at `~/.duo/web.port`.
- **D3** One renderer connection at a time. State (PTY sessions, theme) lives in the daemon; reload reattaches.
- **D4** Loopback only, with a per-launch token. WS handshake validates `Origin` against daemon's own origin (note: this validation was not actually enforced in the prototype — see § Findings).
- **D5** Drop the WebContentsView surface entirely. `WorkingTabType` narrows to `editor | html-canvas | image | pdf | unknown`. `browser` is removed at the type level. Verbs that need it (`navigate / click / type / screenshot / url / title / dom / text / ax / console / errors / network / tabs / tab / close / wait / eval`) return a structured `web mode: <verb> requires the embedded browser` error.

**Scope:** ~3000 lines added across `web/daemon/`, `web/client/`, `web/shared/protocol.ts`, plus a design doc at `docs/prd/stage-web-distro.md` and an Island-browser-compat note at `web/notes/island-compat.md`.

---

## What we tested

Four walks, two days of work for the original PR + half a session
for the validation walks here. All of the below ran on a personal
macOS laptop in real Chrome.

### Walk 1 — Walking-skeleton viability

**Question:** Does the prototype actually work end-to-end on
macOS / Chrome (the original PR was built and validated on Linux)?

**Result:** ✅ Walks.

- `npm install` + `npm rebuild node-pty` clean for system Node 18.17.0.
- All 4 tsconfigs (`tsconfig.node.json` + `tsconfig.web.json` + `web/daemon/tsconfig.json` + `web/client/tsconfig.json`) typecheck clean.
- `vite build` produces a 1.2MB / 380KB-gzip single-chunk bundle in 2.7s.
- Daemon boots in ~280ms. Writes `~/.duo/web.port` with `{port, token, runtime:"web", httpPort}`.
- HTTP serving works, including a thoughtful CSP that accommodates the iframe-based HTML canvas.
- WebSocket protocol: auth → `auth-ok` with `{HOME, SHELL}` env, `files:list` returned 37 entries from a directory in <50ms, `pty:create` returns `{ok:true}`.
- CLI against daemon's TCP bridge works for non-browser verbs: `duo doctor` reports `Duo app version: 0.5.0-web.0` + falls back to TCP (Unix-socket attempt fails as expected — not present in web mode), `duo theme`, `duo nav state`, `duo selection-format`, `duo ls`.
- D5 disabled-verb error path works: `duo navigate https://example.com` → `web mode: 'navigate' requires the embedded browser (not available in duo-web v1)`. Same for every browser-dependent verb.
- SPA renders in Chrome. Real PTY round-trip works: typed `echo "hello from in-browser duo"` in the in-browser terminal pane, got the shell output rendered correctly in xterm.
- **The killer signal:** `duo edit ~/path.md` from the in-browser PTY mounts the *shared* MarkdownEditor component in the right pane via the `window.electron` shim. Full toolbar (Paragraph dropdown, B/I/U/S, code, link, lists, table), Save/Saved buttons, placeholder, ENOENT banner. **Renderer components reuse verbatim from the Electron build** — D1's shim approach pays off completely.

**Issues observed (none blocking the viability call):**

- `/api/bootstrap` returns the auth token without strict Origin validation. D4 claims this is gated; in the prototype it isn't. Important if any non-loopback variant is built later.
- CLI version mismatch warning (`CLI 0.1.0` vs `app 0.5.0-web.0`) — cosmetic; CLI works fine.
- Single `+` button on terminal strip — no claude/shell split. D7 defers PATH-shim install in the web variant; reasonable for v1.
- ENOENT banner shows on the editor for non-existent files until first save — confusing UX (same exists in the Electron build, not specific to web).
- 1.2MB single chunk — wants code-splitting before any distribution effort.

### Walk 2 — Counter-test: does Gmail actually fail in the Electron app's BrowserPane?

**Question:** The Stage W premise rests on "the Electron build can't hold SaaS sessions." Is that actually true, or are we solving a problem that doesn't exist?

**Method:** Started Duo Electron via `npm run dev`, navigated the existing right-pane BrowserPane to `https://mail.google.com`.

**Result:** ❌ The premise is mostly false. Gmail loaded fully signed-in. Tab title `Inbox (124) - <user>...`. URL `https://mail.google.com/mail/u/0/#inbox`. Full Gmail UI rendered: Compose button, nav (Inbox / Starred / Snoozed / Important / Sent / Drafts / Spam / Purchases / Social / Updates / Promotions), labels, real email subjects + senders. No "this browser is not supported" warning. No 2FA challenge. Session cookies persisted across launches in Duo's user-data-dir (`~/Library/Application Support/duo/Cookies`).

**What this means for the Stage W rationale:**

The original framing conflated two different gates:

1. **Google's own bot / embedded-browser detection.** Demonstrably absent for Gmail. Stage W is NOT solving this problem.
2. **Enterprise EDR policy that pins auth to specific approved browser binaries by process identity / certificate / app bundle ID.** Duo's Electron is a distinct binary from the user's Chrome, so EDR refuses to forward auth tokens / SSO assertions even though the embedded Chromium is technically capable.

Stage W only helps with (2), not (1). And even (2) needs empirical validation — it's plausible that strict-EDR-class environments also gate connections from arbitrary browsers to localhost daemon URLs, in which case Stage W might not solve the problem at all. Untested in this walk; would require validation on a specific managed-environment laptop.

### Walk 3 — Counter-counter: can the web variant keep an embedded SaaS sub-pane via iframe?

**Question:** D5 drops the WebContentsView surface entirely. Could we keep some flavour of "embed a SaaS site as an iframe" in the web variant's right pane?

**Method:** Two layers — network-layer header probe, then live empirical test.

**Network layer:**

```
$ curl -sI https://mail.google.com/
x-frame-options: SAMEORIGIN
content-security-policy: frame-ancestors 'self'

$ curl -sIL https://mail.google.com/mail/   # follows redirect to accounts.google.com
x-frame-options: DENY                       # auth flow even more locked down
```

`docs.google.com`, Microsoft 365, Slack, Atlassian — all return the same `SAMEORIGIN` family. These were architected years ago specifically to prevent clickjacking + credential phishing via embed.

**Empirical:**

Injected a Gmail iframe into the running Stage W SPA in Chrome. Result: Chrome's broken-document refusal glyph rendered in the right pane. The iframe element existed and the URL was set, but the same-origin policy denied any access to its contents. No console error in the SPA's own log because the refusal happens at Chrome's network layer, not in user JS. (DevTools shows the standard `Refused to display 'mail.google.com' in a frame because it set 'X-Frame-Options' to 'sameorigin'`.)

**Result:** ❌ Structurally impossible.

The web variant has no path to "embedded SaaS view in the right pane." The only ways back to that capability are:

- A companion browser extension running in the user's browser's privileged context (the Phase 2 candidate the original design contemplated). Adds substantial complexity, install friction, and an extension distribution / signing problem.
- Re-introducing a WebContentsView-equivalent surface (which web platforms don't expose).

### Walk 4 — CDP through the sandbox to drive the user's real Chrome

**Question:** Forget embedding. Can an agent inside any Duo PTY (Electron OR web variant) drive the user's *real* Chrome via Chrome DevTools Protocol, where all the user's authenticated SaaS sessions actually live?

The relevant constraint: Claude Code's tool calls run inside a macOS Seatbelt sandbox that blocks Unix-domain-socket outbound connections by default. (This is the same constraint Duo's Stage 20 ADR addresses for the `duo` CLI — Duo solves it by falling back to TCP+token over loopback.) The chrome-cdp-skill at https://github.com/dudgeon/chrome-cdp-skill uses Unix sockets between its CLI and per-tab daemons today, so its page-level commands hang in the sandbox. The question is whether the underlying CDP transport itself works.

**Method:** Spawned a fresh Chrome instance with explicit CDP enabled (separate user-data-dir so it didn't disturb the main Chrome):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9333 \
  --remote-allow-origins='*' \
  --user-data-dir=/tmp/duo-cdp-chrome-data \
  --no-first-run --no-default-browser-check \
  about:blank &
```

Then ran `cdp-tcp-sandbox-test.mjs` (preserved in `./artifacts/`) from inside the Seatbelt sandbox — pure TCP, no Unix sockets in the path:

1. `GET http://127.0.0.1:9333/json/version` → returned Chrome 147 + protocol version.
2. `PUT http://127.0.0.1:9333/json/new?https://mail.google.com` → opened a new tab. Returned the new tab's `webSocketDebuggerUrl`.
3. WebSocket connected to that tab's debugger URL.
4. `Page.enable` → ack'd over the WS.
5. Slept 6s for navigation to settle (Google redirect to sign-in).
6. `Page.captureScreenshot` → 98KB base64 PNG. Saved to `./artifacts/gmail-cdp-via-sandbox.png` — full Google sign-in page rendered, every pixel through pure TCP.
7. `Accessibility.getFullAXTree` → 140 nodes. Named-node sample showed `RootWebArea: "Gmail"`, `heading: "Sign in"`, link refs to Help / Privacy / Terms — page-level semantic content fully readable through the sandbox.
8. `Target.getTargetInfo` → confirmed final URL was `accounts.google.com/v3/signin/identifier?...&service=mail`.

**Result:** ✅ **CDP-over-TCP through the Seatbelt sandbox works for every page-level operation that matters.**

This validates a fundamentally different leverage path:

- An agent inside any Duo PTY (Electron OR web variant) can drive the user's real Chrome.
- All page-level operations (screenshot, AX tree, JS eval, DOM read, click, type, navigate) work through pure TCP.
- The user's Chrome holds all their authentication state. Every SaaS the user already has tabs open for is now agent-addressable.

### What's missing in the chrome-cdp-skill itself

The skill at `~/.claude/skills/chrome-cdp/scripts/cdp.mjs` holds CDP sessions warm via a per-tab Unix socket daemon at `/tmp/cdp-<targetId>.sock`. Browser-level commands (`list`, `windows`, `audit`) bypass the daemon and connect directly to Chrome via WebSocket — those work fine through the sandbox. **Page-level commands** (`snap`, `eval`, `click`, `shot`, `nav`, `type`, etc.) flow `CLI → Unix socket → daemon → WS to Chrome`, and the sandbox blocks the `CLI → Unix socket` hop, so those commands hang.

**Fix:** Replace the per-tab daemon's listening transport from `net.createServer({path: sockPath})` to `net.createServer().listen(0, '127.0.0.1')`. Bind to a loopback TCP port, write `<port, token>` to `/tmp/cdp-<targetId>.port`. CLI discovery becomes "read the port file, connect to localhost TCP, validate token." Net change ~40 lines in `cdp.mjs`. Direct port of Duo's Stage 20 sandbox-tolerant transport pattern — well-trodden territory.

---

## Why we are not pursuing now

Three arguments compound into the decision:

### 1. Endpoint-hosted Duo-in-browser is not meaningfully easier to install than the Electron app

The original framing positioned Stage W's ergonomics as a meaningful win — "users open a tab and get Duo, no install dance." But the prototype actually requires the user to:

- Download a daemon binary / npm package
- Run `npm install` + `npm rebuild node-pty` once (or unpack a packaged daemon)
- Launch the daemon (`npm run web:daemon` or equivalent)
- Open the printed URL in their browser

That's not less than installing the macOS app:

- Download `Duo-X.Y.Z.dmg`
- Drag to /Applications
- Launch

If anything, the daemon's persistent-process model is *worse* than launching a regular app — the user has to remember whether the daemon is running, restart it after reboots, etc. The Electron app is a single launchable surface; the daemon is a service the user has to think about.

The "user experience" win was the central argument for the variant. It doesn't hold.

### 2. The auth-blocked premise is narrower than initially framed

Walk 2 showed that Google's bot detection doesn't block embedded Electron-Chromium auth to Gmail. The "Stage W replaces an Electron app that can't auth" framing is wrong for the most-cited SaaS targets on a personal / unmanaged Mac.

For specifically-managed-environment users where EDR policy pins auth to the user's approved browser binary, the variant might still help — but that requires the managed-browser to allow connections to localhost daemon URLs, which is an open question and not testable on personal hardware. The audience for whom Stage W's pure-localhost shape definitely solves a problem they can't otherwise solve is narrower than the original PR implied.

### 3. The CDP-through-sandbox path is more leveraged

Walk 4 showed that an agent inside any Duo PTY can drive the user's real Chrome via TCP CDP, capturing the user's full authenticated session surface. That capability:

- Works for the existing Electron app today (no Stage W needed).
- Would also work in any future Stage W variant.
- Solves the auth-pinned-to-browser-binary problem cleanly, because the user's *real* Chrome IS the binary holding all their cookies.
- Costs ~2 days to implement (fork chrome-cdp-skill, swap Unix socket transport for TCP+token).

If we have ~2 days of CDP-skill work that pays off across both distribution targets, vs. weeks of Stage W productisation effort that pays off only in a specific narrow case — the priority is clear.

---

## Future avenue worth keeping open

A different deployment shape than the endpoint-hosted prototype we
just built: a **single Duo daemon hosted on a corporate intranet**,
accessible to many users via their normal browser at an internal
URL.

This is structurally distinct from "the user installs and runs a
daemon locally." It would:

- Have one operations team instead of N user installs to keep current.
- Run on a server with its own user-data-dir, file-system access pattern, and authentication boundary (likely tied to the corporate SSO identity rather than a per-launch token).
- Need a different threat model — the daemon would be multi-user, with per-session isolation, audit logging, secret handling, and a much more conservative file-system surface than a personal-machine variant.
- Reuse much of the walking-skeleton architecture already built (renderer components via shim, daemon's command bus, CLI bridge, WS protocol). The work would primarily be on auth, multi-tenancy, isolation, and operations.
- Have its own ergonomics question — does it actually feel native to the user, or is it an inferior remote-desktop experience? Open question worth its own walking-skeleton.

Worth a separate exploration if intranet-hosted SaaS-style Duo
becomes a thing the team wants to build. **Not** a continuation of
the endpoint-hosted variant — different deployment model, different
threat model, different audience.

---

## Recommended next step (out of scope for this exploration)

**Fork the `chrome-cdp-skill`, replace its per-tab Unix-socket
daemon transport with TCP+token, ship as a built-in Duo capability.**

Specifics:

- ~40 lines of code change in `cdp.mjs` to bind the daemon's listener to `127.0.0.1:0` instead of `path: sockPath`. Write `<port, token>` to `/tmp/cdp-<targetId>.port`. CLI discovery reads the port file and connects via TCP.
- Optionally add a `cdp.token` field per daemon to defense-in-depth against any local process binding to the same TCP port mid-handshake.
- Bundle the resulting CLI as a Duo built-in (or document it as a recommended companion skill that ships pre-installed on Duo install).
- Add `duo browser-driver` (or similar) verb to the Duo CLI that's a thin shim over the cdp tool — so agents discover the capability through Duo's own help surface rather than needing to know about a separate skill.

Roughly two days of work. Pays off across:

- The Electron app today (agent in a PTY can drive the user's real Chrome instead of just the embedded BrowserPane).
- Any future hosted-on-intranet Duo variant.
- General Claude Code workflows outside Duo (the skill becomes more sandbox-resilient).

Not on the immediate v0.5.2 roadmap (focused on bug-smashing); worth a stage card when we come back to capability expansion.

---

## Artifacts

- [`README.md`](./README.md) — this report.
- [`artifacts/cdp-tcp-sandbox-test.mjs`](./artifacts/cdp-tcp-sandbox-test.mjs) — raw CDP script proving sandbox → Chrome via pure TCP works. Self-contained Node 22+ script with usage instructions in its header comment.
- [`artifacts/gmail-cdp-via-sandbox.png`](./artifacts/gmail-cdp-via-sandbox.png) — `Page.captureScreenshot` output from inside the sandbox: Google's sign-in page, fully rendered, ~98KB. The empirical proof of Walk 4.
- **PR [duo#31](https://github.com/dudgeon/duo/pull/31)** — the full prototype + design doc. Decide whether to leave open as exploration history or close. The branch name is `claude/duo-local-webapp-6AsuA`.

---

## Walk methodology notes (for whoever picks this up later)

- The walking skeleton was built with a `window.electron` shim approach (D1) that lets `renderer/` components host without modification. This pattern is the load-bearing technical bet — if you ever do this again, lead with this approach. The alternative (refactoring `renderer/` to a host-agnostic API) is a multi-week pure-overhead refactor with no payoff during the R&D phase.
- The CLI's TCP+token bridge (D2) reuses the daemon's Stage 20 sandbox-tolerant transport directly. Don't reinvent.
- The web variant deliberately drops `App.tsx` (1195 lines, deeply tied to BrowserPane / banners / cross-pane shortcut routing unique to the desktop window). `WebApp.tsx` is a slim re-implementation. This is the cost of the shim approach — every navigator polish or layout decision in `App.tsx` has to be ported manually. Worth knowing before any production push.
- Test environment for these walks: a fresh worktree at `/tmp/duo-web-rd/` (since cleaned up). The branch is `claude/duo-local-webapp-6AsuA` if you want to revisit. macOS, system Node 18.17.0 for the daemon (with `npm rebuild node-pty` after `npm install` because the postinstall script rebuilds for Electron's ABI). Node 22+ required if you re-run the CDP test (built-in `WebSocket`).
