import PDFDocument from 'pdfkit'

// Returns { mode: 'cmyk', value: [c,m,y,k] } for pure CMYK patches,
// or { mode: 'rgb', value: [r,g,b] } for patches using O or G (approximated).
// pdfkit accepts CMYK as an array of 4 values 0–1, which produces true device CMYK
// in the PDF — no colour management conversion when opened in Illustrator etc.
function swatchColour(c, m, y, k, o, g) {
  if (o === 0 && g === 0) {
    return { mode: 'cmyk', value: [c/100, m/100, y/100, k/100] }
  }
  // O/G channels can't be represented in CMYK — approximate visually
  const mc = Math.min(100, m + o * 0.6)
  const yc = Math.min(100, y + o * 0.4 + g * 0.3)
  const cc = Math.min(100, c + g * 0.7)
  const r = Math.max(0, Math.min(255, Math.round(255 * (1 - cc/100) * (1 - k/100))))
  const gv = Math.max(0, Math.min(255, Math.round(255 * (1 - mc/100) * (1 - k/100))))
  const b = Math.max(0, Math.min(255, Math.round(255 * (1 - yc/100) * (1 - k/100))))
  return { mode: 'rgb', value: [r, gv, b] }
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

export function generateCalibrationPDF(printer, patches, outputStream) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28 })
  doc.pipe(outputStream)

  const PAGE_W = 841.89
  const PAGE_H = 595.28
  const MARGIN = 28
  const COLS   = 12
  const ROWS   = 8
  const PER_PAGE = COLS * ROWS  // 96

  const availW = PAGE_W - MARGIN * 2
  const availH = PAGE_H - MARGIN * 2 - 36  // 36 for header

  const cellW = availH / ROWS   // square-ish cells
  const cellH = availH / ROWS
  const GRID_W = cellW * COLS
  const GRID_X = MARGIN + (availW - GRID_W) / 2
  const GRID_Y = MARGIN + 36

  const SWATCH_H  = cellH * 0.62
  const TEXT_Y_ID = SWATCH_H + 2
  const TEXT_Y_RCP = SWATCH_H + 13

  let pageIndex = 0

  function drawHeader(pageNum, totalPages) {
    doc.fontSize(11).fillColor('#111111')
      .text(`Calibration Chart — ${printer.name}${printer.modeLabel ? ' · ' + printer.modeLabel : ''}`, MARGIN, MARGIN, { width: availW / 2 })
    doc.fontSize(9).fillColor('#666666')
      .text(
        `Generated ${new Date().toLocaleDateString('en-AU')}  ·  ${patches.length} patches  ·  Page ${pageNum}/${totalPages}`,
        MARGIN + availW / 2, MARGIN + 2,
        { align: 'right', width: availW / 2 }
      )
    doc.moveTo(MARGIN, MARGIN + 18).lineTo(PAGE_W - MARGIN, MARGIN + 18)
      .lineWidth(0.5).strokeColor('#cccccc').stroke()
  }

  const totalPages = Math.ceil(patches.length / PER_PAGE)

  patches.forEach((p, i) => {
    const posOnPage = i % PER_PAGE
    if (posOnPage === 0) {
      if (i > 0) doc.addPage()
      pageIndex++
      drawHeader(pageIndex, totalPages)
    }

    const col = posOnPage % COLS
    const row = Math.floor(posOnPage / COLS)
    const x   = GRID_X + col * cellW
    const y   = GRID_Y + row * cellH

    const sc = swatchColour(p.c, p.m, p.y, p.k, p.o, p.g)

    // Swatch
    doc.rect(x + 1, y + 1, cellW - 2, SWATCH_H - 1)
       .fillColor(sc.value).fill()

    // Border
    doc.rect(x + 1, y + 1, cellW - 2, cellH - 2)
       .lineWidth(0.3).strokeColor('#cccccc').stroke()

    // Patch ID — determine brightness for text contrast
    const [pr, pg, pb] = sc.mode === 'cmyk'
      ? [255*(1-sc.value[0])*(1-sc.value[3]), 255*(1-sc.value[1])*(1-sc.value[3]), 255*(1-sc.value[2])*(1-sc.value[3])]
      : sc.value
    const idColor = (pr + pg + pb) / 3 < 100 ? '#ffffff' : '#111111'
    doc.fontSize(7).fillColor(idColor)
       .text(`#${p.id}`, x + 2, y + TEXT_Y_ID, { width: cellW - 4, align: 'center' })

    // Recipe
    doc.fontSize(5).fillColor('#333333')
       .text(recipeLabel(p), x + 1, y + TEXT_Y_RCP, { width: cellW - 2, align: 'center' })
  })

  // ── Page 2 (or final pages): measurement recording table ────────────────
  doc.addPage()
  pageIndex++
  drawHeader(pageIndex, pageIndex)  // Update header for table pages

  doc.fontSize(10).fillColor('#111111')
     .text('Measurement Recording Sheet', MARGIN, MARGIN + 24)
  doc.fontSize(8).fillColor('#666666')
     .text('Enter L*, a*, b* values measured from each printed patch using a spectrophotometer.',
       MARGIN, MARGIN + 37)

  // Table header
  const COL_WIDTHS = [28, 28, 28, 28, 28, 28, 28, 28, 60, 60, 60]
  const COL_HEADERS = ['#', 'C', 'M', 'Y', 'K', 'O', 'G', 'Swatch', 'L*', 'a*', 'b*']
  const TABLE_X = MARGIN
  const TABLE_Y = MARGIN + 52
  const ROW_H   = 14
  const TABLE_W = COL_WIDTHS.reduce((a,b) => a+b, 0)

  function drawTableRow(rowData, ty, isHeader = false) {
    let cx = TABLE_X
    doc.rect(TABLE_X, ty, TABLE_W, ROW_H)
       .fillColor(isHeader ? '#f0f0f0' : '#ffffff').fill()
    doc.rect(TABLE_X, ty, TABLE_W, ROW_H)
       .lineWidth(0.3).strokeColor('#cccccc').stroke()

    rowData.forEach((val, ci) => {
      const cw = COL_WIDTHS[ci]
      if (ci === 7 && !isHeader) {
        // Swatch column — val is { mode, value } from swatchColour()
        const colour = (val && val.value) ? val.value : [0, 0, 0, 0]
        doc.rect(cx + 1, ty + 2, cw - 2, ROW_H - 4).fillColor(colour).fill()
      } else {
        doc.fontSize(isHeader ? 7 : 7)
           .fillColor(isHeader ? '#333333' : '#111111')
           .text(String(val), cx + 2, ty + 4, { width: cw - 4, align: 'center' })
      }
      cx += cw
    })
  }

  drawTableRow(COL_HEADERS, TABLE_Y, true)

  const TABLE_ROWS_PER_PAGE = Math.floor((PAGE_H - TABLE_Y - MARGIN - ROW_H) / ROW_H)

  patches.forEach((p, i) => {
    const rowOnPage = i % TABLE_ROWS_PER_PAGE
    if (i > 0 && rowOnPage === 0) {
      doc.addPage()
      pageIndex++
      drawHeader(pageIndex, pageIndex)
      drawTableRow(COL_HEADERS, TABLE_Y, true)
    }
    const ty = TABLE_Y + ROW_H + rowOnPage * ROW_H
    const sc2 = swatchColour(p.c, p.m, p.y, p.k, p.o, p.g)
    drawTableRow([p.id, p.c||'', p.m||'', p.y||'', p.k||'', p.o||'', p.g||'', sc2, '', '', ''], ty)
  })

  doc.end()
}
