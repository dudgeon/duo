# ENH-229 — Mature OKF rollups (a rollup skill: MD or HTML, with entity links)

> Status: design. Ledger: [tasks.md](../../tasks.md) § ENH-229. Depends on
> ENH-228 (discoverability + the now-shipped Vault Guide). Owner-requested
> 2026-06-22. The planned-template artifact is
> [`docs/research/okf-rollup-maturity-template.html`](../research/okf-rollup-maturity-template.html).

## Problem

ENH-228's live verification proved rollups *work* — but exposed that an **OKF**
vault's native rollup (`duo vault publish`) only groups by `type` and emits flat
bullet listings. The owner's real shape — "tasks grouped by initiative, with
status chips, each row linking to its note" — is only expressible today via the
Obsidian `.base` path, which renders a **non-portable** `out/` HTML artifact. So
OKF users (the default) either hand-maintain a markdown table or drop to a
foreign mechanism. Rollups should be a first-class, GitHub-portable, navigable
surface for OKF vaults.

## Goals

- A **rollup skill that ships with Duo** (rides the ENH-228 install path).
- One spec → **either Markdown or HTML**, user preference.
- HTML **defaults to Atelier**; user can point to another style source.
- Rendered HTML carries **template features**: "copy as markdown" + "refresh".
- **Refresh re-renders** the view (HTML now; MD via link-intercept as fast-follow).
- **Every row links to the entities it rolls up** — the note, plus linked
  frontmatter values (owner → person, group → initiative). A rollup becomes a
  navigation surface into the graph, not a static table.

## Non-goals (v1)

- In-app *live* auto-re-render on file change (file-watcher / scheduled) — stays
  deferred (the existing ENH-216 "Phase 3" note; `duo rollup watch` is the
  manual-but-instant bridge).
- Write-back / actionability (check off a task in the rollup → edit the note).
- Cross-vault aggregate rollups.
- Interactive client-side sort/filter in the rendered HTML (portability first).

## Decisions (D-numbered)

- **D1 — one evaluation, two serializers.** Reuse `core/vault/render.ts` (it
  already evaluates filters / group-by / chips / formulas for the HTML path).
  Add a **Markdown serializer** beside the HTML one: `evaluate(spec) → rows`,
  then `toHtml(rows)` | `toMarkdown(rows)`. Mirrors the locked OKF/Obsidian
  "one graph, two serializers" pattern. No second engine.
- **D2 — packaging.** A `duo rollup` CLI verb family + `skill/references/rollup.md`
  in the duo skill. CLI-is-the-spec; ships via ENH-228's `skill/` install path;
  auto-discoverable now triggers are fixed. (Not a standalone top-level skill.)
- **D3 — default format.** MD by default for OKF vaults (GitHub-portable, matches
  OKF philosophy); `--html` opt-in. Persist the preference:
  `duo rollup format md|html` (machine- or vault-scoped; pref file, §D9-clean).
- **D4 — refresh transport.** Ship **HTML refresh now** with existing primitives:
  the button is `data-duo-action="duo:event"` emitting `rollup:refresh` (payload =
  the rollup spec/id); a small **`duo rollup watch`** subscribes via the existing
  `duo events --follow` bus, re-runs the render, and reloads the tab. No
  babysitting Claude required. **Defer MD refresh** — a `duo://rollup/refresh?…`
  link intercepted by `will-navigate` (browser-manager.ts, the BUG-040 routing
  seam) routed to the same event. That's the only net-new Electron plumbing.
- **D5 — entity links (req #6).** The serializer resolves each row to its source
  note and emits a link: OKF → standard markdown rel link `[Title](./notes/x.md)`
  (→ `<a href>` in HTML); Obsidian → `[[Title]]`. Linked frontmatter values
  (e.g. `owner: "[[Alice Park]]"`, `initiative: q3-launch`) render as links to
  their entity notes; group headers link to the group entity when one exists.
  Clicking a rel-link in Duo opens the note through the existing `duo open`/`edit`
  routing (file-scheme links intercepted in the browser pane). Links never
  fabricate targets — only resolved corpus entities link; unresolved values
  render as plain text.
- **D6 — style source.** `--style atelier|<path|url>`; Atelier is the default.
  CSS is **inlined** into the artifact so it stays a single portable stamped file
  (D13 build-artifact: generated-at · source-hash · as-of). A `<path|url>` style
  source is read at render time and inlined; remote URLs honored only on the CDN
  allowlist / explicit owner intent (no silent network fetch of arbitrary hosts).

## Shape (CLI)

```
duo rollup <spec|.base|note> [--html] [--style atelier|<path|url>] [--out <p>] [--open] [--vault <p>]
duo rollup watch [--vault <p>]          # subscribe to rollup:refresh, re-render + reload
duo rollup format [md|html]             # read/set the default output format
```

`<spec>` accepts the same locked Bases subset the `.base` engine already
validates (filter / group-by / order / chips via `html()`/`icon()` / summaries),
plus the implicit `link` column (D5). `duo base lint` stays the validator.

## Refresh loop (D4) — grounded in shipped primitives

```
HTML:  [Refresh] data-duo-action="duo:event" (rollup:refresh)
         → duo events bus → `duo rollup watch` → re-render → reload tab
MD (fast-follow): [↻](duo://rollup/refresh?base=tasks)
         → will-navigate intercept (browser-manager.ts) → same event
```

A button can't re-render *itself* — it emits intent; the `watch` subscriber (or a
listening Claude) fulfills it near-instantly. Honest framing in the skill: it's
"request refresh," fulfilled by the watcher.

## Staged build plan

1. **This pass:** this PRD + the planned-template artifact (the concrete spec of
   what the skill emits — entity links, copy/refresh, MD↔HTML, style source).
2. Engine MD serializer (`render.ts` + tests): `evaluate → {html, md}`.
3. `duo rollup` / `watch` / `format` verbs (4-surface sync + `build:cli`).
4. The HTML template (buttons wired to `duo:event`; entity links; inlined style).
5. `skill/references/rollup.md` + skill/agent/CLI-COVERAGE sync + `sync:claude`.
6. Fast-follow: MD `duo://rollup/refresh` `will-navigate` intercept.

## Open questions

- Format/style preference scope: machine-global vs per-vault (lean per-vault,
  falling back to global — matches `duo vault default` ergonomics).
- Spec ergonomics: hand-authored Bases YAML vs a higher-level prose→spec helper
  (defer the prose helper; start with the validated `.base` subset).
- MD entity links in a *rendered* HTML artifact: keep the `<a>` pointing at the
  note's rel path so the single HTML file is portable AND navigable in Duo.

## Update 2026-06-22 — owner feedback + grounded design

Two owner corrections + one new feature, plus the code seams confirmed by the
ENH-229 understand pass (workflow `wf_67f87f89-4fb`).

### Correction 1 — two mutually-exclusive variants, NOT a toggle

The prototype rendered one HTML artifact with an MD/HTML *view toggle* — owner:
*"you've built something strange: an html rollup with markdown mode."* Fixed:
`duo rollup render <note> --md | --html` produces **one** file (MD **or** HTML),
chosen at generation. Mutually exclusive, enforced in code (`die` if both or
neither). The template artifact is rebuilt to show the two variants side by
side, not a toggle.

### New feature (req #7) — change summary on regenerate

On regenerate, the standard rollup has an **interactive** Claude write a
**narrative + notables** (prose calling out the changes worth attention since
the last render, positive or negative) and add it to the rollup.

- **Interactive, not headless.** Authored by a real Claude (judgment), never
  `claude -p`. Transport (from the map): the refresh button emits
  `data-duo-action="duo:event"` → `rollup:refresh` on the event bus
  (`core/event-bus.ts`); a `duo rollup watch` loop an interactive Claude runs
  (`duo events --follow`) picks it up.
- **"The user just accepts."** Low-friction — the interactive Claude regenerates
  + summarizes and the artifact reloads; for the MD variant the summary may land
  as a CriticMarkup suggestion (`duo doc insert`) accepted via the existing
  SuggestingBanner. No blocking approval.
- **Optional / disableable.** `duo rollup render --no-summary` (+ a persisted
  per-rollup default) turns it off. Summaries are not required.
- **Placement = both.** Latest summary pinned at the top; a collapsible history
  of prior regenerations below.
- **Diff source is §D9-clean (no sidecar).** The artifact self-embeds a
  machine-readable rows snapshot (HTML comment / MD frontmatter). A regenerate
  reads the prior artifact's snapshot; the CLI computes the deterministic diff
  (added / removed / changed rows + fields); interactive Claude turns it into
  prose. No separate snapshot cache to drift.

### Grounded seams (from the understand pass)

| Concern | Seam |
|---|---|
| MD serializer | new `core/vault/render-markdown.ts`; slot at the `evaluateBaseDef()`→serialize boundary in `renderTarget()` (`render.ts:351`); reuse `readCol` + `SUMMARY_FNS`; `valueToMarkdown()` parallels `cell()` |
| Entity links (req #6) | emit in BOTH serializers at the value layer — `cell()` (HTML `<a>`) and `valueToMarkdown()` (MD `[disp](rel)`); `file.name` col links the note; `Link`-typed frontmatter values link their entity |
| Refresh transport | `duo:event` bus (`rollup:refresh`) → `duo events --follow` subscriber; button injected only on `file://` pages (cdp-bridge PLAYGROUND_RUNTIME_IIFE) — `duo open` opens browser-mode file:// |
| Interactive Claude | event → Claude in a Duo PTY (`DUO_SESSION`/`DUO_TAB`), `duo rollup watch` loop; interactive contract mirrors cron (no `-p`) |
| Accept pattern | MD summary via CriticMarkup `duo doc insert` + SuggestingBanner; HTML summary rendered into the artifact directly |
| Reload | rewrite the same out-path → `useDiskReconciliation` fires → canvas `reloadKey` remount (or `duo reload` for browser pane) |
| CLI plumbing | new top-level `case 'rollup':` with `if (sub === …)` ladders (NOT nested switch — the currency checker counts `case` lines); one VERBS entry; `build:cli` + 4-surface sync |

### CLI shape (revised)

```
duo rollup render <note|spec> (--md | --html) [--style atelier|<path|url>] [--out <p>] [--open] [--no-summary] [--vault <p>]
duo rollup summary <note> --text "<prose>"   embed Claude's narrative into the latest slot + history
duo rollup diff <note> [--vault <p>]         structured prior-vs-new diff (JSON) for Claude to summarize
duo rollup watch [--vault <p>]               subscribe to rollup:refresh, regenerate + (Claude) summarize + reload
duo rollup format [md|html]                  read/set the default variant
```

### Build order (revised)

1. `core/vault/render-markdown.ts` (MD serializer) + entity links in both serializers + tests.
2. Embedded rows-snapshot + `duo rollup diff` (deterministic) + tests.
3. `duo rollup render` (`--md|--html` mutually exclusive, `--style`, `--out`, `--open`, `--no-summary`) + `summary` + `format` + `build:cli`.
4. The HTML template (Atelier, entity links, copy-as-md + refresh `duo:event`, latest+history summary slots).
5. `skill/references/rollup.md` (the watch+summarize loop) + 4-surface sync + `sync:claude`.
6. `duo rollup watch` + fast-follow MD `duo://rollup/refresh` `will-navigate` intercept.
