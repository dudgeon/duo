# Smoke walk — dev restart + pre-flight reference

> Detail backing the "before generating the page" step in
> `.claude/skills/smoke-walk/SKILL.md § 4`. Read on-demand when
> the rules-of-thumb in SKILL.md need the *why*.

## HARD RULE — Claude restarts Duo, never the user

This applies to EVERY verification flow, not just smoke-walk handoff.

**Never write any of these phrases anywhere in the conversation:**
- "to walk, run `npm run dev`"
- "once you restart Duo / the dev environment / the app"
- "after you relaunch Duo"
- "please restart Duo and verify"
- any sentence that puts the restart on the user.

**If verification needs a fresh main-process bundle** (you edited
`electron/`, `core/`, `shared/host-api.ts`, `shared/html-boilerplate.ts`,
or anything imported from `electron/main.ts`), YOU restart it:

```bash
ps -ef | grep "MacOS/Electron \." | grep -v grep | awk '{print $2}'
# → kill that PID, then:
npm run dev   # in background
# poll `duo doctor` until the socket is up, THEN proceed.
```

The user's only job in any verification flow is to *observe and
report* — not to debug whether Duo is running, not to relaunch it,
not to wait for HMR. If Duo is in a state where the change won't
show, that's Claude's problem to fix before handing off.

**Violations:** flagged 2026-05-02 ("NO NO NO -- the fucking skill
should tell you this") for the handoff case; and 2026-05-05
("'once you restart the dev environment' YOU restart the dev
environment") for mid-sprint verification.

## CRITICAL — never restart Duo mid-walk

Once the user has started clicking through the smoke walk page,
**do not kill the dev process tree.** Until ENH-038 (textarea
persistence) ships, the user's typed walk notes are DOM state in
the browser-tab textareas. A Duo restart closes those tabs and
**the textarea contents are lost**.

If you realize a restart is required mid-walk:

1. STOP. Do not kill anything.
2. Tell the user verbatim: "I need to restart Duo to apply <X>,
   but doing so will lose the walk notes you've typed so far. You
   have three options: (a) Copy results NOW with what you have,
   paste back, then I restart and we continue with the remaining
   items, (b) finish the walk first and I restart after, (c) I
   leave Duo alone and we proceed with whatever <X> would have
   fixed unfixed."
3. Wait for their answer. Do NOT proceed without explicit
   "yes restart" if option (a) or (b).

Once ENH-038 ships, the page localStorage-persists textarea
contents on every keystroke and a restart is recoverable —
remove this section at that point.

## HARD RULE — check for an existing `npm run dev` BEFORE spawning

Each `npm run dev` invocation spawns its OWN electron-vite, which
spawns its OWN Electron. The two trees are *not equivalent* —
they were compiled at different timestamps so their MAIN-process
bundles diverge (HMR only touches the renderer). With two
Electrons running you also have two competing socket binds and
ambiguous routing for `duo` CLI commands. The user sees two app
icons in the Dock and (correctly) demands an explanation.

Before any `npm run dev` decision, run THIS exact probe:

```bash
ps -ef | grep "MacOS/Electron \." | grep -v grep | awk '{print $2}'
```

Interpret:

- **Zero matches:** nothing running. Spawn `npm run dev` in
  background.
- **Exactly one match:** an existing dev (or packed app) is
  already live. **DO NOT spawn another.** Adopt it. Renderer
  changes you've already made are HMR'd in. If you have
  uncommitted main-process changes, warn the user and ask
  whether to restart that single Electron — DO NOT silently
  kill it, and DO NOT add a parallel one.
- **Two or more matches:** you (or a prior session) already
  spawned a duplicate. Stop. Tell the user, name the PIDs, ask
  which one to keep. Killing one without checking risks killing
  their workspace.

Violated 2026-05-04: two Electrons running in parallel because the
agent ran `npm run dev` without checking. Geoff (rightly) flagged
it as procedure failure. Read this section before EVERY pre-flight.

## Socket-cleanup gotcha

When you do find a duplicate and kill the wrong one (or even the
right one), the socket file at
`~/Library/Application Support/duo/duo.sock` may get unlinked as
part of either Electron's cleanup — even though the OTHER Electron
is still alive and was the original binder. Symptom: `duo open`
and other CLI verbs return *"Duo app is not running"* even though
`ps` shows the process is alive. The fix is a restart: kill the
surviving Electron and start fresh so the socket-server binds a
clean path. Don't try to "rescue" a broken-socket Electron —
restart is faster and more reliable.

## Action paths after the probe

- **A packed `.app` is running** (path contains `dist/mac-arm64/`
  or `/Applications/Duo.app`): tell the user once: *"Quitting the
  packed app and starting dev — your shipped code isn't live in
  the running build. The smoke page will reload when dev comes
  up."* Then: kill the packed app politely (`osascript -e 'quit
  app "Duo"'`) OR ask the user to quit it via ⌘Q if you don't
  have computer-use access. Do NOT proceed until it's gone — two
  Duo instances fighting over the socket is worse than no Duo.
- **Existing dev is running, no main-process changes pending**:
  adopt it as-is. Renderer changes are already HMR'd in.
- **Existing dev is running, main-process changes pending**:
  warn the user (one line: "I have main-process changes that need
  a restart for X / Y / Z; OK to restart Duo? No walk is in
  progress so no walk-notes will be lost."), wait for explicit
  yes, then restart that single Electron. Don't add a parallel
  one.
- **Nothing running**: launch `npm run dev` via Bash with
  `run_in_background: true`. Don't poll for output — the dev
  server takes 3–6s to boot.

After kicking it off, wait one cache-window (~270s if you have
nothing else to do, or ~10s plus a `duo nav-state` probe to
confirm the bridge is up). The probe returns JSON when the
renderer is alive; before that it errors with `ECONNREFUSED`.

If `duo nav-state` still errors after ~30s, surface the dev
server's stderr to the user — something else is wrong (port in
use, missing dependency, sandbox refusal). Don't keep silently
retrying.
