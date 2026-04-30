# Phase 7 implementation plan

> **Status:** Draft, 2026-04-30. Concretizes
> [`distribution-strategy.md`](./distribution-strategy.md) into
> file-level work. Phase 7 is scoped to the architectural cutover
> (Electron app becomes the NM host, `phase0/helper/` becomes a
> 50-line shim, extension talks to Electron's socket-server). Phase 8
> handles the rename from `phase0/` to top-level + Web Store
> promotion + background-mode menu bar.

## Prerequisites

Before any code changes:

- 🟡 **Phases 5/6/6.5 verified** — the agent verb wire format and
  CLI bridge protocol are proven working. Without this, Phase 7
  builds on potentially-broken contracts.
- ⬜ **Stage A merged to main** — `core/` is the foundation that
  the Electron app's main process and the NM shim both share.
  Smoke-walk per `docs/dev/smoke-checklist.md`, PR, merge.
- ⬜ **Decision review** — re-read `distribution-strategy.md` decision
  log; confirm none of those choices have aged out (auto-launch vs.
  background-mode, `chrome:` prefix, Web Store name, etc.).

## Scope summary — what changes

| File / area | Change | LOC est. |
|---|---|---|
| `electron/main.ts` | New `--nm-shim` startup branch; bypass BrowserWindow, run stdio↔socket proxy loop | +60 |
| `electron/socket-server.ts` | Add `agent:*` and `cli:request` message dispatch; reuse existing CLI verb path | +80 |
| `electron/install-nm-manifest.ts` (new) | First-run install routine that drops the NM manifest at `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.duo.app.json` | +40 |
| `electron/menu.ts` | Add Help → "Reset Chrome integration" menu item | +10 |
| `cli/duo.ts` | Add `chrome:` / `embedded:` prefix routing; protocol-version handshake awareness | +60 |
| `phase0/extension/sw.js` | Switch port name from `com.duo.phase0` to `com.duo.app`; add protocol handshake | +30 |
| `phase0/extension/manifest.json` | Bump to v0.7.0; description/permissions roll forward | +0 |
| `phase0/helper/duo-helper.js` | **DELETE most of it**. Becomes a 50-line stdio↔socket proxy shim. PTY/files/CLI-bridge code moves to Electron. | -350 |
| `phase0/helper/install.sh` | **DELETE**. NM install moves into the Electron app's first-run routine. | -150 |
| `phase0/cli/duo-ext` | **DELETE**. Functionality merges into `cli/duo.ts`. | -250 |

Net: roughly **-470 LOC** (much of `phase0/helper/` collapses; the
NM shim is tiny). One new ~40 LOC file (`install-nm-manifest.ts`).

## File-by-file detail

### `electron/main.ts` — `--nm-shim` startup branch

```ts
// At the top of main(), before any Electron BrowserWindow setup:
if (process.argv.includes('--nm-shim')) {
  await runNmShim()
  return
}

// ... rest of main() unchanged ...
```

The `runNmShim()` function:

1. Opens stdio in binary framing mode (length-prefixed JSON, same
   format as Chrome's NM protocol).
2. Connects to the running Electron app's socket at
   `~/Library/Application Support/duo/duo.sock` (with TCP fallback
   per Stage 20 ADR).
3. If the socket isn't reachable: `child_process.spawn` Duo.app via
   `/usr/bin/open -gj /Applications/Duo.app`; poll the socket every
   200ms for up to 5 seconds; bail with a clean error if it never
   comes up.
4. Once connected, proxy stdin frames → socket and socket replies →
   stdout, both as the same length-prefixed JSON envelope. No
   schema awareness — this is a dumb pipe.
5. On stdin EOF (Chrome closed the NM port), close the socket and
   exit 0.

The shim runs as a *separate process invocation* of the same Duo
app binary. Chrome spawns one shim per NM connection; the Electron
app stays running across many shim spawns.

### `electron/socket-server.ts` — accept agent verbs + cli:request

The current socket-server.ts handles CLI verbs from `cli/duo` (the
existing CLI). The diff:

1. **Add `agent:*` cases** to the existing switch statement. Each
   maps to a method on `BrowserManager` (for embedded surface) or
   uses `chrome.tabs` / `chrome.scripting` semantics… **wait** —
   those don't exist server-side. Server-side, the `agent:*` verbs
   coming from the extension are *requests to drive Chrome*, which
   the Electron app cannot do directly. So the routing inverts:
   - `agent:*` from extension → echo back via the same NM shim
     pipe to the extension SW, which uses `chrome.tabs` /
     `chrome.scripting` / `chrome.debugger` to actually drive
     Chrome.
   - `embedded:*` from extension or local CLI → Electron's
     BrowserManager / CdpBridge handles directly.
   - `chrome:*` from local CLI → goes through the NM shim back
     into the extension SW, which runs the agent verb against
     Chrome.

   This is the key insight. The CLI verb prefixes route to
   *different driver instances*, and the socket-server is the
   switchboard.

2. **Add `cli:request` handling** for the bridge case: a CLI verb
   needs to round-trip out to the extension SW. The socket-server
   maintains a map of `extensionPorts` (each NM shim that connects
   adds a port; on cli:request with a `chrome:` verb, route to one
   of those ports and await the response).

3. **Add the protocol handshake** as the first message any new
   port receives:
   ```json
   {"type": "hello-ack", "ok": true,
    "electronVersion": "0.7.0", "supportedProtocols": [1]}
   ```

### `electron/install-nm-manifest.ts` — new file

Called once on Electron app first launch (and again whenever the
"Reset Chrome integration" menu item is picked). Idempotent.

```ts
// Drops a JSON manifest at the Chrome NM lookup path pointing at
// the running Duo.app's binary with --nm-shim flag.
//
// Strips com.apple.provenance xattr from the binary if Chrome's
// hardened-runtime sandbox blocks the spawn (per phase0/README.md
// "Known gotchas"). Logs the install to ~/.claude/duo/install.log.

export async function installNmManifest(extensionId: string): Promise<void>
```

Key details:
- Manifest path: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.duo.app.json`
- Binary path: `/Applications/Duo.app/Contents/MacOS/Duo --nm-shim`
  (or `app.getPath('exe')` for dev)
- `allowed_origins`: starts with the extension's published ID once
  Web Store publishes; for unlisted/dev cohort, include the
  current sideloaded extension ID.

### `cli/duo.ts` — verb prefix routing + handshake

Current `cli/duo.ts` already speaks the Electron socket protocol.
Phase 7 adds:

1. **Verb prefix parsing** before sending to socket:
   ```ts
   // duo nav <url>          → DuoCommandName 'nav', target='auto'
   // duo embedded:nav <url> → DuoCommandName 'nav', target='embedded'
   // duo chrome:nav <url>   → DuoCommandName 'nav', target='chrome'
   ```
2. The socket-server reads `target` to decide routing. `auto`
   defaults to whichever surface matches the calling PTY's session
   origin (env var `DUO_SESSION_ORIGIN=embedded|chrome`).
3. **Protocol version** in the first message. The CLI doesn't need
   to handle mismatch (the user gets a clear error from the
   server's reply); the extension does.

### `phase0/extension/sw.js` — name + handshake

1. Change `HELPER_NAME = 'com.duo.phase0'` to `'com.duo.app'`.
2. After `connectNative`, send `hello` with `{protocolVersion: 1, extensionVersion: chrome.runtime.getManifest().version}`.
3. On `hello-ack` with `ok: false`: dispatch a side-panel error
   message (rendered as the failure card per the strategy doc's
   failure-UX table).
4. Otherwise resume normal operation.

### `phase0/helper/duo-helper.js` — collapses to a shim

Most of the current 250+ line helper goes away. PTY logic, files
logic, agent verb dispatch, CLI socket — all of these now live in
the Electron app. What remains is just the 50-line stdio↔socket
proxy described above… which, since the same logic is also in
`electron/main.ts`'s `--nm-shim` mode, means **the helper file
deletes entirely**. The NM manifest points at Duo.app's binary, not
at the helper.

```bash
git rm phase0/helper/duo-helper.js
git rm phase0/helper/install.sh
git rm -r phase0/helper/  # whole directory goes
```

### `phase0/cli/duo-ext` — collapses

Same fate. The unified `cli/duo` handles all transports. Delete:

```bash
git rm phase0/cli/duo-ext
git rm -r phase0/cli/
```

## Testing matrix

After Phase 7 work, walk this matrix before promoting:

1. **Electron app standalone (no extension installed)** — terminal,
   embedded browser, file edits, canvas, all CLI verbs without
   prefix. Should be indistinguishable from v0.6.x.
2. **Electron app + extension, both running** — open extension's
   side panel; agent verbs reach Chrome; embedded verbs reach the
   Electron app's pane; auto-launch isn't triggered (app already
   up).
3. **Extension only, Electron app not running** — open extension's
   side panel; auto-launch fires; Duo.app comes up; extension
   connects after ~3s; verbs work.
4. **Extension on Electron-too-old** — install extension v0.7+ but
   keep Electron at v0.6.x; protocol mismatch should produce the
   side-panel error card with a download link.
5. **Sandbox-tolerant CLI** — run `duo tabs` and `duo embedded:nav`
   from inside a Claude Code sandbox; both succeed via the TCP
   fallback path.
6. **Reset Chrome integration menu** — menu item re-installs the
   NM manifest cleanly; existing extension port reconnects on next
   activity.

## Web Store prep checklist

Independent of code work; can run in parallel:

- [ ] Icon — 128x128 PNG (Web Store requirement). Use existing Duo
      app icon.
- [ ] Screenshots — at least 3, 1280x800 or 640x400. Side panel
      open showing terminal + filetree; canvas tab with markdown
      editor; agent verb running.
- [ ] Privacy policy — short page on the Duo website (or GitHub
      Pages) covering what the extension reads (active tab content
      via `<all_urls>` for `chrome.scripting`) and what it sends
      where (only to the local Duo.app via NM; nothing leaves the
      machine).
- [ ] Description — 132 chars + 16,000 char detailed. Position as
      "companion to Duo Desktop", reference the website, link the
      privacy policy.
- [ ] Permission justifications — one paragraph each for `<all_urls>`,
      `tabs`, `scripting`, `debugger`, `nativeMessaging`, `sidePanel`.
- [ ] Single-purpose justification — Web Store rule: one core use
      case per extension. Use case = "Pair your Chrome with Duo
      Desktop's terminal sessions; let Claude drive your tabs."
- [ ] Web Store dev account — $5 one-time fee. Use Geoff's
      personal account or a dedicated Duo account.

## Out of scope for Phase 7

These are deliberately deferred:

- **Background-mode menu bar.** Auto-launch covers the first-time
  case; background-mode is an optimization. Phase 8 if cohort
  feedback says always-on matters.
- **Cross-platform.** Electron app is macOS-only; extension follows.
  Linux/Windows is its own discussion.
- **`phase0/` rename to top-level.** That's Phase 8 cleanup once
  the architecture is stable on `main`.
- **`cli/duo` consolidation polish** — auto-detect transport, drop
  duplicate verbs, etc. Phase 7 just adds prefix routing and the
  handshake; further polish is Phase 8.
- **Skill update for Chrome surface.** `skill/SKILL.md` and
  `agents/duo.md` need new entries for `chrome:nav`, `chrome:title`,
  etc. Mechanical work; can run in parallel with Phase 7 code.

## Risk register

| Risk | Mitigation |
|---|---|
| Electron app crash during NM shim spawn → extension shows ECONNREFUSED forever | Shim has 5s connect timeout + clean error; auto-launch retries once on initial failure |
| User has multiple Electron app instances (e.g. dev build + production) | Manifest's `allowed_origins` is per-extension-ID; only one Duo binary registered at a time. Document the conflict in install routine |
| Chrome NM spawn fails silently due to xattr (Sequoia gotcha) | Install routine strips `com.apple.provenance` from the Duo.app binary before writing the manifest |
| Web Store reviewer rejects `<all_urls>` | Permission justification text emphasizes localhost-only data flow + agent-pair-coding use case; alternative is to scope to specific origins (slack, github, gmail, etc.) but loses generality |
| Two Electron apps + one extension creates port conflict | Socket-server uses TCP `0` (ephemeral port); port file rotates per app instance. Extension reconnects to whichever app is currently running |
| Auto-launch annoys users | Add a manifest setting "Don't auto-launch" → extension shows "Click to start Duo" button instead. v0.7.x ships auto-launch on; v0.8.x can let user opt out |

## Effort

Roughly **2 working days** end-to-end:

- 0.5 day: NM shim + first-run install routine + handshake
- 0.5 day: socket-server agent verb routing + extension SW changes
- 0.5 day: CLI prefix routing + tests
- 0.5 day: Web Store listing prep + walking the test matrix

Web Store review takes 3-5 business days separately; submit early.

## Done definition

Phase 7 is done when:

- ✅ Test matrix above all-green
- ✅ Unlisted Web Store listing live with private install URL
- ✅ Stage 21d Trailblazers cohort can install both shapes from a
  single set of instructions and have everything work first try
- ✅ `phase0/helper/` and `phase0/cli/` directories are gone
- ✅ `cli/duo` handles `chrome:` and `embedded:` prefixes correctly
- ✅ Helper log heartbeat in `~/.claude/duo/phase0-helper.log` is
  replaced by an Electron-app log path that the user can tail
- ✅ `docs/research/duo-as-chrome-extension/build-roadmap.md`
  Phase 7 row flips ✅
