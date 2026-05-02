# Active sprint state — v0.6.0 in flight (Stages 27 + 18b + 28)

> **What this file is.** Running scratchpad for the active sprint
> arc. Other doc files (`ROADMAP.md`, `docs/prd/stage-27-canvas-authoring.md`,
> `docs/prd/stage-18b-distro-packs.md`, `docs/prd/stage-28-lesson-packs.md`)
> are the formal record. This file is the "where am I right now" file.
>
> **For future Claude instances:** if you're picking up after a context
> compaction, READ THIS FILE FIRST. It points at the formal plan + says
> exactly what's been done, what's owed, and what bugs / ENHs were filed
> in the most recent walk session.
>
> **Update cadence:** at the end of each commit (mark the row done,
> note any deviations, update "next" pointer).

---

## Current state — last updated 2026-05-02

**Active arc:** v0.6.0 — Stages 27 + 18b + 28 all land together at
the next cut.
**Branch:** `main` (all work on main; no worktree).
**Status:** Three sprints + smoke walk in flight + a dozen filed
bugs / ENHs queued.

### Sprint commit chain

| Sprint | Stage | Commits | Outcome |
|---|---|---|---|
| A | 27 — canvas authoring vocabulary | 6 (`c11d999` → `11d484c`) | Shipped. Smoke-walked V1–V8 + V11–V17 PASS; V9/V10 hit a cross-realm `instanceof` bug that's now fixed (`b28ec13`). |
| B | 18b — distro skill packs (v1 minimums) | 5 (`2646f62` → `78ae208`) | Shipped. CLI walk passed. extra-skills/ merge + UI deferred to Stage 18c. |
| C | 28 — lesson packs (`intro-to-duo` + `claude-code-basics`) | 3 (`f709ddf` → `b73b631`) | Shipped. Sanitized of all Capital One / AIP / Trailblazer references (`c36ed1e`). |

### Post-Sprint follow-ups already committed

| Commit | What |
|---|---|
| `c36ed1e` | Sanitize Capital One / AIP / Trailblazer references across Sprint C content |
| `30e1650` | Split `canvas-authoring.md` → `canvas-authoring.md` + `canvas-interaction.md` (single-responsibility per Anthropic skill best practices). Added WebMCP evaluation note. |
| `705a84f` | ENH-035 (Copy path) + ENH-036 (`duo open` focus) filed; smoke-walk skill updated with "click the named tab" hand-off. |
| `b28ec13` | **fix(stage-27)** cross-realm `instanceof` bug — V9/V10 form-input capture. |
| `322d540` | Bump `package.json` 0.5.5 → 0.6.0 for the active arc. |
| `4bae62e` | **fix(menu) ENH-037** — ⌘W only closes tabs, never the parent window. (Filed AND shipped same commit.) |
| `a46ec23` | docs: BUG-051 + ENH-038/039/040/041/042 filed; "canvas" terminology in CLAUDE.md; smoke-walk skill restart warning |
| `aede644` | **fix(v0.5.5-carryover)** — BUG-006/049/050 + ENH-032 + `shared/feature-flags.ts` + smoke-walk generator `duo-open-in` meta. Folds the v0.5.5 sprint into v0.6.0 cut. |
| `28b6eca` | **fix(stage-17) BUG-051** — read-only canvas toggle now actually reverts. `RenderedCanvas § wire()` explicit `else` branch clears edit-mode body attributes on re-mount under `readOnly: true`. |

## Smoke walk status

**Walk file:** `docs/dev/smoke-walks/v0.6.0-stage-27-rev1.{json,html}`
(JSON manifest + generated HTML page; both gitignored).

**Pre-walk verifications I did (in-session, before user takeover):**

| Item | Result | Note |
|---|---|---|
| 27-V1 | PASS | priming.md tab opened |
| 27-V2 | PASS | faq.html opened in canvas mode |
| 27-V3 | PASS | nav switched + priming.md highlighted |
| 27-V4 | PASS | "Duo" highlighted in editor |
| 27-V5 | PASS | Canvas scrolled to anchor + flash |
| 27-V6 | PASS | Theme dark → system |
| 27-V7 | PASS | Terminal got focus |
| 27-V8 | PASS | smoke-v8 with `{sample:42}` streamed |
| 27-V9 | **FAIL → fix shipped (`b28ec13`); needs re-test** | Cross-realm `instanceof` bug |
| 27-V10 | **FAIL → fix shipped; needs re-test** | Same cross-realm bug |
| 27-V11 | PASS | Read-only strip visible at mount |
| 27-V12 | PASS | Edit toggle flipped to editable |
| 27-V13 | PASS | streaming v13 line landed live |
| 27-V14 | PASS | --since cursor returned all-1 events |
| 27-V15 | PASS | lesson-scaffold renders cleanly |
| 27-V16 | PASS | /tmp/ canvas click no-opped (trust gate held) |
| 27-V17 | PASS | both skill files installed |
| 18B-V1 | PASS | duo packs returns both manifests |
| 18B-V4 | PASS | first-launch-defaults populated installed-packs.json |
| 28-Pack-A | PASS (renders) | welcome.html rendered |
| 28-Pack-B | PASS (renders) | orientation rendered, sanitized |

**User-side walk status — walk-2 (2026-05-02) results pasted back:**
**13 PASS, 4 FAIL, 4 SKIP** (21 total).

| ID | Result | Note |
|---|---|---|
| 27-V1 | PASS | priming.md opens as editable markdown |
| **27-V2** | **FAIL → BUG-052** | faq.html opens in canvas mode, but no toolbar AND no read-only strip |
| **27-V3** | **FAIL → BUG-053** | Navigator opens parent folder, but priming.md is NOT highlighted/selected |
| 27-V4 | PASS | "Duo" highlighted in editor |
| 27-V5 | PASS | Canvas scrolled + flashed |
| 27-V6 | PASS | Theme flips |
| **27-V7** | **FAIL → BUG-054** | Focus visual flips (orange glow) but cursor not active in terminal — needs re-click |
| 27-V8 | PASS | events stream works (note: V8/V13 setup needs auto-spawn — ENH-047) |
| 27-V9 | PASS | text-input value captured (cross-realm fix `b28ec13` confirmed) |
| 27-V10 | PASS | checkbox value captured |
| 27-V11 | PASS | meta duo-default-editable="false" mounts read-only |
| 27-V12 | PASS | Edit / Back-to-read-only toggle works (BUG-051 fix `28b6eca` confirmed) |
| 27-V13 | PASS | events --follow streams within ~50ms |
| 27-V14 | SKIP | "no idea how to follow this instruction" — instructions unclear; ENH-048 to clarify |
| 27-V15 | PASS | templates render with Atelier palette |
| 27-V16 | PASS | trust gate honors ~/.claude/duo/; user noted future ENH on whether path scope is right + suggested a "JS blocked" hint |
| 27-V17 | PASS | Both skill files exist at correct paths (16k + 10k bytes) |
| 18B-V1 | SKIP | (didn't run) |
| 18B-V4 | SKIP | "will perform after sending notes; remind me" — pending |
| 28-Pack-A | PASS (renders) | welcome.html renders + Start lesson spawns; spawn behavior needs gating (ENH-049) |
| 28-Pack-B | SKIP | (didn't run) |

**Plus 4 separate BUG/REGRESSIONs reported during walk (filed in tasks.md):**

| ID | Severity | Title |
|---|---|---|
| **BUG-055** | High (release-blocker) | HTML canvas click should focus working pane (BUG-037 sibling/regression) |
| **BUG-056** | High (recurring; needs regression test) | Send → Duo pill on browser fires without active Claude session |
| **BUG-057** | High (release-blocker) | Pinned working-pane tabs lost across sessions / app upgrades |
| **BUG-058** | 🚨 URGENT (release-blocker) | Browser pane (WCV) STILL occludes tab context menu — BUG-050 partial fix; needs WCV-mute pattern |

**Plus 7 idle-thoughts.md items processed (BUG-059/060/061, ENH-043/044/045) — see tasks.md, idle-thoughts.md.**

## Release-blocker queue for v0.6.0 cut

Blockers that MUST land before the cut, in suggested fix order:

1. **BUG-058** — context menu WCV occlusion. WCV-mute pattern (proven; matches BUG-045/047 lineage).
2. **BUG-056** — Send → Duo pill gating + regression test (owner explicit ask).
3. **BUG-057** — pinned tabs persistence + schema-version + smoke-walk item every release.
4. **BUG-053** — `nav:reveal` selectItem ordering fix (likely await navigateTo).
5. **BUG-052** — `editor:open data-mode='canvas'` toolbar/strip missing.
6. **BUG-054** — `terminal:focus` should call term.focus() on the xterm instance.
7. **BUG-055** — canvas click focus regression.

Process improvements that should land BEFORE the next walk:
- **ENH-046** — code blocks + copy buttons in smoke-walk page (owner explicit; quick win in `generate.mjs`).
- **ENH-047** — auto-spawn `duo events --follow` for V8/V13.
- **ENH-048** — clearer V14 instructions.

Likely outcome: this cut will not happen on a single walk. Plan for a walk-3 after blockers 1-7 land.

## Bugs + ENHs filed during this walk session (2026-05-02)

| ID | Status | Title |
|---|---|---|
| ENH-035 | Filed | Copy path on right-click of working-pane tab |
| ENH-036 | Filed | `duo open <url>` should auto-focus the new tab in the working pane |
| **ENH-037** | **✅ Shipped (`4bae62e`)** | ⌘W only closes tabs — never the parent window |
| ENH-038 | Filed | Smoke-walk page should localStorage-persist textarea contents (in-progress walk-notes survive) |
| ENH-039 | Filed | Smoke-walk page paths should render as clickable links (open in editor / reveal in navigator). Lean toward Option 3: CDP-injected `window.duo.openPath` for trusted file:// pages. |
| ENH-040 | Filed | Collapse-pane button — hide terminal column or canvas (right pane) |
| ENH-041 | Filed | Split the canvas (right pane) into side-by-side panels |
| ENH-042 | Filed | Tab reordering — move a tab left / right |
| **BUG-051** | **✅ Shipped (`28b6eca`)** | Read-only canvas toggle stuck after toggle off → on → off. Root cause: `RenderedCanvas § wire()` only ADDED edit-mode body attributes; never removed them on flip-back. Fix: explicit `else` branch clears `contenteditable` / `spellcheck` / `data-duo-canvas-runtime` and blurs active element. |

**Terminology clarification (folded into CLAUDE.md glossary):** when
the user says **"the canvas"** they mean the right pane (slot),
regardless of which tab kind is rendering inside (markdown editor,
HTML canvas tab, browser tab, image viewer, PDF viewer, future
modalities). The HTML canvas surface (Stage 17) is just one of those
tab kinds — confusingly named. ENHs 040 and 041 use "canvas" in the
slot sense; CLAUDE.md § Glossary documents.

## What's owed before v0.6.0 cut

1. **Finish the user-side smoke walk.** Manifest `v0.6.0-stage-27-rev1.json`
   is in `docs/dev/smoke-walks/`. User clicks Pass/Fail/Skip + notes,
   pastes back, I parse and update statuses. **Re-test V9 + V10
   specifically** — those should now PASS after `b28ec13`. Also
   re-test the read-only toggle on V11/V12 — `28b6eca` should make
   the off → on → off flow behave correctly now.
2. ~~**Fix BUG-051 (read-only stuck)**~~ — ✅ Shipped (`28b6eca`).
3. ~~**v0.5.5 carry-over fixes**~~ — ✅ Committed (`aede644`).
4. **CHANGELOG / RELEASES.md drafting** for v0.6.0 covering Stages
   27 + 18b + 28 + the carry-overs + ENH-037 + BUG-051 + the fix commits.

## Where the formal plan lives

| Document | Purpose |
|---|---|
| `docs/prd/stage-27-canvas-authoring.md` | Sprint A PRD — full commit-by-commit sequence + verification punch list |
| `docs/prd/stage-18b-distro-packs.md` | Sprint B PRD — pack format + first-launch hook |
| `docs/prd/stage-28-lesson-packs.md` | Sprint C PRD — both lesson packs + FTUX surfacing |
| `ROADMAP.md` lines 134-135 + 184-186 | One-line stage entries (Stages 27/28 flipped to ✓ shipped) |
| `docs/roadmap.html#s27`, `#s28` | Stage cards |
| `tasks.md` | All filed bugs + ENHs |
| `CLAUDE.md § Glossary` | "canvas" = right pane (user vocabulary) |

## v0.5.5 carry-over fixes — committed `aede644`, fold into v0.6.0 cut

Now committed; release notes still stashed in
`docs/RELEASES.md § Pending — not yet cut` until folded into the
v0.6.0 cut entry. Includes:
- BUG-006 (Send → Duo pill on browser pane — Path b CDP injection + v2 race fix)
- BUG-049 (trash dialog wording fix)
- BUG-050 (markdown editor tab context menu portal-to-body)
- BUG-047 class-closed
- ENH-032 (terminal locale — FAQ + duo doctor probe)
- BUG-028 (verified live)
- `shared/feature-flags.ts` + `FEATURE_AUTO_INJECT_IDS = false`
- Smoke-walk generator emits `<meta name="duo-open-in" content="browser">`

When drafting the v0.6.0 cut, fold these notes into the cut entry
and clear the `Pending — not yet cut` stash.

## How to resume after compaction

1. Read this file first.
2. Read `tasks.md` § BUG-051, ENH-035, ENH-036, ENH-038, ENH-039,
   ENH-040, ENH-041, ENH-042 (all filed during the most recent
   walk session, all queued for after the v0.6.0 cut).
3. Read `CLAUDE.md § Glossary` so terminology in any of the above
   makes sense ("canvas" = right pane in user vocab).
4. `git status` + `git log --oneline -20` — confirm the commit
   chain matches the table above.
5. **Most likely next action:** continue the user-side smoke walk
   (the manifest at `docs/dev/smoke-walks/v0.6.0-stage-27-rev1.html`
   is still open in Duo's browser pane). User has typed Pass/Fail
   + notes; when they paste the result back, parse and flip
   statuses, fix any failures (especially BUG-051), then propose
   the v0.6.0 cut via the cut-version skill.
