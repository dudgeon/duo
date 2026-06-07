# Atelier CSS kernel for Duo playgrounds

## Contents

- [Why a kernel exists](#why-a-kernel-exists)
- [How to use it](#how-to-use-it)
- [Class library (what's already in the kernel)](#class-library-whats-already-in-the-kernel)
- [Project color system (categorical palette)](#project-color-system-categorical-palette)
- [Patterns NOT in the kernel](#patterns-not-in-the-kernel)
- [Decisions-payload convention](#decisions-payload-convention)
- [Minimal playground skeleton](#minimal-playground-skeleton)
- [When the kernel needs to grow](#when-the-kernel-needs-to-grow)

The canonical stylesheet for Duo HTML playgrounds (research docs,
planning artifacts, decision worksheets) lives at:

```
~/.claude/skills/duo/references/duo-atelier.css
```

Inline it into the `<style>` block of every new playground. Per-
playground overrides go AFTER the kernel, in the same `<style>` block.

## Why a kernel exists

Before this kernel, each playground re-authored ~150–600 lines of CSS
from scratch — same cream paper, same orange accent, same serif
headings, same `.q-option` radio pattern. The repeated CSS authoring
was a token tax on every playground generation.

By inlining the kernel verbatim, you skip ~200 lines of authoring per
playground and gain visual consistency across the body of work for free.

## How to use it

1. Open `~/.claude/skills/duo/references/duo-atelier.css` and copy the
   full contents into a `<style>` tag in the playground's `<head>`.
2. Add per-playground styles AFTER the kernel — only the bits the
   kernel doesn't cover (e.g. inventory tables, recipe cards, timeline
   diagrams).
3. Use the class library below for owner-decision blocks, intro
   callouts, Copy-decisions footers, etc.

## Class library (what's already in the kernel)

| Pattern | Class(es) | Use for |
|---|---|---|
| Page banner | `header.page-head` + `header.page-head h1` + `.meta` + `.meta .pill` | Top-of-page title + pill tags (status, sprint, etc.) |
| Intro callout | `.intro` | Leading "what this is" block. Wraps `<strong>` automatically. |
| Headings | `h2`, `h3`, `h4` | Section / subsection / sub-subsection. `h2` carries a rule below. |
| Prose | `p`, `ul`, `ol`, `li`, `code`, `pre` | Default body. `code` is inline; `pre` is dark code-bg block. |
| Decision block | `.decision-card` with children `.q-title`, `.q-prompt`, `.q-context` | Owner-decision wrapper. Title is the small ALL-CAPS accent label; prompt is the italic-serif question; context is the rationale. |
| Radio list | `.q-options` (grid) + `.q-option` (label) + `.q-option-body` + `.q-option-title` + `.q-option-rationale` | One radio per option. `:has(input:checked)` highlights the selected option. |
| Recommended tag | `.q-option-title .recommend-tag` | The accent-pill "RECOMMENDED" badge. |
| Free-form notes | `.q-notes` | Textarea below the radios for free-form owner notes. |
| Collapsed extras | `details.deferred` + `details.deferred summary` + `details.deferred .deferred-body` | "Click to expand" block for reasoning that should be present but not shown by default. |
| Copy footer | `.copy-bar` + `.copy-bar .copy-meta` + `.copy-bar #answered-count` + `.copy-bar button` (+ `.copied` modifier) | Sticky bottom bar with answered-count + Copy-decisions button. |

## Project color system (categorical palette)

The kernel's `:root` carries a categorical palette for **project-coded UI** —
the project filter rail, per-tab and per-navigator project dots, and
focus chips. It complements Atelier's sequential paper/ink ramp + the single
`--accent` with six distinguishable-but-harmonious project hues.

| Token | Hex | Hue | Name |
|---|---|---|---|
| `--project-pine` | `#2E7D74` | 173° | Pine (teal-green) |
| `--project-harbor` | `#3C6E93` | 206° | Harbor (slate blue) |
| `--project-iris` | `#5B57A6` | 243° | Iris (indigo) |
| `--project-plum` | `#87508F` | 291° | Plum (violet) |
| `--project-rose` | `#A4506A` | 345° | Rose (dusty rose) |
| `--project-moss` | `#69763A` | 75° | Moss (olive) |

**Rules (why these six):**

- **The orange/amber band (~15–55°) is reserved.** `--accent` (`#c46a1c`)
  already means "active / primary action." No project is ever assigned an
  orange/amber hue, or a project tile would read as the accent and fight the
  app's color language.
- **Muted + consistent.** Moderate chroma, mid lightness — the six sit as one
  calm family on cream rather than confetti. White text on each clears
  large-text AA (≥ 4.3:1).
- **Color is reinforcement, never the only signal.** Project initials carry
  identity (for color-blind users + the closest pairs, Pine/Harbor &
  Iris/Plum); color reinforces.

**Assignment.** Hash-stable per project root — `hash(projectRoot) % 6` — so the
same folder gets the same hue across sessions and machines, with manual
override. Past six projects, rotate ~12% darker **shade variants** of the same
hues before adding new ones (6 hues × 2 shades = 12).

**Usage.**

- **Rail tiles** — locked treatment is **"quiet bloom"**:
  unfocused tiles are paper with the project hue as colored initials + a thin
  underline; the *focused* project blooms to a full hue fill with white initials
  + a white left "notch." Selection elsewhere still uses `--accent`.
- **Project dots** (tab chips, navigator rows) — a 6–8px square in the project
  hue.
- **Focus chips / soft fills** — use the hue at a tint over paper:
  `color-mix(in srgb, var(--project-X) 22%, var(--paper))` (≈ the middle tint;
  10% / 22% / 40% are the standard steps).

## Patterns NOT in the kernel

Author these inline AFTER the kernel block:

- **Inventory tables** — a `table.ops` pattern.
- **Recipe cards** — a `.recipe-card` pattern.
- **Comparison cards** — `.option-card` + `.recommended`.
- **Pipeline diagrams** — a `.pipeline` pattern.
- **Confirm callouts** — a `.confirm-card` pattern.
- **ASCII diagrams in `<pre>`** — use the kernel's `pre` styling; add a
  `.diagram` class if you need lighter line-height.

If the same pattern appears in 2+ playgrounds, propose adding it to
the kernel (edit `~/.claude/skills/duo/references/duo-atelier.css` +
this doc + commit).

## Decisions-payload convention

The `.copy-bar` button's click handler should assemble a structured
payload from all answered decision cards:

```
[OPTION-VALUE-1] Q-title-1
    free-form notes if any...

[OPTION-VALUE-2] Q-title-2
    ...
```

Then write to clipboard via `navigator.clipboard.writeText(...)`. The
button gets `.copied` class for ~2s visual feedback. Owner pastes the
payload back to Claude.

## Minimal playground skeleton

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="duo-editable" content="false">
<title>[Playground title]</title>
<style>
  /* PASTE THE FULL CONTENTS OF
     ~/.claude/skills/duo/references/duo-atelier.css HERE */

  /* Per-playground overrides below */
</style>
</head>
<body>

<header class="page-head">
  <h1>[Playground title]</h1>
  <div class="meta">
    <span class="pill">[STATUS]</span>
    [date / context]
  </div>
</header>

<div class="intro">
  <strong>What this is.</strong> [1–2 sentences on the playground's purpose.]
</div>

<h2>Context</h2>
<p>[Background.]</p>

<section class="decision-card">
  <div class="q-title">DECISION 1</div>
  <h3 class="q-prompt">[The question to decide]</h3>
  <p class="q-context">[Why it matters / what's at stake.]</p>
  <div class="q-options">
    <label class="q-option">
      <input type="radio" name="d1" value="option-a">
      <div class="q-option-body">
        <div class="q-option-title">Option A <span class="recommend-tag">Recommended</span></div>
        <div class="q-option-rationale">[Why this is the recommended pick.]</div>
      </div>
    </label>
    <label class="q-option">
      <input type="radio" name="d1" value="option-b">
      <div class="q-option-body">
        <div class="q-option-title">Option B</div>
        <div class="q-option-rationale">[Trade-off.]</div>
      </div>
    </label>
  </div>
  <textarea class="q-notes" data-decision="d1" placeholder="Notes (optional)..."></textarea>
</section>

<!-- repeat .decision-card blocks per decision -->

<div class="copy-bar">
  <div class="copy-meta"><span id="answered-count">0</span> / [N] decisions answered</div>
  <button id="copy-btn" type="button">Copy decisions</button>
</div>

<script>
  // [Decisions-payload assembler + Copy button click handler]
</script>

</body>
</html>
```

## When the kernel needs to grow

If you're about to add a CSS pattern that's likely to recur:

1. Add it to `~/.claude/skills/duo/references/duo-atelier.css` in the
   relevant section.
2. Add the class(es) to the table in this doc.
3. Commit both changes alongside the playground that motivates the
   addition.
4. `npm run sync:claude` to push to the installed copy.

The kernel is allowed to grow; let it. The bar is "recurring across
2+ playgrounds." Single-use patterns stay inline.
