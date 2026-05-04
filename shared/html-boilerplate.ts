// Boilerplate for `duo html new <path>` and the ⌘N + `.html` commit
// path. Lives in `shared/` so both the renderer (App.tsx commit
// handler) and the main process (`duo html new` socket handler)
// reference the same skeleton.
//
// Stage 17a v1 shipped a 12-line minimal skeleton. v0.3.1 (ENH-001 +
// ENH-004) upgrades the default to:
//
//   - inject `data-duo-id="<ulid>"` at write time on body / h1 / p,
//     so first-open ID-injection prompt is unnecessary for Duo-
//     authored canvases (closes ENH-001 by construction; the prompt
//     remains for hand-authored / downloaded HTML the user opens
//     later)
//   - add a small inline CSS block with Atelier-ish defaults (cream
//     paper, ink-soft body, serif headings, accent ochre, body
//     width cap, dark-mode media query) so the canvas reads well
//     immediately. The styles are intentionally local + editable —
//     the user can delete or rewrite them at will. They're a
//     starting hint, not a contract.
//   - add `<meta name="viewport">` for sane defaults if a canvas
//     gets shared as a real web page later
//   - add a small HTML comment explaining what the file is so an
//     agent reading via `duo html get` sees the provenance
//
// The full Stage 17 PRD H17 (Tailwind via CDN behind script-opt-in,
// semantic header/main/footer pre-marked locked, Atelier body width
// cap formalized) is still 17b/17e scope; this is the smaller
// "useful defaults out of the box" middle ground.
//
// "No Duo chrome leaks" still applies: nothing the user-authored
// CSS produces here is runtime-only chrome (`data-duo-canvas-runtime`,
// `duo-just-added`, etc.). These styles live in the saved file.

import { newULID } from './ulid'

export function htmlBoilerplate(title: string): string {
  const safe = escapeHtml(title)
  const bodyId = newULID()
  const h1Id = newULID()
  const pId = newULID()
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safe}</title>
<!-- Duo canvas. Editable HTML; saved to disk verbatim. Stable
     data-duo-id attributes anchor agent edits + comment threads
     across sessions. Edit / extend the styles below freely. -->
<style>
  :root {
    --paper: #FBF8EE;
    --paper-deep: #F0E9D6;
    --ink: #1A1410;
    --ink-soft: #3D352A;
    --ink-mute: #7B6F58;
    --accent: #C66A2E;
    --accent-soft: #F2D9B8;
    --accent-ink: #7A3E1A;
    --serif: ui-serif, "New York", "Iowan Old Style", Charter, Georgia, serif;
    --sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper: #1A1611;
      --paper-deep: #13100C;
      --ink: #F0E9D6;
      --ink-soft: #C8BD9E;
      --ink-mute: #8A7E66;
      --accent: #E08F4A;
      --accent-soft: #3F2A18;
      --accent-ink: #F2D2A8;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  /* BUG-023 fix — body fills the viewport so clicks ANYWHERE in
     the iframe land on contentEditable body (and the browser
     places the cursor at the nearest text node). Pre-fix, body's
     max-width centered the column with empty whitespace flanking
     it; clicks in that whitespace landed on <html> and didn't
     place a cursor. The content column lives in <main> below. */
  html { background: var(--paper); }
  body {
    background: var(--paper);
    color: var(--ink);
    font-family: var(--sans);
    line-height: 1.6;
    min-height: 100vh;
    margin: 0;
    padding: 0;
  }
  main {
    max-width: 720px;
    margin: 0 auto;
    padding: 48px 24px 96px;
  }
  h1, h2, h3 {
    font-family: var(--serif);
    font-weight: 500;
    letter-spacing: -0.01em;
    color: var(--ink);
  }
  h1 { font-size: 32px; margin: 0 0 12px; }
  h2 { font-size: 22px; margin: 32px 0 8px; color: var(--accent-ink); }
  h3 { font-size: 18px; margin: 24px 0 6px; }
  p  { margin: 0 0 14px; color: var(--ink-soft); }
  a  { color: var(--accent); }
  strong, b { color: var(--ink); }
  code {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.92em;
    background: var(--paper-deep);
    padding: 1px 5px;
    border-radius: 3px;
  }
  blockquote {
    border-left: 3px solid var(--accent);
    margin: 16px 0;
    padding: 4px 0 4px 18px;
    color: var(--ink-mute);
  }
  /* BUG-073 — marker-aware bullet styling. The markdown trigger
     stamps data-list-marker="dash" / "plus" / "asterisk" on <ul>
     based on the typed character; CSS3 list-style-type accepts a
     string literal which Chromium + WebKit have shipped for years.
     The asterisk marker falls through to default disc (no rule),
     matching Markdown's most-conventional rendering. */
  ul[data-list-marker="dash"] { list-style-type: '\\2013\\00a0\\00a0'; }
  ul[data-list-marker="plus"] { list-style-type: '+\\00a0\\00a0'; }
  hr { border: none; border-top: 1px solid var(--paper-deep); margin: 32px 0; }
</style>
</head>
<body data-duo-id="${bodyId}">
<main>
<h1 data-duo-id="${h1Id}">${safe}</h1>
<p data-duo-id="${pId}"></p>
</main>
</body>
</html>
`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
