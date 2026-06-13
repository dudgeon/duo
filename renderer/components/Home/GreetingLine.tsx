// ENH-212 — the greeting line (D4). Styled serif TEXT, not a boxed banner.
// Round-2 feedback #3: the freshest-thread title renders as a clickable accent
// span (focus/resume that session); the rest stays plain serif. All wording
// lives in homeModel.greetingParts so the text never drifts from greetingLine.

import type { GreetingData } from '@shared/types'
import { greetingParts } from './homeModel'

interface GreetingLineProps {
  greeting: GreetingData
  /** Activate the freshest session (focus when open, else resume). When
   *  absent, or when there is no freshest thread, the title is plain text. */
  onClickFreshest?: () => void
}

export function GreetingLine({ greeting, onClickFreshest }: GreetingLineProps) {
  const { before, freshestTitle, after } = greetingParts(greeting)

  return (
    <p className="duo-home-greeting font-serif text-ink">
      {before}
      {freshestTitle && (
        onClickFreshest ? (
          <button
            type="button"
            className="duo-home-greeting-thread"
            onClick={onClickFreshest}
            title="Pick up this session"
          >
            {freshestTitle}
          </button>
        ) : (
          <span className="duo-home-greeting-thread is-static">{freshestTitle}</span>
        )
      )}
      {after}
    </p>
  )
}
