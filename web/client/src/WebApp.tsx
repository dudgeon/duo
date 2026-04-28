/**
 * Duo Web — slim app shell.
 *
 * Intentionally smaller than `renderer/App.tsx` (which is 1195 lines
 * deeply tied to the embedded browser, install banners, update checker,
 * cross-pane shortcut routing). This shell composes the same proven
 * children:
 *
 *   - TerminalPane (xterm.js, real PTY via the daemon)
 *   - A simple file tree rooted at $HOME
 *   - WorkingPane that holds an editor or canvas tab depending on the
 *     opened file's classification
 *
 * Out of scope for v1: tab strip pinning, install banners, browser
 * pane, update banners, theme menu UI (theme is plumbed but the toggle
 * is a button rather than the full DropdownMenu).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { TerminalPane } from '../../../renderer/components/TerminalPane'
import { MarkdownEditor } from '../../../renderer/components/editor/MarkdownEditor'
import { CanvasTab } from '../../../renderer/components/HtmlCanvas/CanvasTab'
import { classifyFile } from '../../../renderer/components/fileClassifier'
import type { TabSession, DirEntry } from '../../../shared/types'
import { getEnv } from './electron-shim'

interface OpenFile {
  path: string
  type: ReturnType<typeof classifyFile>['type']
}

export function WebApp() {
  const env = getEnv()
  const home = env.HOME

  // ── Terminal tabs ──────────────────────────────────────────────────
  const [terminals, setTerminals] = useState<TabSession[]>(() => [
    {
      id: makeId(),
      title: 'shell',
      cwd: home || '/',
      kind: 'shell'
    }
  ])
  const [activeTermId, setActiveTermId] = useState<string>(terminals[0].id)

  // Push the active terminal id so `duo send` knows where to write.
  useEffect(() => {
    window.electron.terminal.pushActiveId(activeTermId)
    return () => window.electron.terminal.pushActiveId(null)
  }, [activeTermId])

  const onTerminalTitleChange = useCallback((id: string, title: string) => {
    setTerminals((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)))
  }, [])

  const newTerminal = useCallback(() => {
    const tab: TabSession = {
      id: makeId(),
      title: 'shell',
      cwd: home || '/',
      kind: 'shell'
    }
    setTerminals((prev) => [...prev, tab])
    setActiveTermId(tab.id)
  }, [home])

  const closeTerminal = useCallback(
    (id: string) => {
      setTerminals((prev) => {
        const next = prev.filter((t) => t.id !== id)
        if (next.length === 0) {
          // Always keep at least one — open a fresh shell.
          const fresh: TabSession = {
            id: makeId(),
            title: 'shell',
            cwd: home || '/',
            kind: 'shell'
          }
          setActiveTermId(fresh.id)
          return [fresh]
        }
        if (id === activeTermId) setActiveTermId(next[0].id)
        return next
      })
    },
    [activeTermId, home]
  )

  // ── File tree ──────────────────────────────────────────────────────
  const [navCwd, setNavCwd] = useState<string>(home || '/')
  const [navEntries, setNavEntries] = useState<DirEntry[]>([])
  const [navError, setNavError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setNavError(null)
    window.electron.files
      .list(navCwd)
      .then((rows) => {
        if (!cancelled) setNavEntries(rows)
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setNavError(err.message)
          setNavEntries([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [navCwd])

  // ── Working pane (editor / canvas) ─────────────────────────────────
  const [openFile, setOpenFile] = useState<OpenFile | null>(null)

  const openPath = useCallback(
    async (p: string) => {
      const cls = classifyFile(p)
      if (cls.type === 'editor' || cls.type === 'html-canvas' ||
          cls.type === 'markdown-preview') {
        setOpenFile({ path: p, type: cls.type })
      } else {
        try {
          await window.electron.files.openExternal(p)
        } catch (err) {
          console.warn('open external failed:', err)
        }
      }
    },
    []
  )

  // CLI-driven open: `duo edit <path>` and `duo view <path>` push events
  // that the daemon forwards on the same channels the Electron build
  // uses. Subscribe so the agent can drive the working pane.
  useEffect(() => {
    const offEdit = window.electron.nav.onEdit((p) => void openPath(p))
    const offView = window.electron.nav.onView((p) => void openPath(p))
    const offReveal = window.electron.nav.onReveal((p) => {
      // For now: walk the file tree to the parent directory.
      const parent = p.endsWith('/') ? p.slice(0, -1) : p.replace(/\/[^/]+$/, '') || '/'
      setNavCwd(parent)
    })
    return () => {
      offEdit()
      offView()
      offReveal()
    }
  }, [openPath])

  // Selection-format + theme stubs — push neutral defaults so the daemon
  // cache has something to return for `duo theme` / `duo selection-format`.
  useEffect(() => {
    window.electron.theme.pushState({ mode: 'system', effective: 'light' })
    window.electron.selectionFormat.pushState({ format: 'a' })
  }, [])

  // ── Layout ─────────────────────────────────────────────────────────
  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <strong style={{ marginRight: 12 }}>Duo Web</strong>
        <span style={styles.subtle}>{home}</span>
        <span style={{ flex: 1 }} />
        <span style={styles.subtle}>
          {terminals.length} terminal{terminals.length === 1 ? '' : 's'}
        </span>
      </header>

      <main style={styles.main}>
        {/* Left: terminals */}
        <section style={styles.left}>
          <div style={styles.tabBar}>
            {terminals.map((t) => (
              <button
                key={t.id}
                style={{
                  ...styles.tab,
                  ...(t.id === activeTermId ? styles.tabActive : {})
                }}
                onClick={() => setActiveTermId(t.id)}
                onAuxClick={(e) => {
                  if (e.button === 1) closeTerminal(t.id)
                }}
                title={t.cwd}
              >
                {t.title || 'shell'}
              </button>
            ))}
            <button style={styles.tabButton} onClick={newTerminal} title="New terminal">
              +
            </button>
          </div>
          <div style={styles.terminalHost}>
            <TerminalPane
              tabs={terminals}
              activeTabId={activeTermId}
              onTitleChange={onTerminalTitleChange}
              cozyByTab={{}}
              cozyDefault={false}
              fontBumpByTab={{}}
              fontBumpDefault={0}
              themeEffective="light"
            />
          </div>
        </section>

        {/* Right: file tree + working surface */}
        <section style={styles.right}>
          <div style={styles.tree}>
            <div style={styles.treeHeader}>
              <button
                style={styles.upBtn}
                disabled={navCwd === '/' || navCwd === ''}
                onClick={() => {
                  const parent = navCwd.replace(/\/[^/]+\/?$/, '') || '/'
                  setNavCwd(parent)
                }}
                title="Up one directory"
              >
                ↑
              </button>
              <span style={{ marginLeft: 8, fontFamily: 'monospace' }}>{navCwd}</span>
            </div>
            {navError ? (
              <div style={styles.error}>{navError}</div>
            ) : (
              <ul style={styles.list}>
                {navEntries.map((e) => (
                  <li
                    key={e.path}
                    style={styles.listItem}
                    onDoubleClick={() => {
                      if (e.kind === 'directory') setNavCwd(e.path)
                      else void openPath(e.path)
                    }}
                  >
                    {e.kind === 'directory' ? '📁 ' : '📄 '}
                    {e.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div style={styles.workspace}>
            {!openFile && (
              <div style={styles.empty}>
                Double-click a file in the tree, or run <code>duo edit ~/notes.md</code>{' '}
                from a terminal.
              </div>
            )}
            {openFile?.type === 'editor' && (
              <MarkdownEditor key={openFile.path} path={openFile.path} />
            )}
            {openFile?.type === 'html-canvas' && (
              <CanvasTab key={openFile.path} path={openFile.path} homeDir={home} />
            )}
            {openFile?.type === 'markdown-preview' && (
              <MarkdownEditor key={openFile.path} path={openFile.path} />
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

function makeId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    width: '100vw',
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    color: '#1f2328',
    background: '#fafafa'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 14px',
    borderBottom: '1px solid #e5e7eb',
    background: '#fff',
    fontSize: 14
  },
  subtle: { color: '#6b7280', fontSize: 13 },
  main: { display: 'flex', flex: 1, minHeight: 0 },
  left: {
    width: '50%',
    display: 'flex',
    flexDirection: 'column',
    borderRight: '1px solid #e5e7eb',
    background: '#000',
    color: '#fff'
  },
  tabBar: {
    display: 'flex',
    gap: 4,
    padding: 4,
    background: '#1f2937',
    borderBottom: '1px solid #374151'
  },
  tab: {
    padding: '4px 10px',
    fontSize: 12,
    background: '#111827',
    color: '#9ca3af',
    border: '1px solid #374151',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'monospace'
  },
  tabActive: {
    background: '#fff',
    color: '#000'
  },
  tabButton: {
    padding: '4px 8px',
    fontSize: 12,
    background: '#111827',
    color: '#9ca3af',
    border: '1px solid #374151',
    borderRadius: 4,
    cursor: 'pointer'
  },
  terminalHost: { flex: 1, position: 'relative', overflow: 'hidden' },
  right: { flex: 1, display: 'flex', flexDirection: 'column' },
  tree: {
    height: 200,
    borderBottom: '1px solid #e5e7eb',
    overflow: 'auto',
    background: '#fff'
  },
  treeHeader: {
    position: 'sticky',
    top: 0,
    display: 'flex',
    alignItems: 'center',
    padding: '6px 10px',
    background: '#f9fafb',
    borderBottom: '1px solid #e5e7eb',
    fontSize: 12
  },
  upBtn: {
    padding: '2px 8px',
    border: '1px solid #d1d5db',
    background: '#fff',
    cursor: 'pointer',
    borderRadius: 4
  },
  list: { listStyle: 'none', margin: 0, padding: 4 },
  listItem: {
    padding: '3px 8px',
    cursor: 'pointer',
    fontSize: 13,
    fontFamily: 'monospace',
    userSelect: 'none' as const
  },
  workspace: { flex: 1, overflow: 'auto', background: '#fff', minHeight: 0 },
  empty: { padding: 20, color: '#6b7280', fontSize: 13 },
  error: { padding: 12, color: '#b91c1c', fontSize: 13 }
}
