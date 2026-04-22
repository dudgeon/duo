// Stage 2: live address bar wired to the WebContentsView navigation state

import { useState, useRef, useEffect } from 'react'

interface AddressBarProps {
  url: string
  onNavigate: (url: string) => void
  isLoading?: boolean
}

export function AddressBar({ url, onNavigate, isLoading = false }: AddressBarProps) {
  const [editValue, setEditValue] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isEditing) setEditValue(url)
  }, [url, isEditing])

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
    <div className="flex-1 relative">
      <input
        ref={inputRef}
        type="text"
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
      />
      {isLoading && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin" />
      )}
    </div>
  )
}
