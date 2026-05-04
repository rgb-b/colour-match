import {
  PDFDocument, StandardFonts,
  cmyk, PDFName, PDFNumber, PDFBool, PDFOperator,
} from 'pdf-lib'

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
    x: MARGIN, y: toY(PAGE_H, MARGIN, 10),
    size: 10, font, color: cmyk(0, 0, 0, 0.93),
  })

  const subtitle = `${new Date().toLocaleDateString('en-AU')}  ·  ${patches.length} patches  ·  Swatches are device CMYK — use numeric values for printing`
  page.drawText(subtitle, {
    x: PAGE_W - MARGIN - font.widthOfTextAtSize(subtitle, 7),
    y: toY(PAGE_H, MARGIN + 4, 7),
    size: 7, font, color: cmyk(0, 0, 0, 0.47),
  })

  page.drawLine({
    start: { x: MARGIN,          y: toY(PAGE_H, MARGIN + 18, 0) },
    end:   { x: PAGE_W - MARGIN, y: toY(PAGE_H, MARGIN + 18, 0) },
    thickness: 0.4, color: cmyk(0, 0, 0, 0.2),
  })

  // ── Patch grid ────────────────────────────────────────────────────────────
  for (let i = 0; i < patches.length; i++) {
    const p    = patches[i]
    const col  = i % COLS
    const row  = Math.floor(i / COLS)
    const x    = MARGIN + col * CELL_W
    const topY = GRID_Y + row * CELL_H

    // Swatch — device CMYK, no grey background (white layer covers full page)
    page.drawRectangle({
      x: x + 1,     y: toY(PAGE_H, topY + 1, SWATCH_H - 1),
      width: CELL_W - 2, height: SWATCH_H - 1,
      color: cmyk(p.c / 100, p.m / 100, p.y / 100, p.k / 100),
    })

    // Cell border
    page.drawRectangle({
      x: x + 0.5,   y: toY(PAGE_H, topY + 0.5, CELL_H - 1),
      width: CELL_W - 1, height: CELL_H - 1,
      borderColor: cmyk(0, 0, 0, 0.2), borderWidth: 0.3,
    })

    // Patch ID (white on dark, dark on light)
    const approxDark = (p.c + p.m + p.y) / 300 + p.k / 100
    const idText = `#${p.id}`
    page.drawText(idText, {
      x: x + (CELL_W - font.widthOfTextAtSize(idText, 6.5)) / 2,
      y: toY(PAGE_H, topY + SWATCH_H - 11, 6.5),
      size: 6.5, font,
      color: approxDark > 0.5 ? cmyk(0, 0, 0, 0) : cmyk(0, 0, 0, 0.8),
    })

    // CMYK recipe label
    const label = recipeLabel(p)
    page.drawText(label, {
      x: x + (CELL_W - font.widthOfTextAtSize(label, 5.5)) / 2,
      y: toY(PAGE_H, topY + SWATCH_H + 3, 5.5),
      size: 5.5, font, color: cmyk(0, 0, 0, 0.87),
    })
  }

  // ── White spot colour overprint layer ─────────────────────────────────────
  // Full-page /Separation/White covering everything.
  // RIP maps "White" → white ink. Visual alternate: M6 so the layer is
  // visible in Illustrator (this value is ignored during RIP).
  const ctx = pdfDoc.context

  // Type 2 linear function: tint 0→[0,0,0,0], tint 1→[0,0.06,0,0]
  const tintFnRef = ctx.register(ctx.obj({
    FunctionType: 2,
    Domain: [0, 1],
    C0: [0, 0, 0, 0],
    C1: [0, 0.06, 0, 0],
    N: 1,
  }))

  // [/Separation /White /DeviceCMYK tintFn]
  const whiteCS = ctx.obj([])
  whiteCS.push(PDFName.of('Separation'))
  whiteCS.push(PDFName.of('White'))
  whiteCS.push(PDFName.of('DeviceCMYK'))
  whiteCS.push(tintFnRef)
  const whiteCSRef = ctx.register(whiteCS)

  // ExtGState: fill overprint on
  const gState = ctx.obj({})
  gState.set(PDFName.of('op'),  PDFBool.True)
  gState.set(PDFName.of('OP'),  PDFBool.True)
  gState.set(PDFName.of('OPM'), PDFNumber.of(1))
  const gStateRef = ctx.register(gState)

  // Add resources to page
  const res = page.node.Resources()

  const csRes = ctx.obj({})
  csRes.set(PDFName.of('CS_White'), whiteCSRef)
  res.set(PDFName.of('ColorSpace'), csRes)

  const gsRes = ctx.obj({})
  gsRes.set(PDFName.of('GS_Overprint'), gStateRef)
  res.set(PDFName.of('ExtGState'), gsRes)

  // Draw white layer over everything
  page.pushOperators(
    PDFOperator.of('q'),
    PDFOperator.of('gs',  [PDFName.of('GS_Overprint')]),
    PDFOperator.of('cs',  [PDFName.of('CS_White')]),
    PDFOperator.of('scn', [PDFNumber.of(1)]),
    PDFOperator.of('re',  [
      PDFNumber.of(0), PDFNumber.of(0),
      PDFNumber.of(PAGE_W), PDFNumber.of(PAGE_H),
    ]),
    PDFOperator.of('f'),
    PDFOperator.of('Q'),
  )

  return pdfDoc.save()
}
