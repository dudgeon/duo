# Duo vocabulary — page, playground, lesson, canvas

> **What this is.** The user-facing terminology lock for Duo's
> page / playground / lesson / canvas hierarchy. Both `make-page.md`
> and `make-playground.md` cite this file as canonical. Authored
> 2026-05-02 (v0.6.1 terminology lock); shipped 2026-05-04 (Stage 19e
> ENH-089) as part of the Duo skill so end users following pointers
> from `make-page.md` / `make-playground.md` arrive at a doc they can
> actually read. Modality lock (browser-default for playgrounds,
> canvas-default for editing) added 2026-05-06 (ENH-097).
>
> **For Duo project contributors:** the internal-names column for
> each user-facing term lives in the project's [CLAUDE.md § Glossary](../../../../Documents/GitHub/duo/CLAUDE.md)
> alongside the path-and-component mapping (`WorkingTab.kind === 'page'`,
> `renderer/components/Page/`, etc.). That belongs with the codebase;
> this file is what an agent or end user authoring playgrounds reads.

---

## The hierarchy in one read-through

- **canvas (the slot)** = the right pane of Duo's window, type-agnostic. Whatever tab is open there occupies the canvas slot.
- **canvas (the mode)** = an HTML tab opened in the canvas iframe. **Editable** like a doc; the user can place a cursor and type. **Buttons render but cannot be clicked** — the iframe's sandbox blocks scripts. This is the modality you reach for to **edit** an HTML file's source.
- **page** = a basic HTML tab. Static or lightly-styled. Read-only by default; no actions, no events. Pages typically open in canvas mode for read-and-edit, or in browser mode for long reference docs (FAQ, what-duo-does) that benefit from native browser scroll + paint.
- **playground** = an HTML tab with interactivity. **Defaults to browser mode** — opens in the browser pane, scripts run, buttons fire their `data-duo-action` handlers, form inputs are live, events stream to Claude via `duo events --follow`. The user **interacts** with it (clicks, types into fields, drags) — they do **not** edit its source while it's running.
- **lesson** = a playground paired with an accompanying guide skill (a `.md` Claude reads to drive the user through step-by-step). The most common consumer of playground primitives. Distributed via Stage 18b packs.
- **start tab** = a playground that ships with Duo (or with a fork's distro) auto-opening on first launch. `intro-to-duo` is one; future "configure your Duo" / "tour the FAQ" / "import your settings" playgrounds belong here too.

## The modality lock (the "browser vs canvas" mental model)

A playground HTML file has **two open modes**, and the source file declares the default:

| Mode | Where it renders | What works | What doesn't |
|---|---|---|---|
| **Browser mode** (default for playgrounds) | Browser pane (real Chromium WebContentsView) | Scripts run · buttons fire · form inputs live · events stream · CSS animations work · external links work | The iframe is **not editable** — you can't click into the body and type to edit the source |
| **Canvas mode** (default for pages, override for editing playgrounds) | Canvas iframe (sandboxed `srcdoc` document, no `allow-scripts`) | Body is **editable** (contentEditable) · agent CLI can mutate via `duo html *` verbs · markdown shortcuts on type | Scripts are **inert** · buttons render but click-handlers don't fire (the click places a cursor instead) · `<script>` blocks can't execute |

**Picking a mode for a file:**

- **Playground (interactive)** → declare `<meta name="duo-open-in" content="browser">`. The user opens it via `duo open <path>` or by clicking it in the navigator and **interacts** with the running surface.
- **Page (doc-shape, read-only or editable)** → omit the meta (defaults to canvas) or declare `<meta name="duo-open-in" content="canvas">`. The user reads / edits the source.
- **Long reference doc (read-only, but browser modality preferred)** → declare both `<meta name="duo-open-in" content="browser">` AND `<meta name="duo-editable" content="false">`. FAQ.html and What-Duo-Does follow this pattern.

**Override path — editing a playground's source:** when a user has a playground open in browser mode and wants to edit its HTML source, they open the same file in canvas mode. The buttons appear but are inert (no `allow-scripts`); contentEditable lets them mutate the source. The CLI surface for the override (`duo edit --canvas <path>` and the right-click "Edit in canvas" menu entry) is filed as ENH-097.

**Why the lock matters:** before this clarification, "playground" sometimes meant "page with buttons, opens in canvas, buttons-as-cursor-placement-by-accident" (the canvas-iframe playground action runtime existed but the buttons rendered as if interactive). After the lock, "playground" exclusively means "browser-mode interactive surface." A playground without `<meta name="duo-open-in" content="browser">` is a misconfigured playground, not a degraded one.

## Vocabulary table (user-facing)

| User says | What they mean |
|---|---|
| **the canvas** (no qualifier) | The right pane — the slot that hosts whatever tab is active. Type-agnostic. |
| **a tab** (no qualifier) | A single tab inside the right pane. Any kind: markdown editor, page in canvas mode, browser tab, image viewer, PDF viewer, future modalities. |
| **a page** | A basic HTML tab. Defaults to canvas mode (read-only or editable). No interactivity. |
| **a playground** | An HTML tab with interactivity. Defaults to **browser mode** — scripts run, buttons fire. Editable source via canvas-mode override. |
| **a lesson** | A playground paired with an accompanying guide skill (a `.md` Claude reads to drive the user through). |
| **canvas mode** | An HTML tab rendered in the canvas iframe — editable, scripts blocked, buttons render but can't fire. |
| **browser mode** | An HTML tab rendered in the browser pane — real Chromium WebContentsView, scripts run, buttons fire. |
| **the navigator** / **the tree** / **the file pane** | The left column with the dual-pane file tree. |
| **the terminal** | The middle column with the Claude terminal sessions. |
| **a terminal tab** | One of the Claude / shell sessions in the middle column. |

## The page / playground distinction is content-level, not kind-level

The internal `WorkingTab.kind === 'page'` covers HTML tabs that open in canvas mode — both static pages and (when the override is used) playground-source-being-edited. The internal `WorkingTab.kind === 'browser'` covers HTML tabs that open in browser mode. A "playground" the user sees is a `kind: 'browser'` tab whose URL points at a `file://` HTML file with `duo-open-in: browser` meta.

## When to reach for which

- **Page (canvas mode, default)** — when the artifact is mostly read-only or read-and-edit content. A doc, a static reference card, a snippet of inline data the user will glance at or copy from. The canvas iframe gives them edit affordances if they want them.
- **Playground (browser mode, default)** — when the user will click buttons, fill forms, expect things to happen in Duo (open a file, focus the terminal, send selected text to Claude). The browser pane is the only modality where this works correctly. Default for "agent-emitted dashboards," "interactive references," "smoke walks," "smoke-walk-style worksheets," "config wizards."
- **Lesson** — when there's a teaching arc with steps, progress, and a Claude session that knows the user is mid-lesson. The lesson skill encodes the arc; the playground encodes the surface. Same browser-mode default as plain playgrounds.
- **Start tab** — a playground that ships with Duo (or with a fork's distro), auto-opening on first launch.

## Cross-references

- **Build a page:** `~/.claude/skills/duo/make-page.md`
- **Build a playground:** `~/.claude/skills/duo/make-playground.md`
- **Build a lesson (canonical template):** `~/.claude/skills/duo/examples/lesson-template/`
- **Drive an existing playground (author → driver):** `~/.claude/skills/duo/playground-interaction.md`
- **Lesson runtime contract:** `~/.claude/skills/duo/lesson-runtime.md`
