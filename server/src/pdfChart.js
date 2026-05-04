import PDFDocument from 'pdfkit'

const MM = 72 / 25.4

// CMYK → approximate RGB for screen rendering (visual guide only).
// All values 0-100 in, 0-255 out.
function cmykToRgb(c, m, y, k) {
  const r = Math.round(255 * (1 - c/100) * (1 - k/100))
  const g = Math.round(255 * (1 - m/100) * (1 - k/100))
  const b = Math.round(255 * (1 - y/100) * (1 - k/100))
  return [
    Math.max(0, Math.min(255, r)),
    Math.max(0, Math.min(255, g)),
    Math.max(0, Math.min(255, b)),
  ]
}

function recipeLabel(p) {
  const parts = []
  if (p.c > 0) parts.push(`C${p.c}`)
  if (p.m > 0) parts.push(`M${p.m}`)
  if (p.y > 0) parts.push(`Y${p.y}`)
  if (p.k > 0) parts.push(`K${p.k}`)
  return parts.join(' ') || 'PAPER'
}

export function generateCalibrationPDF(printer, patches, outputStream) {
  const COLS  = 12
  const ROWS  = Math.ceil(patches.length / COLS)

  const MARGIN = 14 * MM
  const HEADER = 26
  const CELL_W = (560 * MM - MARGIN * 2) / COLS
  const CELL_H = Math.round(CELL_W * 0.76)
  const PAGE_W = 560 * MM
  const PAGE_H = MARGIN + HEADER + CELL_H * ROWS + MARGIN

  const GRID_Y   = MARGIN + HEADER
  const SWATCH_H = Math.round(CELL_H * 0.55)

  const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0, autoFirstPage: true })
  doc.pipe(outputStream)

  // ── Header ───────────────────────────────────────────────────────────────
  doc.fontSize(10).fillColor('#111111')
     .text(
       `Calibration Chart — ${printer.name}${printer.modeLabel ? ' · ' + printer.modeLabel : ''}`,
       MARGIN, MARGIN, { width: PAGE_W * 0.65 }
     )
  doc.fontSize(8).fillColor('#888888')
     .text(
       `${new Date().toLocaleDateString('en-AU')}  ·  ${patches.length} patches  ·  Swatches are approximate — use numeric values for printing`,
       MARGIN, MARGIN + 2,
       { align: 'right', width: PAGE_W - MARGIN * 2 }
     )
  doc.moveTo(MARGIN, MARGIN + 18).lineTo(PAGE_W - MARGIN, MARGIN + 18)
     .lineWidth(0.4).strokeColor('#cccccc').stroke()

  // ── Patch grid ───────────────────────────────────────────────────────────
  patches.forEach((p, i) => {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    const x   = MARGIN + col * CELL_W
    const y   = GRID_Y + row * CELL_H

    const [r, g, b] = cmykToRgb(p.c, p.m, p.y, p.k)

    // Light grey cell background — makes near-white patches visible
    doc.rect(x + 0.5, y + 0.5, CELL_W - 1, CELL_H - 1)
       .fillColor('#f0f0f0').fill()

    // Colour swatch (approximate RGB — visual guide only)
    doc.rect(x + 1, y + 1, CELL_W - 2, SWATCH_H - 1)
       .fillColor([r, g, b]).fill()

    // Cell border
    doc.rect(x + 0.5, y + 0.5, CELL_W - 1, CELL_H - 1)
       .lineWidth(0.3).strokeColor('#cccccc').stroke()

    // Patch ID
    const bright = (r + g + b) / 3
    const idColor = bright < 120 ? '#ffffff' : '#333333'
    doc.fontSize(6.5).fillColor(idColor)
       .text(`#${p.id}`, x + 2, y + SWATCH_H - 11, { width: CELL_W - 4, align: 'center' })

    // CMYK recipe — primary information, clearly readable
    doc.fontSize(5.5).fillColor('#222222')
       .text(recipeLabel(p), x + 1, y + SWATCH_H + 3, { width: CELL_W - 2, align: 'center' })
  })

  doc.end()
}
