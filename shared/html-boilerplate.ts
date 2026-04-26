// Stage 17a (PRD H17, minimal v1) — boilerplate for `duo html new <path>`
// and the ⌘N+`.html` commit path. Lives in `shared/` so both the renderer
// (App.tsx commit handler) and the main process (`duo html new` socket
// handler) reference the same skeleton.
//
// The full H17 spec (Tailwind via CDN behind script-opt-in, semantic
// header/main/footer pre-marked locked, Atelier body width cap) is
// 17b/17e scope; v1 keeps the skeleton small so the canvas renders
// cleanly without dragging script-opt-in policy into 17a.

export function htmlBoilerplate(title: string): string {
  const safe = escapeHtml(title)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${safe}</title>
</head>
<body>
  <h1>${safe}</h1>
  <p></p>
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
