// ENH-208 — home-abbreviation for user-facing vault paths
// ('/Users/g/vault' → '~/vault'). Shared by the renderer (the ⌘⇧F
// palette's footer) and the Electron main process (Settings → Default
// Vault menu labels) so the prefix guard lives in exactly ONE tested
// place: '/Users/geoff-backup' must not render as '~-backup' under home
// '/Users/geoff'.

export function abbreviateHome(p: string, home: string): string {
  if (!home) return p
  if (p === home) return '~'
  if (p.startsWith(home + '/')) return '~' + p.slice(home.length)
  return p
}
