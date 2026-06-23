# Duo vocabulary — page, playground, lesson, canvas

> **What this is.** The user-facing terminology lock for Duo's
> page / playground / lesson / canvas hierarchy. Both `make-page.md`
> and `make-playground.md` cite this file as canonical. Modality is
> **verb-driven**: the `<meta name="duo-open-in">` declaration is no
> longer consulted; `duo open` → browser, `duo edit` → canvas.
>
> **For Duo project contributors:** the internal-names column for
> each user-facing term lives in the project's `CLAUDE.md` § Glossary
> alongside the path-and-component mapping (`WorkingTab.kind === 'page'`,
> `renderer/components/Page/`, etc.). That belongs with the codebase;
> this file is what an agent or end user authoring playgrounds reads.

---

## The hierarchy in one read-through

- **canvas (the slot)** = the right pane of Duo's window, type-agnostic. Whatever tab is open there occupies the canvas slot.
- **canvas (the mode)** = an HTML tab opened in the canvas iframe. **Editable** like a doc; the user can place a cursor and type. **Buttons render but cannot be clicked** — the iframe's sandbox blocks scripts. This is the modality you reach for to **edit** an HTML file's source. Open via `duo edit <path>`.
- **page** = an HTML file opened in canvas mode for reading or editing. No interactivity (scripts blocked). Open via `duo edit <path>`.
- **playground** = an HTML file opened in browser mode — scripts run, buttons fire their `data-duo-action` handlers, form inputs are live, events stream to Claude via `duo events --follow`. The user **interacts** with the running surface. Open via `duo open <path>`.
- **lesson** = a playground paired with an accompanying guide skill (a `.md` Claude reads to drive the user through step-by-step). The most common consumer of playground primitives. Distributed via lesson packs.
- **start tab** = a playground that ships with Duo (or with a fork's distro) auto-opening on first launch. `intro-to-duo` is one; future "configure your Duo" / "tour the FAQ" / "import your settings" playgrounds belong here too.

## The modality split — verb decides surface

The same HTML source file flips between two surfaces depending on which verb opens it:

| Mode | Verb | Where it renders | What works | What doesn't |
|---|---|---|---|---|
| **Browser mode** | `duo open <path>` | Browser pane (real Chromium WebContentsView) | Scripts run · buttons fire · form inputs live · events stream · CSS animations work · external links work | The iframe is **not editable** — you can't click into the body and type to edit the source |
| **Canvas mode** | `duo edit <path>` | Canvas iframe (sandboxed `srcdoc` document, no `allow-scripts`) | Body is **editable** (contentEditable) · agent CLI can mutate via the `duo html` verbs · markdown shortcuts on type | Scripts are **inert** · buttons render but click-handlers don't fire (the click places a cursor instead) · `<script>` blocks can't execute |

**The verb is the signal:**

- **"Show me the running thing"** → `duo open <path>` → browser mode. Use this for explainer artifacts, playgrounds, interactive references, smoke walks, dashboards.
- **"Let me modify the source"** → `duo edit <path>` → canvas mode. Use this when the user wants to read-and-edit the HTML directly.

**Overrides (rare):**

- `duo open --canvas <path>` → force canvas mode for a file you'd normally open in browser. Useful when you want to inspect a playground's HTML source without firing its scripts.
- `duo edit --browser <path>` → force browser mode via the edit verb. Symmetric override.
- UI: right-click a `file://` browser tab → "Edit in canvas" (equivalent to `duo edit`).

**No meta declaration needed.** Files used to declare their preferred surface via `<meta name="duo-open-in" content="browser">`. That declaration is now ignored — the verb decides. Existing meta declarations on user files are harmless under the new default (HTML already lands in browser via `duo open`).

**`<meta name="duo-editable" content="false">` is still honored** for the canvas-mode case — opens canvas tabs read-only.

## Vocabulary table (user-facing)

| User says | What they mean |
|---|---|
| **the canvas** (no qualifier) | The right pane — the slot that hosts whatever tab is active. Type-agnostic. |
| **a tab** (no qualifier) | A single tab inside the right pane. Any kind: markdown editor, page in canvas mode, browser tab, image viewer, PDF viewer, future modalities. |
| **a page** | An HTML file opened via `duo edit` — canvas mode, source-editable, scripts blocked. No interactivity by design. |
| **a playground** | An HTML file opened via `duo open` — browser mode, scripts run, buttons fire. Source-editable via `duo edit` (canvas-mode override). |
| **a lesson** | A playground paired with an accompanying guide skill (a `.md` Claude reads to drive the user through). |
| **canvas mode** | An HTML tab rendered in the canvas iframe — editable, scripts blocked, buttons render but can't fire. |
| **browser mode** | An HTML tab rendered in the browser pane — real Chromium WebContentsView, scripts run, buttons fire. |
| **the navigator** / **the tree** / **the file pane** | The left column with the dual-pane file tree. |
| **the terminal** | The middle column with the Claude terminal sessions. |
| **a terminal tab** | One of the Claude / shell sessions in the middle column. |
| **Home** | The permanent re-entry surface — slot 0 in every window, non-closable. Answers "where was I?" across inactive Claude projects: a greeting line, two project hero panels (recent sessions, open-pills, recent-file chips), and a spine stack of the rest. Read live every time, never persisted. Reached via `duo home`; click a session to focus its live tab or resume it. |

## The page / playground distinction is verb-level

The same HTML source can be both a page AND a playground — it depends on which verb opens it. `duo open foo.html` shows the playground (browser pane, interactive). `duo edit foo.html` shows the page (canvas iframe, editable source). Under the hood: `WorkingTab.kind === 'browser'` covers HTML tabs opened in browser mode; `WorkingTab.kind === 'page'` covers HTML tabs opened in canvas mode. The terms "page" and "playground" describe the **modality**, not the file.

## When to reach for which

- **Open a playground (`duo open <path>`)** — when the user will click buttons, fill forms, expect things to happen in Duo (open a file, focus the terminal, send selected text to Claude). The browser pane is the only modality where this works correctly. Default for "agent-emitted dashboards," "interactive references," "smoke walks," "smoke-walk-style worksheets," "config wizards," "explainer artifacts the user will look at."
- **Edit as a page (`duo edit <path>`)** — when the user (or agent) wants to read and modify the HTML source itself. The canvas iframe gives them editable text + agent CLI mutations via `duo html *` verbs.
- **Lesson** — when there's a teaching arc with steps, progress, and a Claude session that knows the user is mid-lesson. The lesson skill encodes the arc; the playground encodes the surface. Open via `duo open`.
- **Start tab** — a playground that ships with Duo (or with a fork's distro), auto-opening on first launch.

## Cross-references

- **Build a page:** `~/.claude/skills/duo/make-page.md`
- **Build a playground:** `~/.claude/skills/duo/make-playground.md`
- **Build a lesson (canonical template):** `~/.claude/skills/duo/examples/lesson-template/`
- **Drive an existing playground (author → driver):** `~/.claude/skills/duo/playground-interaction.md`
- **Lesson runtime contract:** `~/.claude/skills/duo/lesson-runtime.md`

---

## Vault (ENH-208) — work-notes vocabulary

A separate domain from the page/playground hierarchy above. The user-facing
name for the whole feature is **vault** — there is no "graphbook" noun
anywhere user-facing (D17).

| Term | Meaning |
|---|---|
| **vault** | A folder containing `.obsidian/` — a strict Obsidian vault: markdown + `[[wikilinks]]` + YAML frontmatter + folders + `.base` files. The same folder always opens correctly in Obsidian proper. |
| **entity** | A note representing a thing (person, initiative, theme, milestone, meeting), typed by its folder + frontmatter `type:`. |
| **type / template** | A `templates/<type>.md` soft schema: declares the type, its filing rule, and the fields an entity expects. Query-excluded (not an entity). |
| **corpus** | The vault-derived schema — types, entities, aliases, properties-per-type, observed enum values. A pure function over frontmatter ("the vault IS the schema"), computed live, never cached. Read via `duo vault schema`. |
| **rollup / base** | An Obsidian Bases `.base` file (or embedded ` ```base ` block) — a view over frontmatter. A per-entity rollup uses `… == this`. Rendered to Duo-owned HTML via `duo base render`. |
| **capture** | An atomic note dropped in `inbox/` (`duo vault capture`), untyped by default — processing files it later. |
| **processing** | The agent pass: file inbox notes, link entities, fix frontmatter, author rollups, propose archiving — via CriticMarkup suggestions + a dated report note. Always proposes, never acts silently. |

**Build / operate a vault:** `~/.claude/skills/duo/references/vault.md` ·
**end-user walkthrough:** `~/.claude/skills/duo/references/vault-guide.html`
(`duo open` it).
