```
@agent -- this is a file for idle thoughts; a scratchpad you can see and edit; as you 'process' (decide best action, recommend, execute given permission) a given thought (top-level bullet), please move it down to the 'processed' section of the doc and include a note about what action you took (e.g. added to roadmap as new item, merged with existing bug, etc)
```

# Unprocessed

# Processed

- ~~please add this task for the next sprint: the entire user smoke walk prep skill (I forget its actual name) should be buildable with canvas / template primitives; identify which additional primitives we would need to make to enable this, or which we can edit~~
  - **Action 2026-05-02:** Filed as **ENH-043** in tasks.md ("The smoke-walk skill should be re-buildable via canvas / template primitives"). Includes a 3-step plan (identify missing primitives → add canvas-templates entries → refactor `generate.mjs` to use them). Cross-ref to ENH-046 since the code-block + copy-button primitive is a sub-component this needs.

- ~~'new claude terminal' button needs new icon, e.g. /Users/geoffreydudgeon/Desktop/clawd.svg~~
  - **Action 2026-05-02:** Filed as **ENH-044** in tasks.md ("New-claude-terminal button needs a custom icon — `clawd.svg` available"). Action plan: move the SVG into `renderer/assets/icons/`, swap into the `+` button, sanity-check light + dark theme contrast.

- ~~there should never be multiple tabs open for the same local file (same not true for websites)~~
  - **Action 2026-05-02:** Filed as **BUG-059** in tasks.md ("Multiple working-pane tabs can open for the same local file path"). Suggested fix: in `openFileSmart` (or `duo edit` route handler), scan tabs[] for an existing match BEFORE creating a new tab; if found, activate it. Carve-out: browser tabs (kind='browser') stay duplicate-allowed since multiple-browser-tabs-for-same-URL is a legitimate browser pattern.

- ~~bug/missing feature: md editor does not parse \`\`\`code\`\`\` as code block; it should AUQ if ambiguous how to handle~~
  - **Action 2026-05-02:** Filed as **BUG-060** in tasks.md ("Markdown editor does not parse fenced code blocks"). Likely TipTap CodeBlockLowlight extension config issue. Cross-ref to BUG-061 (the sibling parsing-gap bug in HTML canvas).

- ~~bug/missing feature: markdown parsing appears broken in html canvas (e.g. does not recognize/parse '-' or '\*' as bullets; no mechanism to indent/outdent bullets -- this should be identical to the bullet handling in markdown editor; have we failed to merge the components between md vs html canvases?~~
  - **Action 2026-05-02:** Filed as **BUG-061** in tasks.md ("Markdown parsing broken in HTML canvas — bullets, indent / outdent missing"). Includes the architecture question this surfaces (are MarkdownEditor and HtmlCanvas drifting? Should they unify?) and a recommended path: extend `markdownShortcuts.ts` with bullet input rules + Tab/Shift-Tab indent for parity. Decision on full unification (TipTap inside the canvas iframe) deferred to an ADR before any bigger refactor. Note: PRD-H1 says "the canvas IS the page" which argues against wrapping it in a TipTap shell.

- ~~bug/missing feature: I can't see the read only/edit control for html canvas; I thought this shipped already? or is that for browsers and not local file html canvas?~~
  - **Action 2026-05-02 (no new task filed; clarification only):** The Read-only / Edit strip toggle (Stage 27 ENH-034 lineage) is HTML-canvas-only — browsers have no editable concept so they don't get it. **It IS shipped** and walk-2 V11 + V12 PASSed (visible on `~/.claude/duo/stage-27-walk.html` which has `<meta duo-default-editable="false">`). The strip only appears when the canvas HAS that meta tag AND is in read-only mode; canvases without the tag mount in edit mode and show the FULL editor toolbar (Heading / B / I / etc.) instead. **However:** walk-2 BUG-052 reported that opening faq.html via `editor:open` with `data-mode="canvas"` shows NEITHER toolbar NOR strip — that's a regression and is filed separately. Your "I can't see the toggle" question may have been observing a canvas that mounts in edit mode (correct) OR may have been triggered by BUG-052 (incorrect). If you hit it again on a canvas that's not faq.html / data-mode='canvas', flag the path and I'll dig in.

- ~~in navigator, "Project Claude Context" should be collapsible, and default to collapsed [+ multi-bullet feature set]~~
  - **Action 2026-05-02:** Filed as **ENH-045** in tasks.md ("Navigator — 'Project Claude Context' improvements"). Includes ALL 9 sub-bullets you listed (collapsible, dynamic naming, .claude/ + git auto-detect, gh status, easy gh actions, promote-to-project, sync-to-github, project-asset-creation skill, enterprise project templates) and a recommended carve-up into ENH-045a/b/c/d so each piece can be sequenced independently. ENH-045a (collapsible + naming + auto-detect) is the cheap v1; the gh-integration items depend on Stage 21d's socket-auth + agent-driven-nav-notifications work which is still ⬜.
