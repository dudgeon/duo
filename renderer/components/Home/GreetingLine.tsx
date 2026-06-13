// ENH-212 — the greeting line (D4). Styled serif TEXT, not a boxed banner.
// All the briefing logic lives in homeModel.greetingLine; this component is
// pure presentation.

import type { GreetingData } from '@shared/types'
import { greetingLine } from './homeModel'

export function GreetingLine({ greeting }: { greeting: GreetingData }) {
  return (
    <p className="duo-home-greeting font-serif text-ink">
      {greetingLine(greeting)}
    </p>
  )
}
