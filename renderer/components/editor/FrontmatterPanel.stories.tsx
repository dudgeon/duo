import type { Meta, StoryObj } from '@storybook/react'
import { FrontmatterPanel } from './FrontmatterPanel'

// ENH-239 Phase 1 — the YAML-frontmatter "Properties" panel (BUG-139). Heavy
// on the editor side, but self-contained for rendering: it parses the
// `frontmatter` string with the pure frontmatterParser and renders structured
// rows. The `[[ ]]` autocomplete stays inert when no vault index is threaded
// in, so a minimal smoke set covers the meaningful states.
const SAMPLE = [
  'title: Project overview',
  'type: initiative',
  'status: active',
  'tags:',
  '  - roadmap',
  '  - q3',
].join('\n')

const meta = {
  title: 'Editor/FrontmatterPanel',
  component: FrontmatterPanel,
  args: {
    frontmatter: SAMPLE,
    onChange: () => {},
    collapsed: false,
    onToggleCollapsed: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ width: 520, border: '1px solid var(--duo-paper-rule)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FrontmatterPanel>

export default meta
type Story = StoryObj<typeof meta>

export const WithProperties: Story = {}

export const Collapsed: Story = { args: { collapsed: true } }

// null frontmatter → the "+ Add properties" call-to-action.
export const Empty: Story = { args: { frontmatter: null } }
