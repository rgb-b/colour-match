import { PDFDocument, cmyk, StandardFonts } from 'pdf-lib'

const MM = 72 / 25.4

function recipeLabel(p) {
  const parts = []
  if (p.c > 0) parts.push(`C${p.c}`)
  if (p.m > 0) parts.push(`M${p.m}`)
  if (p.y > 0) parts.push(`Y${p.y}`)
  if (p.k > 0) parts.push(`K${p.k}`)
  return parts.join(' ') || 'PAPER'
}

// Convert top-based Y to pdf-lib bottom-based Y
function toY(pageH, topY, elemH) {
  return pageH - topY - elemH
}

// Returns Uint8Array
export async function generateCalibrationPDF(printer, patches) {
  const COLS   = 12
  const ROWS   = Math.ceil(patches.length / COLS)
  const MARGIN = 14 * MM
  const HEADER = 26
  const PAGE_W = 560 * MM
  const CELL_W = (PAGE_W - MARGIN * 2) / COLS
  const CELL_H = Math.round(CELL_W * 0.76)
  const PAGE_H = MARGIN + HEADER + CELL_H * ROWS + MARGIN
  const GRID_Y = MARGIN + HEADER
  const SWATCH_H = Math.round(CELL_H * 0.55)

  const pdfDoc = await PDFDocument.create()
  const page   = pdfDoc.addPage([PAGE_W, PAGE_H])
  const font   = await pdfDoc.embedFont(StandardFonts.Helvetica)

  // ── Header ────────────────────────────────────────────────────────────────
  const title = `Calibration Chart — ${printer.name}${printer.modeLabel ? ' · ' + printer.modeLabel : ''}`
  page.drawText(title, {
    x: MARGIN,
    y: toY(PAGE_H, MARGIN, 10),
    size: 10,
    font,
    color: cmyk(0, 0, 0, 0.93),
  })

  const subtitle = `${new Date().toLocaleDateString('en-AU')}  ·  ${patches.length} patches  ·  Swatches are device CMYK — use numeric values for printing`
  const subW = font.widthOfTextAtSize(subtitle, 7)
  page.drawText(subtitle, {
    x: PAGE_W - MARGIN - subW,
    y: toY(PAGE_H, MARGIN + 4, 7),
    size: 7,
    font,
    color: cmyk(0, 0, 0, 0.47),
  })

  page.drawLine({
    start: { x: MARGIN,           y: toY(PAGE_H, MARGIN + 18, 0) },
    end:   { x: PAGE_W - MARGIN,  y: toY(PAGE_H, MARGIN + 18, 0) },
    thickness: 0.4,
    color: cmyk(0, 0, 0, 0.2),
  })

  // ── Patch grid ────────────────────────────────────────────────────────────
  for (let i = 0; i < patches.length; i++) {
    const p    = patches[i]
    const col  = i % COLS
    const row  = Math.floor(i / COLS)
    const x    = MARGIN + col * CELL_W
    const topY = GRID_Y + row * CELL_H

    // Cell background
    page.drawRectangle({
      x:      x + 0.5,
      y:      toY(PAGE_H, topY + 0.5, CELL_H - 1),
      width:  CELL_W - 1,
      height: CELL_H - 1,
      color:  cmyk(0, 0, 0, 0.06),
    })

    // Colour swatch — device CMYK
    page.drawRectangle({
      x:      x + 1,
      y:      toY(PAGE_H, topY + 1, SWATCH_H - 1),
      width:  CELL_W - 2,
      height: SWATCH_H - 1,
      color:  cmyk(p.c / 100, p.m / 100, p.y / 100, p.k / 100),
    })

    // Cell border
    page.drawRectangle({
      x:           x + 0.5,
      y:           toY(PAGE_H, topY + 0.5, CELL_H - 1),
      width:       CELL_W - 1,
      height:      CELL_H - 1,
      borderColor: cmyk(0, 0, 0, 0.2),
      borderWidth: 0.3,
    })

    // Patch ID — white text on dark patches, dark on light
    const approxDark = (p.c + p.m + p.y) / 300 + p.k / 100
    const idColor = approxDark > 0.5 ? cmyk(0, 0, 0, 0) : cmyk(0, 0, 0, 0.8)
    const idText  = `#${p.id}`
    const idW     = font.widthOfTextAtSize(idText, 6.5)
    page.drawText(idText, {
      x:    x + (CELL_W - idW) / 2,
      y:    toY(PAGE_H, topY + SWATCH_H - 11, 6.5),
      size: 6.5,
      font,
      color: idColor,
    })

    // CMYK recipe label
    const label  = recipeLabel(p)
    const labelW = font.widthOfTextAtSize(label, 5.5)
    page.drawText(label, {
      x:    x + (CELL_W - labelW) / 2,
      y:    toY(PAGE_H, topY + SWATCH_H + 3, 5.5),
      size: 5.5,
      font,
      color: cmyk(0, 0, 0, 0.87),
    })
  }

  return pdfDoc.save()
}
