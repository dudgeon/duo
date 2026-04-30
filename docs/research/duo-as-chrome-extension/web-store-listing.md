# Web Store listing — Duo for Chrome

> **Status:** Draft, 2026-04-30. Pre-baked content for the Chrome
> Web Store submission that lands in Phase 7. Reviewed before
> upload; iterate based on Web Store reviewer feedback.

## Listing metadata

| Field | Value |
|---|---|
| Extension name | `Duo for Chrome` |
| Short summary (132 chars max) | `Pair Claude Code terminals with your Chrome — let your AI agent drive tabs, edit markdown, and live in your real browser.` |
| Category | Developer Tools |
| Language | English (United States) |
| Pricing | Free |
| Visibility (initial) | Unlisted (Trailblazers cohort) |
| Visibility (eventual) | Public — gated on cohort dogfood signal per `distribution-strategy.md` Phase 8 |
| Website | https://github.com/dudgeon/duo |
| Support email | dudgeon@gmail.com (or a project-specific alias) |

## Description (16,000 chars max)

```markdown
**Duo for Chrome** is the browser-side companion to Duo Desktop,
an AI-paired coding workspace. The extension turns Chrome's side
panel into a Duo terminal session and gives the agent in your
terminal the ability to drive your Chrome tabs — read what's on
screen, navigate, click, fill forms, and run scripts in any page.

## What's it for?

You're working with Claude Code on a coding task that touches the
web — debugging an API call against a live page, scaffolding code
based on a documentation site, filling forms in a staging
environment, or asking the agent to look something up while you
write. Without Duo, you context-switch: tell Claude what you saw,
copy-paste between windows, lose your place. With Duo for Chrome,
the agent is *already in your browser*, alongside the terminal
session. Same Chrome you use every day — same cookies, same
sign-ins, same extensions, same history.

## What it does

- **Terminal in the side panel.** A real PTY (zsh / bash / fish)
  running locally on your machine, displayed in Chrome's side
  panel. Open it from any tab; xterm-class fidelity (256 colors,
  proper scrollback, copy/paste).
- **Filetree + canvas-tab editor.** Browse and edit markdown files
  from your home directory. Editor opens in a Chrome tab; full
  TipTap-based markdown surface (headings, lists, code, tables).
- **Agent drives Chrome.** The CLI in your terminal exposes verbs
  like `duo chrome:nav`, `duo chrome:title`, `duo chrome:script`
  — so when you tell Claude "open the docs page and grab the rate
  limit value," it just does that, in your real browser.

## Requirements

- **Duo Desktop** — the extension is the Chrome-side companion to
  Duo Desktop, the macOS app. Install Duo Desktop first from
  https://github.com/dudgeon/duo/releases. The extension auto-
  launches Duo Desktop when needed; close it any time and the
  side panel reconnects on next use.
- **macOS only (today).** The extension itself works in any
  Chromium-based browser, but Duo Desktop is currently macOS-only.
  Linux / Windows support is on the roadmap.
- **Chrome 120+** for the side panel API and Manifest V3 features
  this extension uses.

## Permissions — why we ask for each

- **`<all_urls>`** — required so the agent can read and script
  pages on any site you visit. The data **stays on your machine**;
  it's read by `chrome.scripting` and forwarded only to Duo
  Desktop running locally on your computer. Nothing is sent to
  any remote server.
- **`tabs`** — list, open, close, focus tabs.
- **`scripting`** — run small functions in the page (read DOM,
  click elements, fill forms). The lighter alternative to
  `chrome.debugger` for routine ops.
- **`debugger`** — used only for ops `chrome.scripting` can't
  perform (full Runtime.evaluate, network interception, etc.).
  When this is active, Chrome shows a yellow "Duo started
  debugging this tab" bar — that's a Chrome-imposed security
  surface, not something we can hide. Auto-detaches when the op
  completes.
- **`nativeMessaging`** — talk to Duo Desktop on your computer.
- **`alarms`** — keep the service worker alive at a 25-second
  cadence (defeats Chrome's idle-timeout, which would otherwise
  kill the helper connection — empirically validated against
  the failure mode documented in
  https://github.com/anthropics/claude-code/issues/16350).
- **`sidePanel`** — host the terminal + filetree UI.

## Privacy

We don't collect anything. The extension talks only to Duo Desktop
running locally on your computer (via Chrome's Native Messaging
protocol — `chrome.runtime.connectNative`). No data leaves your
machine. We have no servers. We don't have analytics. We can't see
what you do, and neither can anyone else.

For complete details:
https://github.com/dudgeon/duo/blob/main/docs/PRIVACY.md

## Open source

GPL-3.0 licensed. Source at https://github.com/dudgeon/duo. Issues
and pull requests welcome.
```

## Single-purpose statement (Web Store rule — one core use case)

> Duo for Chrome's single purpose is to let an AI coding agent
> running in a local terminal session pair with the user's Chrome
> browser — reading page state, driving navigation, and editing
> local markdown files in a Chrome tab. The terminal, file editor,
> and tab-driving capabilities all serve this one workflow: AI-
> paired coding that doesn't require the user to leave their
> browser.

## Permission justifications (verbatim, for Web Store submission form)

Each gets a single short paragraph:

### `<all_urls>`

```
The agent in the user's terminal session needs to read and script
pages on any site the user is browsing. The data stays on the
user's machine — pages are read via chrome.scripting and forwarded
only to the local Duo Desktop application via Native Messaging.
There is no remote endpoint and no telemetry. Without <all_urls>,
the agent cannot operate on the user's daily browsing context,
defeating the extension's purpose.
```

### `tabs`

```
The extension lets the agent list open tabs, open new tabs, close
tabs, and focus tabs from the side-panel-adjacent terminal. This
is the lightest-weight Chrome API surface for those ops; the
heavier chrome.debugger API is reserved for tasks where
chrome.tabs and chrome.scripting are insufficient.
```

### `scripting`

```
The agent runs small functions in the active page — to click an
element, read text, fill a form field, or extract structured data.
Each invocation is one short function executed in the page context;
no long-running scripts are injected. The user can see exactly
what the agent does because the side-panel terminal logs every
verb invocation.
```

### `debugger`

```
Used only for operations chrome.scripting cannot perform: complete
Runtime.evaluate (for cases requiring expression evaluation
returning by value), Network domain interception, and similar
operations that strictly need CDP. When debugger is active, Chrome
shows the user a "Duo started debugging this tab" yellow bar
(Chrome-imposed and visible, not something we can suppress). The
extension always detaches the debugger when each operation
completes; the bar disappears.
```

### `nativeMessaging`

```
Used to talk to Duo Desktop, a macOS application that runs locally
on the user's machine. The extension does not connect to any
remote server. All terminal sessions, file I/O, and agent verb
dispatch happen via this Native Messaging channel between Chrome
and the local Duo Desktop process.
```

### `alarms`

```
Sets a 25-second-period alarm to keep the Manifest V3 service
worker alive between user interactions. Without this, Chrome's
idle timeout (~30s) would kill the service worker and disconnect
the Native Messaging port to Duo Desktop. The user would see the
extension fail mid-task with no signal of why. This pattern is
documented as a known MV3 issue at
https://github.com/anthropics/claude-code/issues/16350.
```

### `sidePanel`

```
The extension's primary surface is the Chrome side panel — it
hosts the terminal, file navigator, and agent test buttons.
Without this permission the extension would have no UI surface.
```

## Icons

| Size | Source | Status |
|---|---|---|
| 16×16 | Generated from `build/icon.icns` via `sips -z 16 16` | ✅ `phase0/extension/icons/icon-16.png` |
| 32×32 | Same | ✅ `phase0/extension/icons/icon-32.png` |
| 48×48 | Same | ✅ `phase0/extension/icons/icon-48.png` |
| 128×128 | Web Store listing icon. Required. | ✅ `phase0/extension/icons/icon-128.png` |

Wired into `manifest.json`'s `icons` and `action.default_icon`
fields so Chrome surfaces them in the toolbar, extension picker,
and Web Store listing without further wiring. Re-extract from the
desktop icns if the desktop icon ever changes:

```bash
for s in 16 32 48 128; do
  sips -s format png -z $s $s build/icon.icns \
       --out phase0/extension/icons/icon-$s.png
done
```

## Screenshots

Web Store requires at least one, recommends 3-5. Each must be 1280×800
or 640×400 PNG/JPG.

Plan for Phase 7:

1. **Side panel hero shot** — Chrome window with the side panel
   open, terminal showing `claude` running, ⌘B drawer open with a
   filetree visible. Caption: "A real terminal in your side panel.
   Real PTY, real shell, real Claude Code."
2. **Canvas tab editor** — A second Chrome tab opened to a markdown
   file via the side panel filetree. Caption: "Edit markdown files
   from your home directory in a Chrome tab. Real TipTap editor."
3. **Agent driving Chrome** — Side panel terminal showing
   `duo chrome:nav github.com` followed by Chrome navigating; the
   active tab in the screenshot reflects the navigation.
   Caption: "Tell Claude what to do. The CLI drives your real
   Chrome."
4. **Auto-launch Duo Desktop** — Side panel showing "Connected to
   Duo Desktop v0.7.0" status. Caption: "Pairs with the Duo Desktop
   macOS app. Auto-launches when you need it."

Capture flow:
- Run extension in real Chrome on macOS.
- Use Cmd-Shift-4 (with space) to capture window with shadow.
- Crop to 1280×800 in Preview.app.

## Submission checklist

- [ ] Web Store developer account ($5, one-time) — Geoff's personal
      Google account vs. dedicated `duo@…` account decision
- [ ] Privacy policy hosted at a stable URL (this doc + a short
      summary at https://github.com/dudgeon/duo/blob/main/docs/PRIVACY.md)
- [ ] Icons generated (4 sizes)
- [ ] Screenshots captured (3-5)
- [ ] Listing copy reviewed (description above)
- [ ] Permission justifications copy-pasted into the Web Store form
- [ ] Single-purpose statement copy-pasted
- [ ] Build the production CRX:
      `npm run build:ext-canvas:prod`
      `cd phase0/extension && zip -r ../../duo-extension-vX.X.X.zip .`
- [ ] Upload the CRX to the Web Store dashboard
- [ ] Set visibility to **Unlisted** (not Public)
- [ ] Save the install URL — share with the Trailblazers cohort
- [ ] Wait for review (3-5 business days typical for unlisted)
- [ ] Once approved, run Phase 8 cohort dogfood for ≥30 days
- [ ] Promote to Public per the strategy doc's gate criteria

## Privacy policy stub

This will live at `docs/PRIVACY.md` on the main repo (cherry-pick to
main as part of Phase 7). Pre-baked content:

```markdown
# Duo for Chrome — Privacy Policy

Last updated: 2026-04-30 (draft; effective on first Web Store
publication).

## TL;DR

Duo for Chrome does not collect any data. It talks only to Duo
Desktop running locally on your computer. No data leaves your
machine.

## What we do not do

- We do not run any servers.
- We do not collect any user data.
- We do not have analytics.
- We do not transmit page content, form data, or any other browser
  state to any remote endpoint.
- We do not embed third-party trackers, advertising networks, or
  fingerprinting code.

## What the extension does locally

The extension connects to Duo Desktop, a macOS application running
on your own computer, via Chrome's Native Messaging protocol. All
terminal output, file I/O, and agent commands flow over this local
connection. No part of this connection traverses the internet.

When the agent uses `chrome.scripting` or `chrome.debugger` to
read a page, the page content is read from Chrome and forwarded
to Duo Desktop. Both endpoints are on your machine.

## What Chrome sees

Chrome's Web Store policy requires us to declare what user data
we access. Chrome treats the following as "user data" even though
nothing leaves your computer:

- **Page content** of tabs you visit — read by `chrome.scripting`
  when an agent verb requires it.
- **Tab list, URLs, titles** — read by `chrome.tabs`.
- **Cookies, local storage, etc.** — never directly accessed by
  this extension.

If you stop using the extension or uninstall it, no data persists
anywhere — there's nowhere for data to persist *to*.

## Source code

The extension is open-source: https://github.com/dudgeon/duo. You
can audit exactly what it does.

## Contact

Questions: dudgeon@gmail.com
Issues: https://github.com/dudgeon/duo/issues
```

## Risk: review rejection

Web Store review can reject for:

1. **`<all_urls>` overreach.** Mitigation: emphasize the local-only
   data flow in the permission justification (above). If still
   rejected, fall back to declaring specific origins (slack,
   github, gmail, etc.) — but lose generality.
2. **Single-purpose ambiguity.** Reviewers sometimes flag
   "terminal + editor + agent" as multi-purpose. Mitigation: the
   single-purpose statement above frames everything as "AI-paired
   coding that doesn't require leaving the browser" — one purpose,
   multiple capabilities.
3. **Naming collision.** "Duo" might be flagged as confusable with
   Cisco Duo. Mitigation: "Duo for Chrome" disambiguates in
   listing search; in-extension UI just says "Duo".
4. **Native Messaging warning.** Web Store sometimes flags NM
   extensions for additional review. Mitigation: clear privacy
   policy + open-source code helps.

If rejection happens, iterate the listing copy and resubmit. Most
rejections take 1-2 rounds to resolve.
