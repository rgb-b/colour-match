import PDFDocument from 'pdfkit'

const MM = 72 / 25.4  // points per mm

// Approximate CMYKOG → RGB — used for O/G patches and text contrast calculation.
function swatchRgb(c, m, y, k, o, g) {
  const mc = Math.min(100, m + o * 0.6)
  const yc = Math.min(100, y + o * 0.4 + g * 0.3)
  const cc = Math.min(100, c + g * 0.7)
  return [
    Math.max(0, Math.min(255, Math.round(255 * (1 - cc/100) * (1 - k/100)))),
    Math.max(0, Math.min(255, Math.round(255 * (1 - mc/100) * (1 - k/100)))),
    Math.max(0, Math.min(255, Math.round(255 * (1 - yc/100) * (1 - k/100)))),
  ]
}

function recipeLabel(p) {
  const parts = []
  if (p.c > 0) parts.push(`C${p.c}`)
  if (p.m > 0) parts.push(`M${p.m}`)
  if (p.y > 0) parts.push(`Y${p.y}`)
  if (p.k > 0) parts.push(`K${p.k}`)
  if (p.o > 0) parts.push(`O${p.o}`)
  if (p.g > 0) parts.push(`G${p.g}`)
  return parts.join(' ') || 'PAPER'
}

// True for patches that can be represented exactly in CMYK
const isCmykOnly = p => p.o === 0 && p.g === 0

export function generateCalibrationPDF(printer, patches, outputStream) {
  const COLS   = 12
  const ROWS   = Math.ceil(patches.length / COLS)

  const MARGIN  = 14 * MM
  const HEADER  = 26
  const CELL_W  = (560 * MM - MARGIN * 2) / COLS
  const CELL_H  = Math.round(CELL_W * 0.76)
  const PAGE_W  = 560 * MM
  const PAGE_H  = MARGIN + HEADER + (CELL_H * ROWS) + MARGIN + 18  // +18 for legend

  const GRID_Y   = MARGIN + HEADER
  const SWATCH_H = Math.round(CELL_H * 0.60)

  const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0, autoFirstPage: true })
  doc.pipe(outputStream)

  // ── Header ───────────────────────────────────────────────────────────────
  doc.fontSize(10).fillColor([0, 0, 0, 1])  // CMYK black
     .text(
       `Calibration Chart — ${printer.name}${printer.modeLabel ? ' · ' + printer.modeLabel : ''}`,
       MARGIN, MARGIN, { width: PAGE_W * 0.6 }
     )
  doc.fontSize(8).fillColor([0, 0, 0, 0.6])
     .text(
       `${new Date().toLocaleDateString('en-AU')}  ·  ${patches.length} patches`,
       MARGIN, MARGIN + 2,
       { align: 'right', width: PAGE_W - MARGIN * 2 }
     )
  doc.moveTo(MARGIN, MARGIN + 18).lineTo(PAGE_W - MARGIN, MARGIN + 18)
     .lineWidth(0.4).strokeColor([0, 0, 0, 0.15]).stroke()

  // ── Patch grid ───────────────────────────────────────────────────────────
  patches.forEach((p, i) => {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    const x   = MARGIN + col * CELL_W
    const y   = GRID_Y + row * CELL_H

    const [r, g, b] = swatchRgb(p.c, p.m, p.y, p.k, p.o, p.g)

    // Light grey cell background — ensures near-white patches are visible
    doc.rect(x + 1, y + 1, CELL_W - 2, CELL_H - 2)
       .fillColor([0, 0, 0, 0.04])
       .fill()

    // Swatch — device CMYK for pure CMYK patches, RGB approx for O/G
    if (isCmykOnly(p)) {
      doc.rect(x + 1, y + 1, CELL_W - 2, SWATCH_H)
         .fillColor([p.c / 100, p.m / 100, p.y / 100, p.k / 100])
         .fill()
    } else {
      doc.rect(x + 1, y + 1, CELL_W - 2, SWATCH_H)
         .fillColor([r, g, b])
         .fill()
    }

    // Cell border
    doc.rect(x + 1, y + 1, CELL_W - 2, CELL_H - 2)
       .lineWidth(0.3).strokeColor([0, 0, 0, 0.18]).stroke()

    // Extended-gamut indicator — dashed top border for O/G patches
    if (!isCmykOnly(p)) {
      doc.moveTo(x + 1, y + 1).lineTo(x + CELL_W - 1, y + 1)
         .lineWidth(1.2).strokeColor([0, 0.55, 1, 0]).dash(3, { space: 2 }).stroke()
      doc.undash()
    }

    // Patch ID — white on dark, dark on light
    const bright = (r + g + b) / 3
    const textColor = bright < 110 ? [0, 0, 0, 0] : [0, 0, 0, 1]  // CMYK white or black
    doc.fontSize(7).fillColor(textColor)
       .text(`#${p.id}`, x + 2, y + SWATCH_H + 2, { width: CELL_W - 4, align: 'center' })

    // Recipe label
    doc.fontSize(5).fillColor([0, 0, 0, 0.75])
       .text(recipeLabel(p), x + 1, y + SWATCH_H + 13, { width: CELL_W - 2, align: 'center' })
  })

  // ── Legend ───────────────────────────────────────────────────────────────
  const legendY = GRID_Y + ROWS * CELL_H + 6
  doc.fontSize(6.5).fillColor([0, 0, 0, 0.5])
     .text(
       '── Solid border: device CMYK (exact values)    ╌ ╌ Dashed border: extended gamut O/G patch (approximate RGB — enter values in Flexpack manually)',
       MARGIN, legendY, { width: PAGE_W - MARGIN * 2 }
     )

  doc.end()
}
