import type { Meta, StoryObj } from '@storybook/react'
import { TypePickerPopover } from './TypePickerPopover'

// ENH-239 Phase 1 — the silent-stub type picker (ENH-208 D4). It portals to
// document.body, anchors at the post-insert caret rect, and loads the vault's
// template registry via window.electron.vault.types() on mount. In Storybook
// the mock seam stubs that IPC, so the picker renders its "Loading types…"
// state — a valid smoke of the popover chrome + filter input.

const caretRect = new DOMRect(80, 80, 0, 16)

const meta = {
  title: 'Editor/Primitives/TypePickerPopover',
  component: TypePickerPopover,
  args: {
    vaultRoot: '/vault',
    name: 'New Spec',
    anchorRect: caretRect,
    onCreated: () => {},
    onCancel: () => {},
  },
} satisfies Meta<typeof TypePickerPopover>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const NoAnchorRect: Story = { args: { anchorRect: null } }
