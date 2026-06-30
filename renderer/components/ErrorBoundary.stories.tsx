import type { Meta, StoryObj } from '@storybook/react'
import { ErrorBoundary } from './ErrorBoundary'

// ENH-239 Phase 1 — defensive render-error boundary. In the happy path it just
// renders its children; the interesting states are the fallback panels, shown
// here by wrapping a child that throws on render. Two variants: a fullscreen
// fixed overlay (app-level default) and an in-flow `inline` panel (scoped
// per-pane). The `label` names the surface in the fallback heading + log.

// A child that throws synchronously during render so the boundary catches it.
function Boom(): never {
  throw new Error('Simulated render failure for the story')
}

const meta = {
  title: 'Modals/ErrorBoundary',
  component: ErrorBoundary,
  args: {
    children: <div style={{ padding: 24 }}>Healthy child content.</div>,
  },
} satisfies Meta<typeof ErrorBoundary>

export default meta
type Story = StoryObj<typeof meta>

// No crash — the boundary is transparent and renders its children.
export const Healthy: Story = {}

// Fullscreen fixed-overlay fallback (the app-level default).
export const CrashedOverlay: Story = {
  args: {
    label: 'Duo',
    children: <Boom />,
  },
}

// In-flow scoped panel with a "Try again" button (per-pane boundary).
export const CrashedInline: Story = {
  args: {
    inline: true,
    label: 'WorkingPane',
    children: <Boom />,
  },
}
