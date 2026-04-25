import typography from '@tailwindcss/typography'

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './renderer/**/*.{ts,tsx,html}'
  ],
  theme: {
    extend: {
      fontFamily: {
        // Stage 12 — Atelier voice (DUO_VOICE.atelier in the Atelier
        // bundle): sans for chrome labels, serif for chrome accents +
        // editor body, mono for terminal.
        sans: [
          '-apple-system', 'BlinkMacSystemFont', 'SF Pro Text',
          'ui-sans-serif', 'Inter', 'Segoe UI', 'Helvetica Neue', 'sans-serif'
        ],
        serif: [
          'ui-serif', '"New York"', 'Charter', 'iowan-old-style',
          '"Iowan Old Style"', 'Georgia', 'Times New Roman', 'serif'
        ],
        // Display: serif (chrome accents — titles, breadcrumb root, headings)
        display: [
          '"New York"', 'ui-serif', 'Charter', 'iowan-old-style',
          '"Iowan Old Style"', 'Georgia', 'serif'
        ],
        mono: ['JetBrains Mono', 'Cascadia Code', 'Fira Code', 'ui-monospace', 'monospace']
      },
      colors: {
        // Stage 12 — Atelier palette via CSS variables (defined in
        // renderer/styles/globals.css). The names are kept compatible
        // with the previous Warp×Linear surface.0–3 / accent / border
        // scale so existing components (`bg-surface-0`, `border-border`,
        // etc.) continue to work — they just resolve to Atelier values.
        surface: {
          0: 'var(--duo-paper)',        // primary surface — the page
          1: 'var(--duo-paper-deep)',   // chrome, panes
          2: 'var(--duo-paper-edge)',   // tab strip, subtle dividers
          3: 'var(--duo-paper-rule)'    // hairlines
        },
        border: {
          DEFAULT: 'var(--duo-paper-rule)',
          subtle: 'var(--duo-paper-edge)',
          strong: 'var(--duo-ink-ghost)'
        },
        accent: {
          DEFAULT: 'var(--duo-accent)',
          soft: 'var(--duo-accent-soft)',
          ink: 'var(--duo-accent-ink)',
          // Backwards-compat alias — components still reference accent.dim
          dim: 'var(--duo-accent-soft)'
        },
        // New Atelier-specific scale (use these for new components)
        ink: {
          DEFAULT: 'var(--duo-ink)',
          soft: 'var(--duo-ink-soft)',
          mute: 'var(--duo-ink-mute)',
          ghost: 'var(--duo-ink-ghost)'
        },
        mark: 'var(--duo-mark)'
      }
    }
  },
  plugins: [typography]
}
