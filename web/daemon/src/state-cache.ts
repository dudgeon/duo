/**
 * In-memory state cache for Duo Web.
 *
 * Mirrors the half-dozen "renderer pushes, main caches" snapshots the
 * Electron build keeps in `main.ts` module scope so that CLI commands
 * (`duo theme`, `duo nav-state`, `duo selection`) can return without a
 * round-trip to the renderer. The protocol channel names match the
 * Electron build's `IPC.*_PUSH` constants.
 */

import type {
  NavStateSnapshot,
  EditorSelectionSnapshot,
  HtmlCanvasSelectionSnapshot,
  ThemeStateSnapshot,
  SelectionFormatStateSnapshot
} from '../../../shared/types'

export class StateCache {
  navState: NavStateSnapshot = {
    cwd: '',
    selected: null,
    expanded: [],
    pinned: false
  }

  editorSelection: EditorSelectionSnapshot | null = null
  canvasSelection: HtmlCanvasSelectionSnapshot | null = null

  theme: ThemeStateSnapshot = { mode: 'system', effective: 'light' }

  selectionFormat: SelectionFormatStateSnapshot = { format: 'a' }

  /** Active terminal tab id — `duo send` writes here. */
  activeTerminalId: string | null = null
}
