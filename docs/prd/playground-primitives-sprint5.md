# Playground primitives — Sprint 5 design PRD (v2, post-reframe)

> **Status:** 🟡 **Awaiting owner sign-off on D1, D2, D3.** (v1 had D1–D7;
> the reframe below collapsed most of them.) Implementation does not
> start until those three land.
>
> **Filed:** 2026-05-04 (start of v0.6.6 sprint).
> **Reframed:** 2026-05-04 (owner direction — see § Reframe).
> **Closes:** ENH-092 + ENH-093 + ENH-094 → ENH-043 (meta).
>
> **Companion artifact:**
> [`.claude/skills/worksheet/generate.test.ts`](../../.claude/skills/worksheet/generate.test.ts) —
> 51 characterization tests locking the *existing* worksheet
> behavior. After the refactor, these must keep passing — they're the
> floor, not the design target.

---

## Reframe (the v1 framing was wrong)

Owner direction, 2026-05-04 (paraphrased):

1. **Worksheets are authored BY Claude, FOR the user.** The author is a trusted agent collaborating with the user, not a stranger on the internet. Threat model is "Claude emits something the user didn't intend," not "rogue page tries to take over Duo."
2. **Floor too low > ceiling too low.** Missing primitives just mean Claude writes inline JS (fine — author is trusted). Restrictive primitives get bypassed and the abstraction becomes vestigial. Default permissive.
3. **The sandbox is an INTENT CONDUIT, not the execution layer.** Pages emit events describing user intent; Claude executes. Don't build mechanisms to do obviously harmful things (no "delete arbitrary files" verb), but don't build a deep gate either — the gate is the human-in-the-loop nature of Claude's response.
4. **Smoke walk is a BAD design centerpiece.** It's copy/paste-shaped because it predates `duo events --follow`. The right pattern: as the user interacts with the worksheet, events fire to Claude in real time. Claude reacts. No "Send results" button needed for the live-Duo case (it stays as a fallback for "user wants the result as text").

The single biggest design implication: **`duo:event` is the load-bearing primitive**, not `compose:result`. Every interaction with a worksheet is an event Claude can see live. State, DOM-reactivity, composition, clipboard — all stay in the toolkit, but they're scaffolding around the event channel.

## Goal

Build a generalizable **playground primitive set** that lets agent-emitted HTML pages express:

- **State** — persist + restore form values across reloads (localStorage-backed).
- **DOM reactivity** — class / text updates that react to state changes, declaratively.
- **Live event stream to Claude** — every interaction fires a `duo:event` Claude sees in real time.
- **Snapshot composition + clipboard** — *fallback* for the "user wants the result as text outside Duo" case.

Smoke walk is a **regression test**, not a design target. The 51 characterization tests must keep passing through the refactor — that's how we know we didn't break the only worksheet that exists today. But the new primitives should be designed for sprint-plan / lesson-progress / triage worksheets where events ARE the data, not for batch-send paste-back.

## Primitive surface (proposed)

All page-side primitives skip the trust gate. The existing canvas-action gate (`isPagePathTrusted`) stays in place for the existing host-side verbs (`claude:spawn` / `terminal:send` / etc.) — that's a separate question we can address if it comes up, but not in this initiative.

### State (ENH-092)

**Default behavior: every `<input>`, `<textarea>`, `<select>` inside the page persists to localStorage.** Opt out per element with `data-no-state`. No author markup needed for the common case.

```html
<!-- Persisted automatically. -->
<input type="radio" name="result-BUG-001" value="PASS">

<!-- Opt out — ephemeral search filter. -->
<input type="text" data-no-state placeholder="filter">

<!-- Wipe all state under this page's key (the Clear-saved button). -->
<button data-duo-action="state:wipe" data-confirm="Reset?">Clear</button>

<!-- Set every UNSET input matching a name pattern (Mark-all PASS). -->
<button data-duo-action="state:bulk-set"
        data-name="result-*"
        data-value="PASS">Mark all PASS</button>
```

State key auto-derived from `<meta name="duo-state-key">`, falling back to URL pathname.

### Live event stream — the load-bearing piece

**Every state change emits a `duo:event` automatically.** Claude subscribed via `duo events --follow` sees every interaction live. Opt out per element with `data-no-emit`.

Default event shape:
```json
{ "kind": "state:changed",
  "page": "<state-key>",
  "name": "<input-name>",
  "value": "<new-value>",
  "previous": "<old-value-or-null>" }
```

Override per element:
```html
<!-- Custom kind + payload merged with state-change shape. -->
<input type="radio" name="result-BUG-001" value="PASS"
       data-emit="walk:item-set"
       data-emit-payload='{"item":"BUG-001"}'>
```

Buttons can also emit explicit events without a state change:
```html
<button data-duo-action="duo:event"
        data-event="walk:done"
        data-payload-from="textarea[name=summary]">Done</button>
```

(`duo:event` already exists; `data-emit` / `data-emit-payload` on input elements is the new declarative auto-emit decorator.)

### DOM reactivity (ENH-092)

```html
<!-- Per-card class flip — opinionated for radio-shaped questionnaires.
     Container declares which input it follows; runtime sets is-answered
     + is-opt-<value> + (when value is exactly "SKIP") is-skip on container. -->
<section data-id="BUG-001" data-bind-result="result-BUG-001">
  ...
  <input type="radio" name="result-BUG-001" value="PASS">
  ...
</section>

<!-- Live tally — built-in computed fields ($count.<value>, $todo, $total,
     $state.<name>). Anything more complex stays in inline JS. -->
<span data-bind-text="$count.PASS"></span>
<span data-bind-text="$todo"></span>
```

### Snapshot composition + clipboard (ENH-093) — fallback path

For the "user walks away with the result as text" case (e.g. user closes Duo, takes their walk results elsewhere):

```html
<!-- JSON snapshot — exposed at window.duoCompose[id]. -->
<button data-duo-action="compose:json" id="walk-result">Snapshot</button>

<!-- Text snapshot — uses a named formatter from the small library at
     renderer/components/Page/composeFormatters.ts. v1 ships one
     formatter: "smoke-walk-default". Custom formats register via
     window.duoFormatters[name] = (state) => string in inline JS. -->
<button data-duo-action="compose:text"
        id="walk-text"
        data-format="smoke-walk-default">Compose</button>

<!-- Clipboard write — literal or composed. -->
<button data-duo-action="clipboard:copy" data-from-compose="walk-text">Copy results</button>

<!-- Send-to-Claude — uses window.duoSendResult (FOLLOWUP-007 binding) with
     clipboard fallback. STILL gated through the existing host-action gate.
     This is the only new verb that crosses into host execution. -->
<button data-duo-action="host:send-to-claude" data-from-compose="walk-text">Send</button>
```

These are *secondary* — for the live-in-Duo case, the event stream replaces them entirely.

### Browser-pane runtime injection (ENH-094)

CDP-injected `PLAYGROUND_RUNTIME_IIFE` parallel to `SELECTION_OBSERVER_IIFE` / `PATH_LINK_FORWARDER_IIFE`. Same trust posture as the canvas runtime: page-side verbs always work; host-side verbs gated.

The runtime is only injected on paths Duo loads (file:// + selected http(s) under user navigation), not on arbitrary remote URLs. That's the actual gate — enforcement at injection, not runtime checks.

---

## Tradeoffs needing your call (down to 3)

The reframe collapsed v1's D1 (auto-save → default-on), D5 (composition → fallback), D7 (trust gate → drop for page-side), D6 (glob acceptable). What's left:

### D1 — Event auto-emit posture

| Option | Behavior | Pros | Cons |
|---|---|---|---|
| A | Auto-emit ON by default; `data-no-emit` per element | Claude sees everything; zero markup; fits the live-stream goal. | Verbose `duo events` traffic on busy pages. |
| **B ← rec** | Auto-emit ON for `<input>` / `<textarea>` / `<select>`; OFF by default for buttons (buttons opt IN via `data-emit` or explicit `data-duo-action="duo:event"`) | Captures the meaningful state changes; doesn't fire on every click. | Authors might want button events without ceremony. |
| C | Auto-emit OFF; per-element `data-emit` opt-in | No surprise traffic. | Low ceiling — Claude misses interactions unless authors decorate. |

### D2 — Computed fields for `data-bind-text`

How rich does the built-in expression vocabulary need to be?

| Option | Vocabulary | Covers |
|---|---|---|
| A | `$state.<name>` only | Mirror a single field. |
| **B ← rec** | `$state.<name>`, `$count.<value>`, `$total`, `$todo`, `$summary` (a default-formatted summary string like "2 pass · 1 fail · 1 to go") | Smoke walk's tally + most live-progress dashboards. |
| C | A small expression DSL: `count(items where=result==pass)` | Arbitrary predicates. Requires parser. |

The recommendation is B because anything more complex falls trivially to inline JS — a 3-line `<script>` tag computing the value and writing to a `<span>`. That's the floor-too-low-is-fine principle: missing primitives = Claude writes inline JS.

### D3 — DOM-binding scope (per-card class flip)

Smoke walk needs "this card's class reflects the answer to its containing input." Three options:

| Option | Behavior | Pros | Cons |
|---|---|---|---|
| A | Generic — `data-bind-class="<input-selector>:<class-template>"` with `{value}` substitution | Maximally flexible. | Mini-template; more author surface. |
| **B ← rec** | Opinionated — `data-bind-result="<input-name>"` on container; runtime ALWAYS applies `is-answered`, `is-opt-<lowercase-value>`, `is-skip` (when value === SKIP). Non-radio surfaces use inline JS. | Smoke walk + most worksheets fit perfectly with one attribute. | Opinionated class names; non-radio surfaces don't fit. |
| C | No primitive — inline JS only | Smallest surface. | Smoke walk has 10–20 lines of bespoke JS. |

Option B is consistent with the floor-not-ceiling principle: covers the common case in one attribute; uncommon cases don't get jammed into a generic primitive but fall to inline JS instead.

---

## What stays in worksheet config (deliberately not generalized)

After D1–D3 are decided and primitives are in place, the worksheet generator (`worksheet/generate.mjs`) still owns:

1. **The smoke-walk-shaped text format** — `[PASS] BUG-001 — Title\n  Notes: line\n` etc. Lives as `composeFormatters['smoke-walk-default']`. Other use cases register their own (one-line `window.duoFormatters[name] = ...`).
2. **Backtick parsing for command detection** — worksheet authoring sugar, not a primitive.
3. **Path-link wrapping** — already an existing primitive (`<a class="duo-path-link">`).
4. **Per-step `<pre>` copy buttons** — orthogonal; stays in inline-JS hook.
5. **Header line templating** — JSON-driven manifest field, stays in `generate.mjs`.

## Implementation order (post-sign-off)

1. **Commit A — ENH-092 part 1: state + auto-emit.** `data-state-input` (default-on) + `data-emit` decorator + `state:wipe` + `state:bulk-set`. Add tests for the auto-emit shape.
2. **Commit B — ENH-092 part 2: DOM reactivity.** `data-bind-text` with computed fields + `data-bind-result`. Add tests.
3. **Commit C — ENH-093: composition + clipboard + send.** `compose:json`, `compose:text`, `clipboard:copy`, `host:send-to-claude`. Stand up `composeFormatters`. Add tests.
4. **Commit D — ENH-043 refactor.** Rewrite `worksheet/generate.mjs` declaratively. Inline `<script>` reduced to `<10 lines`. **The 51 characterization tests pass unchanged.** Plus new tests for the live-event-stream behavior.
5. **Commit E — ENH-094: CDP injection for browser-pane pages.** Same primitives available there. Validate with a sprint-plan worksheet hosted in browser pane that drives Claude live.

The first new use case to demonstrate the live-event pattern (post-Commit C, before Commit D's full refactor) is a tiny **proof-of-concept page**: 3 buttons that fire `duo:event`, with `duo events --follow` open in a terminal showing them live. Validates the loop end-to-end before the smoke-walk refactor.

Estimated 1–2 sprints for the full path.

---

## What I need from you to start

**D1, D2, D3.** Pick or push back. Once those land I start Commit A.
