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
      return { type: 'markdown-preview', mime: 'text/markdown' }
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
    default:
      return { type: 'unknown', mime: 'application/octet-stream' }
  }
}
