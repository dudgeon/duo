# Playground primitives — Sprint 5 design PRD

> **Status:** 🟡 **Awaiting owner sign-off on tradeoffs (D1–D6).**
> Implementation does not start until D1–D6 are decided.
>
> **Filed:** 2026-05-04 (start of v0.6.6 sprint).
> **Closes:** ENH-092 + ENH-093 + ENH-094 → ENH-043 (meta).
>
> **Companion artifacts already shipped this sprint:**
> - [`.claude/skills/worksheet/generate.test.ts`](../../.claude/skills/worksheet/generate.test.ts) —
>   51 characterization tests locking in the current worksheet
>   contract (state, tally, mark-all, clear, composition, clipboard,
>   send-to-Claude, per-step copy buttons, path-link wrapping). When
>   the refactor onto primitives lands, these must keep passing.

---

## Goal

Build a generalizable **playground primitive set** that lets agent-emitted HTML pages express:

- **State** — persist + restore form values across reloads.
- **DOM reactivity** — class / text updates that react to state changes, declaratively.
- **Composition** — gather form state into a structured payload.
- **Clipboard + send-to-Claude** — get the payload to the user (or the agent).

The smoke walk is the **canonical test case**, NOT the target. The primitives exist for sprint plans, retros, triage forms, lesson dashboards, and futures we haven't imagined yet. **The point of this initiative**, in the owner's words: *"if the smoke walk using playground primitives is not possible, then our playground implementation is fucked and we need to fix it."*

Calibration rule (owner direction): **be pragmatic. Some complexity stays in use-case config. Generalize where the future will benefit.**

## Current contract (the floor)

The 51 tests in `.claude/skills/worksheet/generate.test.ts` define what "behaving the same as today" means. After the refactor lands, every test must still pass. Read the test file to see the exact contract — this PRD won't restate it.

## Primitive surface (proposed)

Each primitive uses the existing `data-duo-action="<verb>"` attribute pattern. The runtime is the same `installPlaygroundActions(doc, opts)` already in `playgroundActions.ts`. New verbs slot into the existing parser.

### State (ENH-092)

```html
<!-- Save/restore — automatic on inputs marked data-state-input. -->
<input type="radio" name="result" value="PASS" data-state-input>

<!-- Read a state field into an attribute. Used to restore between reloads
     or to mirror state into a non-input element. -->
<span data-bind-text="$state.notes">…</span>

<!-- Wipe all state under this page's key (the Clear-saved button). -->
<button data-duo-action="state:wipe" data-confirm="Reset?">Clear</button>

<!-- Set every UNSET input matching a name to a value (Mark-all PASS). -->
<button data-duo-action="state:bulk-set"
        data-name="result-*"
        data-value="PASS">Mark all PASS</button>
```

State key auto-derived from `<meta name="duo-state-key">`. If absent, falls back to URL pathname.

### DOM reactivity (ENH-092)

```html
<!-- Per-card class flip. The container has a child input; runtime listens
     for change events on that child and applies the templated class. -->
<section data-id="BUG-001"
         data-bind-class="result-{name}:is-opt-{value}|is-answered|is-skip-when-skip">
  ...
  <input type="radio" name="result-BUG-001" value="PASS" data-state-input>
  ...
</section>

<!-- Live tally — built-in computed fields ($count.<value>, $todo, $total). -->
<span data-bind-text="$count.PASS"></span>
<span data-bind-text="$todo"></span>
```

### Composition (ENH-093)

```html
<!-- Build a JSON payload from page state. The result is exposed at
     window.duoCompose[id] for downstream consumers. No host round-trip. -->
<button data-duo-action="compose:json" id="walk-result">…</button>

<!-- Build a text payload using a NAMED format (in a small fallback
     library; see D5 below for the alternatives). -->
<button data-duo-action="compose:text"
        id="walk-text"
        data-format="smoke-walk-default">…</button>
```

### Clipboard + send (ENH-093)

```html
<!-- Write a literal text or a previously composed payload. -->
<button data-duo-action="clipboard:copy" data-text="literal value">Copy</button>
<button data-duo-action="clipboard:copy" data-from-compose="walk-text">Copy results</button>

<!-- Same shape, different destination. Falls back to clipboard if the
     window.duoSendResult binding isn't present. -->
<button data-duo-action="host:send-to-claude" data-from-compose="walk-text">Send</button>
```

### Browser-pane runtime injection (ENH-094)

CDP-injected `PLAYGROUND_RUNTIME_IIFE` parallel to `SELECTION_OBSERVER_IIFE` / `PATH_LINK_FORWARDER_IIFE`. Same trust gate (`isPagePathTrusted`). No new author-facing API — same verbs above just become available in browser-pane pages too.

---

## Tradeoffs needing your call

These are the design choices that shape both the test contract and the primitive surface. **My recommendations are marked `← rec`**; please pick or push back.

### D1 — State auto-save scope

| Option | Behavior | Pros | Cons |
|---|---|---|---|
| A | Implicit: every input persists (today's smoke walk) | Zero markup. | No opt-out for ephemeral inputs. |
| **B ← rec** | Explicit: `data-state-input` opt-in | Author controls scope; future-proof for mixed-state pages. | One attr per input. |
| C | Default-on with `data-no-state` opt-out | Sensible defaults. | Inverted from verb model. |

### D2 — State key derivation

| Option | Behavior | Pros | Cons |
|---|---|---|---|
| A | Auto-derive from URL pathname | No markup. | Two worksheets at same URL collide. |
| **B ← rec** | `<meta name="duo-state-key">`, fallback to URL | Author controls; predictable. | One meta tag. |
| C | Per-element `data-state-key` | Maximally flexible. | Overkill for 99%. |

### D3 — Bind-text expression complexity

| Option | Behavior | Pros | Cons |
|---|---|---|---|
| A | Tiny DSL: `count(items where=result==pass)` | Compact, expressive. | Need parser; new mini-language. |
| **B ← rec** | Built-in computed fields: `$count.PASS`, `$total`, `$todo`, `$state.<name>` | No parser; covers 80% of cases. | Complex predicates fall to use-case config. |
| C | Dataset attrs: `data-bind-count data-where-result="PASS"` | No parser; self-documenting. | Verbose; awkward for compound predicates. |

### D4 — DOM-binding scope (per-card class flip)

This is the trickiest. Smoke walk needs "this card's class reflects the answer to the question this card represents" — a *DOM-scoped* binding.

| Option | Behavior | Pros | Cons |
|---|---|---|---|
| A | `data-bind-class="<input-name-template>:is-opt-{value}\|is-answered\|is-skip-when-skip"` (proposed above) | One declarative line per binding; covers smoke walk + sprint-plan natively. | Mini-template syntax (`{name}`, `{value}`, `is-skip-when-X`). |
| **B ← rec** | Same as A, but use a small fixed template + opinionated class names: container declares `data-bind-result="<input-name>"`; runtime always sets `is-answered` + `is-opt-<value>` + (when value == SKIP) `is-skip` | Simpler primitive. Smoke walk + most worksheets fit perfectly. New use cases that want different class names use inline JS. | Opinionated — non-radio surfaces don't fit. |
| C | No DOM-binding primitive; this stays in use-case inline JS | Smallest primitive surface. | Smoke walk has 10–20 lines of bespoke JS for the class flip. |

### D5 — Composition output format

| Option | Behavior | Pros | Cons |
|---|---|---|---|
| A | Mustache-like template DSL on the action element | Maximally flexible per page. | New mini-language; escaping; edge cases. |
| **B ← rec** | `compose:json` as the only primitive; named text formatters live in a small fallback library at `renderer/components/Page/composeFormatters.ts` (initial set: `smoke-walk-default`). Custom formats stay in use-case config (a tiny JS function the page registers via `window.duoFormatters[name] = (state) => string`). | Primitive stays simple; common formats reusable; one-off formats trivial. | Custom formats need a function — not 100% declarative. |
| C | Built-in formats only: `data-format="smoke-walk-text"` selects from a runtime menu | Common formats are first-class. | Adding a format requires a Duo update — friction for new use cases. |

### D6 — Bulk-set generalization

| Option | Behavior | Pros | Cons |
|---|---|---|---|
| A | `data-name="<exact-name>"` only — bulk-set affects exact-match name (need separate buttons per name) | No glob parser. | Verbose for "mark all results PASS." |
| **B ← rec** | `data-name="<glob>"` — supports `*` suffix only (e.g. `result-*`). Runtime is regex-anchored. | Smoke walk works in one button. | Glob is one new feature. |
| C | `data-name-prefix="<prefix>"` instead of glob | Avoids glob naming. | Non-prefix patterns force exact-name. |

### D7 — Trust gate posture for new verbs

The existing trust gate (`isPagePathTrusted` — actions only fire from paths under `~/.claude/duo/`) protects against arbitrary canvas / browser-pane content firing actions. Question: should the **new** state/composition verbs share that gate, or relax for state-only verbs?

| Option | Behavior | Pros | Cons |
|---|---|---|---|
| A | All new verbs gated identically — only `~/.claude/duo/` paths can use any of them | Consistent trust model. | Worksheets generated to `/tmp/` (the smoke-walk default location) won't fire. |
| **B ← rec** | State + DOM-reactivity verbs are **page-side only** (no host action) and skip the trust gate. `clipboard:copy` is also page-side and skips. **Only `host:send-to-claude` keeps the gate** (it's the only one that hits the host). | Worksheets work anywhere; the actually-dangerous verb (host write) stays gated. | Two different gates for different verb categories. |
| C | Move the smoke-walk output location into `~/.claude/duo/` so the gate applies uniformly | Single-gate model. | Operational change to where smoke walks live. |

This matters for D7 because today's smoke walks output to `/tmp/duo-walks/` — they would NOT pass the existing gate. Either we move them, or we relax for state-only verbs.

---

## What stays in worksheet config (deliberately not generalized)

After D1–D7 are decided and primitives are in place, the worksheet generator (`worksheet/generate.mjs`) still owns:

1. **The smoke-walk-shaped text format** — `[PASS] BUG-001 — Title\n  Notes: line\n` etc. Lives as one `composeFormatters['smoke-walk-default']` entry. Other use cases register their own formatter or use `compose:json`.
2. **Backtick parsing for command detection** — that's worksheet-specific authoring sugar, not a primitive.
3. **Path-link wrapping** — already an existing primitive (`<a class="duo-path-link">`), no change.
4. **Per-step `<pre>` copy buttons** — orthogonal to the playground primitives; lives as a small inline-JS hook today.
5. **Header line templating** (`SMOKE WALK v{version} ({date})`) — JSON-driven manifest field, stays in `generate.mjs`.

## Implementation order (post-sign-off)

Phased so each step lands behind passing characterization tests:

1. **Commit A — ENH-092 part 1: state primitives.** Add `state:save` (auto from `data-state-input`), `state:wipe`, `state:bulk-set` verbs. Wire load-time auto-restore. Test alongside.
2. **Commit B — ENH-092 part 2: DOM reactivity.** Add `data-bind-text` with computed fields + `data-bind-result` (per D4 outcome).
3. **Commit C — ENH-093: composition + clipboard + send.** Add `compose:json`, `compose:text`, `clipboard:copy`, `host:send-to-claude`. Stand up `composeFormatters` library.
4. **Commit D — ENH-043 refactor.** Rewrite `worksheet/generate.mjs` to emit declarative HTML using the new vocabulary. Inline `<script>` reduced to `<10 lines`. The 51 characterization tests pass unchanged.
5. **Commit E — ENH-094: CDP injection for browser-pane pages.** New IIFE parallel to existing patterns. Trust check applies. Validates with a smoke walk hosted in browser pane.

Estimated 1–2 sprints for the full path. Commits A–C are the load-bearing primitive work; D is the validation; E is the distribution.

---

## What I need from you to start

**D1 through D7.** Pick or push back on each. Call out any I should split further or that I'm framing wrong. Once those are decided I'll start Commit A.

I'll also flag any new tradeoffs I run into during implementation rather than guessing.
