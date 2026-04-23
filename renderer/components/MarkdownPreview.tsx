// Stage 10 Phase 5 — read-only markdown preview for .md files in a
// working-pane tab. Stage 11 replaces this with the full editor; v1 renders
// with react-markdown + remark-gfm for tables / task-lists / strikethrough.
//
// Stage 10 § D28: inline images render (paths resolve relative to the file);
// links are clickable (internal `.md` links open as new preview tabs;
// external URLs open in a new browser tab via `duo.open`).

import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'

interface MarkdownPreviewProps {
  path: string
  /** Called when the user clicks a link to another `.md` file, so the caller
   *  can open it in a sibling preview tab. */
  onOpenMarkdown: (path: string) => void
}

export function MarkdownPreview({ path, onOpenMarkdown }: MarkdownPreviewProps) {
  const [md, setMd] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    setMd(null)
    window.electron.files.read(path).then(
      res => {
        if (cancelled) return
        setMd(new TextDecoder('utf-8').decode(res.bytes))
      },
      err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      }
    )
    return () => { cancelled = true }
  }, [path])

  if (error) {
    return <ErrorCard message={error} />
  }
  if (md === null) {
    return <div className="p-8 text-sm text-zinc-500">Loading…</div>
  }

  return (
    <div className="flex-1 overflow-auto bg-surface-0">
      <article className="mx-auto max-w-[760px] px-10 py-10 text-zinc-200 leading-relaxed prose prose-invert prose-zinc">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={{
            a: ({ href, children, ...rest }) => {
              const h = typeof href === 'string' ? href : undefined
              const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
                if (!h) return
                e.preventDefault()
                const external = /^[a-z][a-z0-9+.-]*:/i.test(h) && !h.startsWith('file:')
                if (external) {
                  // Open external URLs in a new browser tab
                  void window.electron.browser.addTab(h)
                } else if (h.endsWith('.md') || h.endsWith('.markdown')) {
                  // Internal .md link → resolve relative to the current file's dir
                  const base = path.slice(0, path.lastIndexOf('/'))
                  const resolved = h.startsWith('/') ? h : base + '/' + h
                  onOpenMarkdown(resolved)
                } else {
                  // Fall back to browser tab for other schemes
                  void window.electron.browser.addTab(`file://${encodeURI(h)}`)
                }
              }
              return <a href={h} onClick={onClick} {...rest}>{children}</a>
            },
            img: ({ src, alt, ...rest }) => {
              // Resolve relative image paths against the current file's folder.
              if (typeof src !== 'string') return <img alt={alt} {...rest} />
              const resolved = resolveImageSrc(src, path)
              return <img src={resolved} alt={alt} {...rest} />
            }
          }}
        >
          {md}
        </ReactMarkdown>
      </article>
    </div>
  )
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-[420px] text-center">
        <div className="text-sm text-red-400 mb-2">Couldn't load preview</div>
        <div className="text-xs text-zinc-500 break-words">{message}</div>
      </div>
    </div>
  )
}

function resolveImageSrc(src: string, filePath: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return src // already a URL (http, data:, file:)
  if (src.startsWith('/')) return 'file://' + encodeURI(src)
  const base = filePath.slice(0, filePath.lastIndexOf('/'))
  return 'file://' + encodeURI(base + '/' + src)
}
