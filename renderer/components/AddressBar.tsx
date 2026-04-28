// Stage 2: live address bar wired to the WebContentsView navigation state.
//
// Issue #27 / Stage 21c Phase 3 — URL autocomplete via persisted browser
// history. As the user types, we query main for ranked matches and feed
// them into a `<datalist>` so the native browser-style typeahead shows
// suggestions. No bespoke dropdown component; the datalist takes care
// of keyboard nav (arrow keys + Enter), highlighting, and styling that
// matches the platform.

import { useState, useRef, useEffect, useId } from 'react'
import type { HistorySuggestion } from '@shared/types'

interface AddressBarProps {
  url: string
  onNavigate: (url: string) => void
  isLoading?: boolean
}

const SUGGEST_DEBOUNCE_MS = 90
const SUGGEST_LIMIT = 8

export function AddressBar({ url, onNavigate, isLoading = false }: AddressBarProps) {
  const [editValue, setEditValue] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [suggestions, setSuggestions] = useState<HistorySuggestion[]>([])
  const datalistId = useId()

  useEffect(() => {
    if (!isEditing) setEditValue(url)
  }, [url, isEditing])

  // Issue #27 — debounced suggestion query. Keyed on (editValue,
  // isEditing) so suggestions only fetch while the input is focused.
  // Empty prefix returns top recent entries from main.
  useEffect(() => {
    if (!isEditing) {
      setSuggestions([])
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      void window.electron.browser
        .historySuggest(editValue, SUGGEST_LIMIT)
        .then((rows) => {
          if (!cancelled) setSuggestions(rows)
        })
        .catch((err: unknown) => {
          console.warn('[address-bar] historySuggest failed:', err)
        })
    }, SUGGEST_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [editValue, isEditing])

  const commit = () => {
    let target = editValue.trim()
    if (target && !target.includes('://') && !target.startsWith('file://')) {
      target = target.includes('.') ? `https://${target}` : `https://www.google.com/search?q=${encodeURIComponent(target)}`
    }
    if (target) onNavigate(target)
    setIsEditing(false)
    inputRef.current?.blur()
  }

  return (
    <div className="flex-1 relative min-w-0">
      <input
        ref={inputRef}
        type="text"
        list={datalistId}
        value={isEditing ? editValue : url}
        onChange={(e) => setEditValue(e.target.value)}
        onFocus={() => {
          setIsEditing(true)
          setEditValue(url)
          setTimeout(() => inputRef.current?.select(), 0)
        }}
        onBlur={() => setIsEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            setIsEditing(false)
            inputRef.current?.blur()
          }
        }}
        className="w-full h-6 px-3 rounded bg-surface-0 border border-border text-zinc-200 text-xs outline-none focus:border-accent/50 transition-colors"
        spellCheck={false}
        autoComplete="off"
        data-duo-addressbar
      />
      {/* Issue #27 — populated by the historySuggest debounce above.
          Native datalist provides typeahead UX without custom DOM. */}
      <datalist id={datalistId}>
        {suggestions.map((s) => (
          <option key={s.url} value={s.url} label={s.title === s.url ? undefined : s.title} />
        ))}
      </datalist>
      {isLoading && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin" />
      )}
    </div>
  )
}
