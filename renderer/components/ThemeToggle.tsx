// Stage 11 § D33d — small theme toggle in the top chrome row.
// Cycles System → Light → Dark on click. Right-click would be the natural
// place for an explicit picker; deferred until needed.

import type { ThemeMode } from '../hooks/useTheme'

interface Props {
  mode: ThemeMode
  onCycle: () => void
}

export function ThemeToggle({ mode, onCycle }: Props) {
  const label = mode === 'system' ? 'System' : mode === 'light' ? 'Light' : 'Dark'
  return (
    <button
      onClick={onCycle}
      title={`Theme: ${label} \u2014 click to cycle (System \u2192 Light \u2192 Dark)`}
      aria-label={`Theme: ${label}, click to cycle`}
      className="titlebar-nodrag h-7 px-2 flex items-center gap-1.5 rounded border border-border text-zinc-300 hover:text-zinc-100 hover:border-accent/60 hover:bg-surface-2 transition-colors text-xs font-medium"
    >
      <span className="text-zinc-400">
        {mode === 'system' && <SystemIcon />}
        {mode === 'light' && <SunIcon />}
        {mode === 'dark' && <MoonIcon />}
      </span>
      <span>{label}</span>
    </button>
  )
}

function SystemIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="2.5" width="11" height="7.5" rx="1" />
      <path d="M5 12.5h4M7 10v2.5" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="2.6" />
      <path d="M7 1.2v1.4M7 11.4v1.4M1.2 7h1.4M11.4 7h1.4M2.9 2.9l1 1M10.1 10.1l1 1M2.9 11.1l1-1M10.1 3.9l1-1" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.6 8.6A4.6 4.6 0 0 1 5.4 2.4a5 5 0 1 0 6.2 6.2Z" />
    </svg>
  )
}
