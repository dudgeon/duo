import type { Meta, StoryObj } from '@storybook/react'
import { RenderedPage } from './RenderedPage'

// ENH-239 Phase 1 — heavy iframe-host smoke story. RenderedPage (Stage 17a)
// mounts a srcdoc iframe whose body it wires for contentEditable + mutation
// observation. It renders standalone (no parent PageTab needed) because the
// surface IS a plain same-origin iframe; the callbacks are no-ops here. Sized
// container so the flex-1 iframe has room to paint.
const SAMPLE_HTML = `<!doctype html>
<html>
  <head><style>body { font-family: system-ui; padding: 24px; color: #1a1611; }</style></head>
  <body>
    <h1>Canvas preview</h1>
    <p>This HTML renders inside the RenderedPage iframe.</p>
  </body>
</html>`

// RenderedPage is a forwardRef whose Props interface isn't exported, so the
// `satisfies` form would surface an un-nameable type in the exported `meta`
// (TS4023). An explicit annotation keeps the exported type as the nameable
// Meta<typeof RenderedPage>.
const meta: Meta<typeof RenderedPage> = {
  title: 'Page/RenderedPage',
  component: RenderedPage,
  args: {
    initialHtml: SAMPLE_HTML,
    onChange: () => {},
    onShortcut: () => false,
  },
  decorators: [
    (Story) => (
      <div style={{ width: 560, height: 360, display: 'flex' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

// Read-only mount — no contentEditable / observer / shortcut handler wired.
export const ReadOnly: Story = { args: { readOnly: true } }
