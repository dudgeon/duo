// Stage 10 Phase 4 — breadcrumb bar at the top of the navigator.
// Shows the path from $HOME (as `~`) down to the current folder. Clicking a
// segment navigates there.

interface BreadcrumbProps {
  cwd: string
  home: string
  onNavigate: (path: string) => void
}

export function Breadcrumb({ cwd, home, onNavigate }: BreadcrumbProps) {
  const segments = breadcrumbSegments(cwd, home)
  return (
    <div className="flex items-center gap-0.5 px-3 h-8 text-[11px] overflow-x-auto scrollbar-none border-b border-border shrink-0">
      {segments.map((seg, i) => (
        <div key={seg.path} className="flex items-center gap-0.5 min-w-0 shrink-0">
          <button
            onClick={() => onNavigate(seg.path)}
            className={[
              'px-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-surface-3 transition-colors truncate max-w-[120px]',
              i === segments.length - 1 ? 'text-zinc-200 font-medium' : ''
            ].join(' ')}
            title={seg.path}
          >
            {seg.label}
          </button>
          {i < segments.length - 1 && (
            <span className="text-zinc-600 select-none">/</span>
          )}
        </div>
      ))}
    </div>
  )
}

function breadcrumbSegments(cwd: string, home: string): Array<{ label: string; path: string }> {
  if (cwd === '/' || cwd === '') return [{ label: '/', path: '/' }]
  // Normalise trailing slashes.
  const clean = cwd.replace(/\/+$/, '')
  const homeClean = home.replace(/\/+$/, '')

  // If cwd is inside $HOME, render the `~` shortcut for the home segment
  // so PMs don't see the literal /Users/<name>/ prefix.
  if (homeClean && clean.startsWith(homeClean)) {
    const rest = clean.slice(homeClean.length).replace(/^\/+/, '')
    const parts = rest === '' ? [] : rest.split('/')
    const out: Array<{ label: string; path: string }> = [{ label: '~', path: homeClean }]
    let acc = homeClean
    for (const p of parts) {
      acc = acc + '/' + p
      out.push({ label: p, path: acc })
    }
    return out
  }

  // Fallback: absolute path from root.
  const parts = clean.split('/').filter(Boolean)
  const out: Array<{ label: string; path: string }> = [{ label: '/', path: '/' }]
  let acc = ''
  for (const p of parts) {
    acc = acc + '/' + p
    out.push({ label: p, path: acc })
  }
  return out
}
