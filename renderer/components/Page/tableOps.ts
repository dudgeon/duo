// Stage 17a polish item 6 — canvas-side table operations + can-X queries
// for the contextual table strip in the shared EditorToolbar. Mirrors
// what TipTap's table extension provides for the markdown editor.
//
// All functions assume the caret is inside a table cell (<td>/<th>).
// can-X queries return false when the precondition isn't met; the
// toolbar disables the corresponding button.

export interface CaretTablePosition {
  table: HTMLTableElement
  row: HTMLTableRowElement
  cell: HTMLTableCellElement
  rowIndex: number
  colIndex: number
  totalRows: number
  totalCols: number
  hasHeaderRow: boolean
}

export function getCaretTablePosition(doc: Document): CaretTablePosition | null {
  const sel = doc.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  let cur: Node | null = sel.getRangeAt(0).startContainer
  let cell: HTMLTableCellElement | null = null
  let row: HTMLTableRowElement | null = null
  let table: HTMLTableElement | null = null
  while (cur && cur !== doc.body) {
    if (cur.nodeType === 1) {
      const el = cur as Element
      if (!cell && (el.tagName === 'TD' || el.tagName === 'TH')) {
        cell = el as HTMLTableCellElement
      }
      if (!row && el.tagName === 'TR') {
        row = el as HTMLTableRowElement
      }
      if (el.tagName === 'TABLE') {
        table = el as HTMLTableElement
        break
      }
    }
    cur = cur.parentNode
  }
  if (!table || !row || !cell) return null

  const rowIndex = row.rowIndex
  const colIndex = cell.cellIndex
  const totalRows = table.rows.length
  const totalCols = (table.rows[0]?.cells.length) ?? 0
  const hasHeaderRow = (table.tHead?.rows.length ?? 0) > 0
  return { table, row, cell, rowIndex, colIndex, totalRows, totalCols, hasHeaderRow }
}

// ── Mutations ──────────────────────────────────────────────────────────────

export function addRowBefore(doc: Document): void {
  const pos = getCaretTablePosition(doc)
  if (!pos) return
  const newRow = buildEmptyRow(doc, pos.totalCols)
  pos.row.parentElement?.insertBefore(newRow, pos.row)
}

export function addRowAfter(doc: Document): void {
  const pos = getCaretTablePosition(doc)
  if (!pos) return
  const newRow = buildEmptyRow(doc, pos.totalCols)
  pos.row.parentElement?.insertBefore(newRow, pos.row.nextSibling)
}

export function deleteRow(doc: Document): void {
  const pos = getCaretTablePosition(doc)
  if (!pos) return
  if (pos.totalRows <= 1) return
  pos.row.remove()
}

export function addColumnBefore(doc: Document): void {
  const pos = getCaretTablePosition(doc)
  if (!pos) return
  for (const r of Array.from(pos.table.rows)) {
    const isHeaderRow = r.parentElement?.tagName === 'THEAD'
    const newCell = doc.createElement(isHeaderRow ? 'th' : 'td')
    newCell.innerHTML = '&nbsp;'
    r.insertBefore(newCell, r.cells[pos.colIndex] ?? null)
  }
}

export function addColumnAfter(doc: Document): void {
  const pos = getCaretTablePosition(doc)
  if (!pos) return
  for (const r of Array.from(pos.table.rows)) {
    const isHeaderRow = r.parentElement?.tagName === 'THEAD'
    const newCell = doc.createElement(isHeaderRow ? 'th' : 'td')
    newCell.innerHTML = '&nbsp;'
    const ref = r.cells[pos.colIndex + 1] ?? null
    r.insertBefore(newCell, ref)
  }
}

export function deleteColumn(doc: Document): void {
  const pos = getCaretTablePosition(doc)
  if (!pos) return
  if (pos.totalCols <= 1) return
  for (const r of Array.from(pos.table.rows)) {
    const cell = r.cells[pos.colIndex]
    cell?.remove()
  }
}

export function toggleHeaderRow(doc: Document): void {
  const pos = getCaretTablePosition(doc)
  if (!pos) return
  if (pos.hasHeaderRow) {
    // Move thead's first row into tbody as <td>s.
    const headerRow = pos.table.tHead?.rows[0]
    if (!headerRow) return
    const tbody = pos.table.tBodies[0] ?? pos.table.appendChild(doc.createElement('tbody'))
    const converted = doc.createElement('tr')
    for (const c of Array.from(headerRow.cells)) {
      const td = doc.createElement('td')
      td.innerHTML = c.innerHTML
      converted.appendChild(td)
    }
    tbody.insertBefore(converted, tbody.firstChild)
    pos.table.tHead?.remove()
  } else {
    // Promote the first body row to a header row.
    const firstRow = pos.table.rows[0]
    if (!firstRow) return
    const newHeader = doc.createElement('tr')
    for (const c of Array.from(firstRow.cells)) {
      const th = doc.createElement('th')
      th.innerHTML = c.innerHTML
      newHeader.appendChild(th)
    }
    const thead = doc.createElement('thead')
    thead.appendChild(newHeader)
    pos.table.insertBefore(thead, pos.table.firstChild)
    firstRow.remove()
  }
}

export function deleteTable(doc: Document): void {
  const pos = getCaretTablePosition(doc)
  if (!pos) return
  pos.table.remove()
}

function buildEmptyRow(doc: Document, cols: number): HTMLTableRowElement {
  const row = doc.createElement('tr')
  for (let i = 0; i < cols; i++) {
    const td = doc.createElement('td')
    td.innerHTML = '&nbsp;'
    row.appendChild(td)
  }
  return row
}

// ── can-X queries ──────────────────────────────────────────────────────────

export function canAddRowBefore(doc: Document): boolean {
  return getCaretTablePosition(doc) !== null
}
export function canAddRowAfter(doc: Document): boolean {
  return getCaretTablePosition(doc) !== null
}
export function canDeleteRow(doc: Document): boolean {
  const pos = getCaretTablePosition(doc)
  return pos !== null && pos.totalRows > 1
}
export function canAddColumnBefore(doc: Document): boolean {
  return getCaretTablePosition(doc) !== null
}
export function canAddColumnAfter(doc: Document): boolean {
  return getCaretTablePosition(doc) !== null
}
export function canDeleteColumn(doc: Document): boolean {
  const pos = getCaretTablePosition(doc)
  return pos !== null && pos.totalCols > 1
}
export function canToggleHeaderRow(doc: Document): boolean {
  return getCaretTablePosition(doc) !== null
}
export function canDeleteTable(doc: Document): boolean {
  return getCaretTablePosition(doc) !== null
}
