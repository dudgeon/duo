# Island browser compatibility

> Notes for the eventual port of Duo Web to run inside Island, the
> Chromium-based "enterprise browser" (https://www.island.io). This
> doc lives next to the v1 Chromium implementation; nothing here is
> production-validated, since this R&D branch can only test against
> stock Chromium.

## What Island actually is

Island ships a forked Chromium build with policy-enforced behaviour
managed by IT: clipboard rules, screen-capture rules, extension
allowlists, downloads policy, network egress rules, "last-mile" paste
filters, etc. From the user's perspective it's a normal browser
(tabs, dev tools, fetch, WebSocket all work) — the controls live in
admin policy, not in the page-facing API surface.

For Duo Web v1 (terminal + editor + canvas in one tab, no embedded
sub-browser, all backed by a localhost daemon), the relevant
question is: **does Island let our page reach the localhost daemon
and run xterm/TipTap/iframe DOM ops normally?** The answer is *almost
certainly yes by default*, but with a handful of admin-policy knobs
that could break us.

## Compatibility matrix (v1 features)

| Surface | Risk | Notes |
|---|---|---|
| `fetch('/api/bootstrap')` | Low | Same-origin GET. No special CSP rules likely. |
| `WebSocket('ws://127.0.0.1:N/ws/renderer')` | **Medium** | Some enterprise Chromium policies block WS to non-corporate hosts; loopback is usually exempted but worth confirming. Test: open devtools, watch for `ERR_BLOCKED_BY_CLIENT` or policy-blocked errors on the upgrade. |
| xterm.js (canvas/dom rendering) | Low | Pure DOM. No WebGL, no `getDisplayMedia`. Should be unaffected by Island controls. |
| TipTap (contentEditable) | Low | contentEditable is a primitive — Island's clipboard rules will affect copy/paste, but the editor still functions. |
| Iframe canvas (`srcdoc`/`blob:`) | **Medium** | Island's content-policy filters can apply to iframes the same way Chrome's do. The canvas iframe is same-origin (served by the daemon as `data:` or `srcdoc`); shouldn't cross any boundary, but data-URL frames have triggered policy false-positives in other enterprise browsers. |
| `localStorage` (theme, font-bump, selection-format prefs) | Low | First-party storage on a localhost origin. Some policy modes wipe storage on session end — degrades persistence but doesn't break v1. |
| `window.open` for `duo external` | **Medium-High** | Island can rewrite or block `window.open` to specific domains. Since `duo external` calls `xdg-open` from the daemon (which goes to the system default browser, *not* Island), this might *help* — the user lands in Island anyway because that's the user's default. But policy can also force the daemon-spawned `xdg-open` to be intercepted. Worth a real test. |
| Drag-and-drop into the canvas | Low | DOM `dragstart`/`drop` events. Island's data-loss-prevention may flag inbound files; doesn't break the technical surface. |

## Things to test on a real Island seat

When we get an Island install:

1. **Can the page reach the daemon at all?**
   - `curl http://127.0.0.1:8765/api/bootstrap` from a normal terminal
     — does Island's network policy intercept loopback?
   - Open `http://127.0.0.1:8765/` — does it load? Does the WS upgrade
     succeed (devtools → Network → WS frame)?

2. **Does the page CSP we ship survive Island's CSP-augmenting policy?**
   - Our `index.html` sets a `<meta http-equiv="CSP">` with `connect-src
     'self' ws: wss:`. If Island prepends a stricter policy, the
     intersection rules out `unsafe-inline` / `unsafe-eval`, both of
     which the bundled React build needs at runtime. Symptom: white
     page + CSP violation in console.

3. **Does Island block `data:` / `blob:` iframes?**
   - The HTML canvas mounts `srcdoc` iframes for the rendered HTML.
     If Island denies `frame-src 'self' blob: data:`, the canvas
     surface goes blank.

4. **Can the user copy/paste between xterm and the editor?**
   - Island's clipboard rules can apply different policies to "copy
     out of an enterprise app" vs. "paste into one". Both of our
     surfaces are inside the same Island origin, so this should be
     fine, but DLP scanning might delay paste enough to feel laggy.

5. **Does `window.electron.files.openExternal(p)` work?**
   - Daemon-side `xdg-open` handoff to the OS default, then OS routes
     to Island. No Island API is involved. Sanity-check that the
     opened tab actually lands on the user's authenticated session.

## Things Island IT could break us on (admin-only)

These aren't user-controllable. If they bite, we need IT cooperation:

- **Loopback connection blocking:** if policy says "no connections to
  RFC1918 addresses or localhost," the page can't reach the daemon
  at all. Mitigation: ask for an exception for `127.0.0.1` on a
  documented port range.

- **Extension installation block:** Phase 2's companion extension
  needs admin allowlisting to be installed. v1 doesn't depend on it.

- **No-installer policy:** if users can't install our daemon binary,
  shipping a notarized `.pkg` that puts itself in `~/.local/bin/duo-web-d`
  becomes a real installer-distribution problem. Same problem as the
  Electron app's `dist`, slightly easier because the daemon is a
  much smaller surface to sign.

- **Microphone / camera / display capture:** v1 uses none of these.
  Phase 2 (browser automation via extension) might want
  `chrome.tabs.captureVisibleTab`, which has its own policy. Not v1's
  problem.

## Unknowns we'd want IT to confirm before promoting

When (if) this gets promoted to a numbered stage, the implementation
PRD needs answers to:

- Will Island's policy let our daemon listen on `127.0.0.1:<port>`?
  (This is OS-level; usually yes because Island doesn't manage the
  OS firewall.)
- Will Island let pages on a localhost origin upgrade to a WS on the
  same origin? (Standard Chromium does; usually yes.)
- Can we whitelist `~/.duo/` as a daemon install location, or does
  policy prefer a managed prefix like `/usr/local/island-apps/`?
- Does Island's "trusted PWA" mode help here (so Duo Web could be
  installed as a chrome-app shell)? Worth asking.

## Phase 2 (companion extension) considerations

When we restore `duo click/type/screenshot` via a browser extension,
Island's extension policy is the gate:

- Most enterprise IT will require the extension to be **chrome-web-store
  hosted + admin force-installed** rather than a developer-mode load.
  Means we need a publisher account + a review pass.
- Island's allowlist may need an explicit entry for our extension
  ID; coordinate with IT before rollout.
- Native messaging (extension ↔ daemon) is allowed in Chromium and
  almost always allowed in Island, but the manifest needs a managed
  config. Plan for a per-deployment manifest install step.

## Decisions deferred until we have a seat

- Whether to support a "no daemon" mode using File System Access API
  + cross-origin extension messaging (likely answer: no, keep the
  daemon, it's the cleaner trust boundary).
- Whether the daemon should ship as a Chromium PWA or a native binary
  (likely answer: native binary, because it needs node-pty).
- Whether Phase 2 uses Chromium native messaging or just an extension
  ↔ tab WS bridge (depends on Island's policy on native messaging).
