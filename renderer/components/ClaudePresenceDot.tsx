// Stage 12 close — whisper-level agent presence: small accent dot
// in the titlebar that fades in / pulses softly when Claude is
// active in the front terminal. Active = the front terminal has a
// live Claude session (detected via useFrontTerminalClaudeLive).
//
// Visual: 8×8 px circle, accent color, 0.6 opacity at rest with a
// gentle 2.4s breathe (opacity 0.6 ↔ 1.0). Renders an aria-label
// for screen readers but no visible label — by design it's a
// peripheral cue, not a chrome announcement.
//
// Why "whisper" — the whole point per Stage 12 is for agent presence
// to register subliminally. A bright pulsing badge would compete
// with the user's actual work; the breathe-curve dot reads as
// "ambient" the same way a green LED on a microphone does.

import './claude-presence-dot.css'

interface Props {
  active: boolean
}

export function ClaudePresenceDot({ active }: Props) {
  return (
    <div
      className={['duo-claude-presence-dot', active ? 'is-active' : ''].join(' ')}
      role="status"
      aria-label={active ? 'Claude active in the front terminal' : 'No Claude session in the front terminal'}
      title={active ? 'Claude is active' : 'No Claude session'}
    />
  )
}
