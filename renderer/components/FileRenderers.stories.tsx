import type { Meta, StoryObj } from '@storybook/react'
import type { WorkingTab } from '@shared/types'
import { PdfPreview, UnknownFilePreview } from './FileRenderers'

// ENH-239 Phase 1 — per-type WorkingPane fallback renderers. This file exports
// TWO components; PdfPreview is the meta.component primary, UnknownFilePreview is
// rendered via a custom render arrow. Both take { tab: WorkingTab } and probe
// files.* IPC (mocked by the decorator). They flex-fill, so they're wrapped in a
// sized slot. PdfPreview hosts an <embed> for Chromium's PDF plugin, which is a
// no-op outside Electron — the chrome still renders.

const pdfTab: WorkingTab = {
  id: 'f:pdf-1',
  type: 'pdf',
  title: 'report.pdf',
  isActive: true,
  path: '/Users/geoff/Documents/report.pdf',
  mime: 'application/pdf',
}

const unknownFileTab: WorkingTab = {
  id: 'f:unknown-1',
  type: 'unknown',
  title: 'archive.zip',
  isActive: true,
  path: '/Users/geoff/Downloads/archive.zip',
  mime: 'application/zip',
}

const folderTab: WorkingTab = {
  id: 'f:dir-1',
  type: 'unknown',
  title: 'src',
  isActive: true,
  path: '/Users/geoff/Documents/project/src',
}

const sized = (node: React.ReactNode) => (
  <div style={{ height: 420, width: 560, display: 'flex', flexDirection: 'column', background: 'var(--duo-paper)' }}>
    {node}
  </div>
)

const meta = {
  title: 'Modals/FileRenderers',
  component: PdfPreview,
  args: { tab: pdfTab },
  decorators: [(Story) => sized(<Story />)],
} satisfies Meta<typeof PdfPreview>

export default meta
type Story = StoryObj<typeof meta>

export const Pdf: Story = {}

export const UnknownFile: Story = {
  render: () => sized(<UnknownFilePreview tab={unknownFileTab} />),
}

export const Folder: Story = {
  render: () => sized(<UnknownFilePreview tab={folderTab} />),
}
