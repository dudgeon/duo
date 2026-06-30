import type { Meta, StoryObj } from '@storybook/react'
import { IdInjectionBanner } from './IdInjectionBanner'

// ENH-239 Phase 1 — first-open ID-injection prompt that mounts in PageTab
// between the toolbar and the iframe. Pure presentational banner
// ({ dir, candidateCount, onAccept, onDecline }) with one local checkbox
// for "don't ask again for this folder".
const meta = {
  title: 'Page/IdInjectionBanner',
  component: IdInjectionBanner,
  args: {
    dir: '/Users/preview/notes/canvases',
    candidateCount: 12,
    onAccept: () => {},
    onDecline: () => {},
  },
} satisfies Meta<typeof IdInjectionBanner>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

// Singular copy path ("1 element" / no trailing s).
export const SingleCandidate: Story = { args: { candidateCount: 1 } }

// Long folder path hits the truncation branch (…+ slice).
export const LongFolderPath: Story = {
  args: {
    dir: '/Users/preview/Documents/GitHub/duo/docs/research/assets/project-filter/very/deep/folder',
  },
}
