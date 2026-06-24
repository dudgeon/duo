// ENH-231 — the catch-up card's small atoms: the Needs-you attention chip, the
// scheduled (cron) badge, and the file / todo / artifact chip rows. All purely
// presentational; colors come from --duo-* vars + the shared both-theme-legible
// duo-banner-* classes (never a bare hex / dark: util).

import type { CatchupCard, DigestTodo, AttentionReason } from '@shared/types'
import { attentionChip } from './homeModel'

/** The Needs-you reason chip (plan-to-approve / question / blocked). */
export function AttentionChip({ reason }: { reason: AttentionReason }) {
  const { label, bannerClass } = attentionChip(reason)
  return <span className={`duo-cu-chip duo-cu-attn ${bannerClass}`}>{label}</span>
}

/** The cron-run badge. */
export function ScheduledBadge() {
  return <span className="duo-cu-chip duo-cu-scheduled">🕐 scheduled</span>
}

/** Basename of a path for a chip label. */
function base(p: string): string {
  const t = p.replace(/\/+$/, '')
  const i = t.lastIndexOf('/')
  return i < 0 ? t : t.slice(i + 1)
}

/** Files-in-flight chips (basename, deduped by the digest already). */
export function FileChips({ files }: { files: CatchupCard['files'] }) {
  if (files.length === 0) return null
  return (
    <div className="duo-cu-chiprow">
      {files.slice(0, 6).map((f) => (
        <span key={f.path} className="duo-cu-fchip" title={`${f.kind}: ${f.path}`}>
          {base(f.path)}
        </span>
      ))}
      {files.length > 6 && <span className="duo-cu-fchip duo-cu-more">+{files.length - 6}</span>}
    </div>
  )
}

/** Detected-artifact chips: opened PR, tests pass/fail, files created. */
export function ArtifactChips({ artifacts }: { artifacts: CatchupCard['artifacts'] }) {
  const created = (artifacts.createdFiles ?? []).length
  if (!artifacts.pr && !artifacts.tests && created === 0) return null
  return (
    <div className="duo-cu-chiprow">
      {artifacts.pr && <span className="duo-cu-achip duo-cu-achip-pr">PR #{artifacts.pr.number}</span>}
      {artifacts.tests === 'pass' && <span className="duo-cu-achip duo-banner-ok">tests green</span>}
      {artifacts.tests === 'fail' && <span className="duo-cu-achip duo-banner-error">tests red</span>}
      {created > 0 && (
        <span className="duo-cu-achip duo-cu-achip-file">
          {created === 1 ? '1 file created' : `${created} files created`}
        </span>
      )}
    </div>
  )
}

/** Next-steps todo chips with per-item status (the latest TodoWrite). */
export function TodoChips({ todos }: { todos: DigestTodo[] }) {
  if (todos.length === 0) return null
  return (
    <div className="duo-cu-chiprow">
      {todos.slice(0, 5).map((t, i) => (
        <span key={i} className={`duo-cu-todo duo-cu-todo-${t.status}`} title={t.status}>
          {t.text}
        </span>
      ))}
      {todos.length > 5 && <span className="duo-cu-todo duo-cu-more">+{todos.length - 5}</span>}
    </div>
  )
}
