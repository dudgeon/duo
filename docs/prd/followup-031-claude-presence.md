# FOLLOWUP-031 PRD — Hoist the Claude-presence subscription (kill `MaxListenersExceededWarning`)

> **Status:** spec drafted 2026-06-06; **not yet implemented** (assessment
> `confirmed-open` — `git log` since 2026-05-25 shows zero commits to
> `useClaudePresence.ts` / `TerminalPane.tsx` for this, and no
> `renderer/contexts/` dir exists). Effort **S** (~30 min), risk **low**
> (behavior-identical). Filed in the v0.8.0 audit (Tier 2) as the
> highest user-facing item in that batch (console noise).
> **References:**
> - Task entry: [`tasks.md` § FOLLOWUP-031](../../tasks.md) (line ~415).
> - Origin feature: **ENH-013** — claude-presence probe (the Send → Duo pill
>   gate).
> - Code:
>   - `renderer/hooks/useClaudePresence.ts` — the hook that over-subscribes.
>   - `renderer/components/TerminalPane.tsx:166, :248` — the two renderer
>     subscribe sites (one top-level + one per `TerminalInstance`).
>   - `renderer/App.tsx:841` — the third subscriber
>     (`useFrontTerminalClaudeLive` → `ClaudePresenceDot`).
>   - `electron/preload.ts:683-687` — `onClaudePresenceChange` →
>     `ipcRenderer.on(IPC.TERMINAL_CLAUDE_PRESENCE_CHANGED, …)`.
>   - `electron/main.ts:769-789` — the probe broadcast (`safeSend`).
>   - `core/claude-presence.ts` — `ClaudePresenceProbe` (main-side source of
>     truth).

---

## 1. What we're building

A one-subscription refactor of the **Claude-presence** signal so that an
N-terminal-tab session registers **exactly one** `ipcRenderer` listener on the
`terminal:claude-presence-changed` channel instead of **N + 2**.

Today the presence state is delivered by `useClaudePresence()`
(`renderer/hooks/useClaudePresence.ts:15-19`), which calls
`window.electron.terminal.onClaudePresenceChange(...)` in a `useEffect`. Every
mount of that hook = one `ipcRenderer.on` (`electron/preload.ts:685`). The hook
is mounted in three places:

| Subscriber | Site | Count |
|---|---|---|
| `TerminalPane` top-level (for the `SessionHeader` pill) | `TerminalPane.tsx:166` | 1 |
| `TerminalInstance` — one per terminal tab (for the Return-override gate, BUG-154) | `TerminalPane.tsx:248`, rendered by `tabs.map(...)` at `:190` | **N** |
| `App` (for the `ClaudePresenceDot`) via `useFrontTerminalClaudeLive` | `App.tsx:841` | 1 |

So with `N` tabs the total is `N + 2`. At ~9 tabs that's 11 listeners — one
past Node's default `MaxListeners = 10`, which fires:

```
(node:NNNN) MaxListenersExceededWarning: Possible EventEmitter memory leak
detected. 11 terminal:claude-presence-changed listeners added to
[IpcRenderer]. MaxListeners is 10.
```

The listeners *are* cleaned up correctly on unmount (`useClaudePresence.ts:19`),
so this is **not** an actual leak — but the warning fires the instant the count
crosses 10, which a routine multi-tab session does, and it spams the renderer
console with scary "memory leak" text.

**This is the fix:** subscribe **once** at `App` mount via a context provider,
and turn `useClaudePresence` into a `useContext` consumer. Every existing
caller keeps the same hook signature and the same value; the only observable
change is the warning's absence.

---

## 2. Persona + job to be done

**Primary persona:** the PM/owner (and any contributor) running a realistic
multi-terminal Duo session and watching the DevTools console while debugging
something *else*.

**Job:** *"Don't make me wade through a fake 'memory leak detected' warning
that has nothing to do with what I'm debugging."* A spurious
`MaxListenersExceededWarning` erodes trust in the console — the next real
warning is easier to miss when the log is already noisy. The presence pill and
dot must keep behaving exactly as they do today; this is purely a quiet-the-log
refactor.

---

## 3. The problem this fixes

A correct-but-noisy subscription pattern. `useClaudePresence` is a fine hook for
a single consumer, but it's mounted once per terminal tab — and the presence
value it returns is **front-terminal-global**, not per-tab (see § 4 D-A), so
every one of those N subscriptions receives the *same* broadcast and stores the
*same* scalar. N copies of one global value is exactly the redundancy the
warning is complaining about. Centralizing the subscription removes the
redundancy and the warning in one move.

---

## 4. The model + decisions

### D-A — The presence value is a single global scalar, not a per-tab map (grounding correction)

The original task sketch (`tasks.md` § FOLLOWUP-031, step 1) proposes a context
provider that "holds the **per-tab presence map**." That is wrong, and building
to it would over-engineer the fix. The main-side probe
(`core/claude-presence.ts`, started at `electron/main.ts:769`) polls **only the
active/front terminal's** PTY tree and broadcasts a single
`ClaudePresenceState` value via `safeSend(IPC.TERMINAL_CLAUDE_PRESENCE_CHANGED,
state)` (`electron/main.ts:789`) — there is no tab id in the payload and no
per-tab map anywhere. Every subscriber already receives this one front-terminal
value.

**Decision:** the context holds a **single `ClaudePresenceState`** (default
`'no-pty'`), mirroring exactly what the hook stores today. No map, no per-tab
keying.

> Note: the task entry also claims the fix "mirrors the existing
> `useFrontTerminalClaudeLive` pattern." That is also a mis-read —
> `useFrontTerminalClaudeLive` lives in the *same file* and is itself a thin
> wrapper that calls `useClaudePresence` (i.e. another subscriber, not a
> context to copy). There is no pre-existing context to mirror; we are creating
> the first one.

### D-B — One provider at App root; hooks become context consumers

**Decision:** create `renderer/contexts/ClaudePresenceContext.tsx`:

- A `ClaudePresenceContext` (default `'no-pty'`).
- A `ClaudePresenceProvider` that runs the *single* `useEffect` +
  `onClaudePresenceChange` subscription (the body lifted verbatim from
  `useClaudePresence.ts:13-20`) and supplies the latest state via the context.
- `App.tsx` wraps its tree in `<ClaudePresenceProvider>`.

Then rewrite the two existing hooks in `renderer/hooks/useClaudePresence.ts` to
consume the context instead of subscribing:

```ts
export function useClaudePresence(): ClaudePresenceState {
  return useContext(ClaudePresenceContext)
}
export function useFrontTerminalClaudeLive(): boolean {
  const state = useClaudePresence()
  return state === 'claude' || state === 'starting'
}
```

Because the **hook signatures are unchanged**, none of the call sites
(`TerminalPane.tsx:166`, `:248`; `App.tsx:841`) need edits beyond ensuring they
render under the provider — which `App.tsx:841`'s own usage forces us to verify
(the provider must wrap whatever subtree contains both the `ClaudePresenceDot`
and the `TerminalPane`). After this, total `ipcRenderer` listeners on the
channel = **1**, regardless of tab count.

### D-C — No `setMaxListeners` band-aid

**Decision:** do **not** "fix" this by bumping the IPC emitter's max-listener
ceiling (`ipcRenderer.setMaxListeners(n)`). That suppresses the symptom while
leaving N redundant subscriptions, and would re-fire for any future
high-fan-out channel. The single-subscription refactor is the right shape and
the assessment confirms no `setMaxListeners` mitigation exists anywhere today —
keep it that way.

---

## 5. Behaviors (must stay identical)

After the refactor, all of the following must be byte-for-byte
indistinguishable from today:

- **Send → Duo pill** (`SessionHeader`, gated on `claudePresence` at
  `TerminalPane.tsx:183`) enables/disables exactly as before as the front
  terminal gains/loses a live `claude` session.
- **`ClaudePresenceDot`** (`App.tsx:4015`, driven by
  `useFrontTerminalClaudeLive`) lights/dims identically.
- **Return-override gate** (BUG-154, `TerminalInstance` at
  `TerminalPane.tsx:248-250`) still reads the live presence state into its ref
  on every render, so ⌘-Return vs Return submit behavior in a shell tab running
  `claude` is unchanged.
- Switching the front terminal still updates all three consumers in the same
  React tick the broadcast arrives.

The single observable delta: the `MaxListenersExceededWarning` no longer appears
in the renderer console at any tab count.

---

## 6. Implementation notes

- **New file:** `renderer/contexts/ClaudePresenceContext.tsx` (the directory
  does not exist yet — create it). This is the first entry under
  `renderer/contexts/`.
- **Touched:** `renderer/hooks/useClaudePresence.ts` (both functions become
  context consumers), `renderer/App.tsx` (wrap the tree in the provider; add the
  import).
- **Untouched:** `electron/preload.ts`, `electron/main.ts`, `core/claude-presence.ts`,
  `shared/types.ts` — the IPC channel, payload shape, and main-side probe do not
  change. This is a renderer-only refactor.
- **Provider placement matters.** The provider must wrap *both* the
  `ClaudePresenceDot` subtree and the `TerminalPane` subtree. Place it high
  enough in `App`'s returned tree that `App.tsx:841`'s
  `useFrontTerminalClaudeLive()` call also resolves the context (a hook called
  in `App`'s own body reads context from the *nearest provider above App*, so if
  the provider is rendered *inside* `App`'s JSX it won't cover the `App`-body
  call — either lift the `claudeLive` read into a small child component under the
  provider, or wrap `<App/>` itself in `main.tsx`/the root render). Pick whichever
  keeps the diff smallest; the assessment's "wrap App's tree in the provider"
  is the intent — just make sure the App-body consumer is genuinely under it.

---

## 7. CLI / UI parity

**No CLI surface.** Claude-presence is a main-process probe broadcast to the
renderer for UI affordances (pill enablement, status dot, Return-override gate);
there is no user-facing toggle, click, menu, or keystroke that this refactor
adds or changes. The agent already has the equivalent signal independently —
`duo status` / `claudePresence` reporting come from the same main-side probe,
not from these renderer subscriptions — so there is nothing new for the CLI to
read or set. **No new verb; no parity gap.** (Recorded here as a deliberate
non-asymmetry: the refactor is invisible to both the human UI and the CLI.)

---

## 8. Verification — checklist

This is a behavior-identical renderer refactor, so verification is *(a)* prove
the warning is gone and *(b)* prove nothing else regressed. A short
`/smoke-walk` confirmation of the pill/dot is owed before any version cut (it
touches `renderer/`).

**Automated (the durable guard the task asks for):**

1. **Regression test — listener count ≤ 1.** Add a unit test (e.g.
   `renderer/contexts/ClaudePresenceContext.test.tsx` or alongside the hook)
   that mounts the provider once and renders `useClaudePresence` from **N**
   (say 12) child components, then asserts the number of listeners registered on
   the `terminal:claude-presence-changed` channel is **≤ 1**. Stub
   `window.electron.terminal.onClaudePresenceChange` to count
   subscribe/unsubscribe calls (the previous code would have produced 12; the
   fix produces 1). This is the test the assessment and task both call for, and
   its absence today is confirmed (no test references the channel).
2. `npm run typecheck` clean.

**Live (macOS dev session) — owed before cut:**

3. **Warning gone.** Open Duo, open ~10+ terminal tabs, watch the renderer
   DevTools console (`duo devtools`): **no** `MaxListenersExceededWarning` for
   `terminal:claude-presence-changed` appears (it reliably did before).
4. **Pill still gates.** In a tab running `claude`, the Send → Duo pill is
   enabled; in a plain shell tab it's hidden — identical to today.
5. **Dot still tracks.** The `ClaudePresenceDot` lights when the front terminal
   has a live Claude session and dims otherwise.
6. **Return-override unaffected.** With "⌘-Return to submit for Claude" on, a
   shell tab running `claude` still requires ⌘-Return (BUG-154 behavior intact).
7. **Front-terminal switch propagates.** Switching the active tab between a
   Claude tab and a shell tab flips pill + dot in lockstep.

---

## 9. Future / open

- **None blocking.** This is a self-contained Tier-2 cleanup.
- If a future feature genuinely needs **per-tab** presence (e.g. a status dot on
  *every* tab in the strip, not just the front one), that would reopen D-A and
  require main-side changes (the probe would have to poll all PTYs and key the
  broadcast by tab id). Today's model — and this fix — is deliberately
  single-global to match the existing probe.
