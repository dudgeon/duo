import typography from '@tailwindcss/typography'

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './renderer/**/*.{ts,tsx,html}'
  ],
  theme: {
    extend: {
      fontFamily: {
        // Stage 11 editor: body defaults to a serif-ish system stack for
        // the Google-Docs feel. Monospace stays on the terminal.
        sans: [
          '-apple-system', 'BlinkMacSystemFont', 'ui-sans-serif',
          'Inter', 'Segoe UI', 'Helvetica Neue', 'sans-serif'
        ],
        serif: [
          'ui-serif', 'Charter', 'iowan-old-style', 'Iowan Old Style',
          'Georgia', 'Times New Roman', 'serif'
        ],
        mono: ['JetBrains Mono', 'Cascadia Code', 'Fira Code', 'ui-monospace', 'monospace']
      },
      colors: {
        // Warp × Linear inspired palette
        surface: {
          0: '#080808',
          1: '#0f0f0f',
          2: '#161616',
          3: '#1e1e1e'
        },
        border: {
          DEFAULT: '#2a2a2a',
          subtle: '#1e1e1e',
          strong: '#3a3a3a'
        },
        accent: {
          DEFAULT: '#7c6af7',
          dim: '#5a4db5'
        }
      }
    }
  },
  plugins: [typography]
}
