/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './renderer/**/*.{ts,tsx,html}'
  ],
  theme: {
    extend: {
      fontFamily: {
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
  plugins: []
}
