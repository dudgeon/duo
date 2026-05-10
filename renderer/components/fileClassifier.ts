// Helper split out of WorkingPane so Fast Refresh stays clean (React components
// and plain utility exports can't live in the same module).

import type { WorkingTabType } from '@shared/types'

export function classifyFile(path: string): {
  type: Exclude<WorkingTabType, 'browser'>
  mime: string
} {
  const ext = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : ''
  switch (ext) {
    case 'md': case 'markdown':
      // Stage 11: markdown gets the rich editor by default. The read-only
      // preview renderer (`markdown-preview`) is retained as a fallback but
      // no longer the default entry point.
      return { type: 'editor', mime: 'text/markdown' }
    case 'html': case 'htm':
      // Stage 17a — .html opens in the rendered canvas instead of the
      // unknown-file preview. Routes the same way for `duo edit`, `duo
      // view`, FileTree clicks, and the new-file commit's extension dispatch.
      return { type: 'page', mime: 'text/html' }
    case 'png':
      return { type: 'image', mime: 'image/png' }
    case 'jpg': case 'jpeg':
      return { type: 'image', mime: 'image/jpeg' }
    case 'gif':
      return { type: 'image', mime: 'image/gif' }
    case 'webp':
      return { type: 'image', mime: 'image/webp' }
    case 'svg':
      return { type: 'image', mime: 'image/svg+xml' }
    case 'pdf':
      return { type: 'pdf', mime: 'application/pdf' }
    case 'json': case 'jsonl': case 'har': case 'webmanifest':
      // ENH-110 — JSON-family files open in the JsonView tab kind
      // (Tier 3 collapsible tree + raw-text toggle). `.har` is HTTP
      // archive, `.webmanifest` is web app manifest — both JSON.
      return { type: 'json', mime: 'application/json' }
    case 'yml': case 'yaml':
      // ENH-110 — YAML cohabits the same tab kind. JsonView reads the
      // path extension to pick parser/serializer. Owner pick (decision
      // gate 2026-05-10): single tab kind with format discriminator.
      return { type: 'json', mime: 'application/yaml' }
    default:
      return { type: 'unknown', mime: 'application/octet-stream' }
  }
}
