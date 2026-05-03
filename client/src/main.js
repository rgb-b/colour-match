// ── API helpers ───────────────────────────────────────────────────────────
const api = {
  get:    (url)       => fetch(url).then(r => r.json()),
  post:   (url, body) => fetch(url, { method: 'POST',   headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),
  put:    (url, body) => fetch(url, { method: 'PUT',    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),
  delete: (url)       => fetch(url, { method: 'DELETE' }).then(r => r.json()),
}

// ── State ─────────────────────────────────────────────────────────────────
let state = {
  printers: [],
  activePrinterId: null,
  activeJob: null,
}

// ── LAB → RGB (approximate, for swatches) ────────────────────────────────
function labToRgb(L, a, b) {
  // LAB → XYZ (D65)
  let y = (L + 16) / 116
  let x = a / 500 + y
  let z = y - b / 200
  x = (x ** 3 > 0.008856 ? x ** 3 : (x - 16/116) / 7.787) * 0.95047
  y = (y ** 3 > 0.008856 ? y ** 3 : (y - 16/116) / 7.787) * 1.00000
  z = (z ** 3 > 0.008856 ? z ** 3 : (z - 16/116) / 7.787) * 1.08883
  // XYZ → linear RGB
  let r =  x * 3.2406 + y * -1.5372 + z * -0.4986
  let g =  x * -0.9689 + y * 1.8758 + z *  0.0415
  let bv = x *  0.0557 + y * -0.2040 + z *  1.0570
  // Gamma
  const gc = v => v > 0.0031308 ? 1.055 * v ** (1/2.4) - 0.055 : 12.92 * v
  r = Math.round(Math.min(1, Math.max(0, gc(r))) * 255)
  g = Math.round(Math.min(1, Math.max(0, gc(g))) * 255)
  bv = Math.round(Math.min(1, Math.max(0, gc(bv))) * 255)
  return `rgb(${r},${g},${bv})`
}

// ── ΔE guidance text ─────────────────────────────────────────────────────
function correctionGuide(dL, da, db) {
  const lines = []
  const fmt = (v) => (v > 0 ? '+' : '') + v.toFixed(2)
  if (Math.abs(dL) > 0.5)
    lines.push(`ΔL* ${fmt(dL)} → print is ${dL > 0 ? 'too light — increase K or reduce L-raising inks' : 'too dark — reduce K or add white/lightener'}`)
  if (Math.abs(da) > 0.5)
    lines.push(`Δa* ${fmt(da)} → result is ${da > 0 ? 'too red/magenta — reduce M or increase C/G' : 'too green — reduce C/G or increase M'}`)
  if (Math.abs(db) > 0.5)
    lines.push(`Δb* ${fmt(db)} → result is ${db > 0 ? 'too yellow — reduce Y or increase B/C' : 'too blue — reduce C or increase Y/O'}`)
  return lines.length ? lines.join('<br>') : 'Within tolerance on all axes.'
}

function deClass(de) {
  if (de == null) return 'none'
  if (de < 2)  return 'pass'
  if (de < 4)  return 'warn'
  return 'fail'
}
function deLabel(de) {
  if (de == null) return '—'
  if (de < 2)  return 'PASS'
  if (de < 4)  return 'CLOSE'
  return 'FAIL'
}

// ── Nav ───────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'))
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'))
    btn.classList.add('active')
    document.getElementById(`view-${btn.dataset.view}`).classList.add('active')
    if (btn.dataset.view === 'history') renderHistory()
    if (btn.dataset.view === 'inks') renderInks()
  })
})

// ── Printer select ────────────────────────────────────────────────────────
const printerSelect = document.getElementById('printer-select')

async function loadPrinters() {
  state.printers = await api.get('/api/printers')
  printerSelect.innerHTML = state.printers.map(p =>
    `<option value="${p.id}">${p.name}</option>`
  ).join('')
  if (state.printers.length) {
    state.activePrinterId = parseInt(printerSelect.value)
  }
}

printerSelect.addEventListener('change', () => {
  state.activePrinterId = parseInt(printerSelect.value)
})

// ── Match view ────────────────────────────────────────────────────────────
const jobNameInput    = document.getElementById('job-name')
const targetL         = document.getElementById('target-l')
const targetA         = document.getElementById('target-a')
const targetB         = document.getElementById('target-b')
const btnNewJob       = document.getElementById('btn-new-job')
const btnCancelJob    = document.getElementById('btn-cancel-job')
const btnLogAttempt   = document.getElementById('btn-log-attempt')
const btnLoadInk      = document.getElementById('btn-load-ink')
const targetSwatch    = document.getElementById('target-swatch')
const resultSwatch    = document.getElementById('result-swatch')

// Live swatch updates
;[targetL, targetA, targetB].forEach(el => el.addEventListener('input', updateTargetSwatch))
;[document.getElementById('result-l'), document.getElementById('result-a'), document.getElementById('result-b')]
  .forEach(el => el.addEventListener('input', updateResultSwatch))

function updateTargetSwatch() {
  const l = parseFloat(targetL.value), a = parseFloat(targetA.value), b = parseFloat(targetB.value)
  if (!isNaN(l) && !isNaN(a) && !isNaN(b))
    targetSwatch.style.background = labToRgb(l, a, b)
}
function updateResultSwatch() {
  const l = parseFloat(document.getElementById('result-l').value)
  const a = parseFloat(document.getElementById('result-a').value)
  const b = parseFloat(document.getElementById('result-b').value)
  if (!isNaN(l) && !isNaN(a) && !isNaN(b))
    resultSwatch.style.background = labToRgb(l, a, b)
}

btnNewJob.addEventListener('click', async () => {
  const name = jobNameInput.value.trim()
  const l = parseFloat(targetL.value), a = parseFloat(targetA.value), b = parseFloat(targetB.value)
  if (!name) { jobNameInput.focus(); return }
  if (isNaN(l) || isNaN(a) || isNaN(b)) { targetL.focus(); return }

  const job = await api.post('/api/jobs', {
    printer_id: state.activePrinterId,
    name,
    target_l: l, target_a: a, target_b: b
  })
  if (job.error) { alert(job.error); return }

  state.activeJob = job
  btnNewJob.textContent = 'Update Target'
  btnCancelJob.style.display = ''
  btnLogAttempt.disabled = false
  renderAttempts([])
  document.getElementById('results-empty').style.display = 'none'
  document.getElementById('results-content').style.display = ''
})

btnCancelJob.addEventListener('click', () => {
  state.activeJob = null
  btnNewJob.textContent = 'Start Job'
  btnCancelJob.style.display = 'none'
  btnLogAttempt.disabled = true
  document.getElementById('results-empty').style.display = ''
  document.getElementById('results-content').style.display = 'none'
  ;['ch-c','ch-m','ch-y','ch-k','ch-o','ch-g','result-l','result-a','result-b','attempt-notes']
    .forEach(id => document.getElementById(id).value = id.startsWith('ch') ? '0' : '')
  resultSwatch.style.background = ''
})

btnLogAttempt.addEventListener('click', async () => {
  if (!state.activeJob) return
  const recipe = getRecipe()
  const rl = parseFloat(document.getElementById('result-l').value)
  const ra = parseFloat(document.getElementById('result-a').value)
  const rb = parseFloat(document.getElementById('result-b').value)
  const notes = document.getElementById('attempt-notes').value.trim()

  const payload = { ...recipe, notes }
  if (!isNaN(rl) && !isNaN(ra) && !isNaN(rb)) {
    payload.result_l = rl; payload.result_a = ra; payload.result_b = rb
  }

  const attempt = await api.post(`/api/jobs/${state.activeJob.id}/attempts`, payload)
  if (attempt.error) { alert(attempt.error); return }

  // Reload full job
  state.activeJob = await api.get(`/api/jobs/${state.activeJob.id}`)
  renderAttempts(state.activeJob.attempts)

  // Clear result fields and notes for next attempt
  ;['result-l','result-a','result-b','attempt-notes'].forEach(id => document.getElementById(id).value = '')
  resultSwatch.style.background = ''
})

function getRecipe() {
  return {
    c: parseFloat(document.getElementById('ch-c').value) || 0,
    m: parseFloat(document.getElementById('ch-m').value) || 0,
    y: parseFloat(document.getElementById('ch-y').value) || 0,
    k: parseFloat(document.getElementById('ch-k').value) || 0,
    o: parseFloat(document.getElementById('ch-o').value) || 0,
    g: parseFloat(document.getElementById('ch-g').value) || 0,
  }
}

function recipeStr(a) {
  return `C${a.c} M${a.m} Y${a.y} K${a.k} O${a.o} G${a.g}`
}

function renderAttempts(attempts) {
  const list = document.getElementById('attempts-list')
  const deVal = document.getElementById('de-value')
  const deBadge = document.getElementById('de-badge')
  const dlVal = document.getElementById('dl-val')
  const daVal = document.getElementById('da-val')
  const dbVal = document.getElementById('db-val')
  const dlHint = document.getElementById('dl-hint')
  const daHint = document.getElementById('da-hint')
  const dbHint = document.getElementById('db-hint')
  const guide = document.getElementById('correction-guide')

  const last = attempts.filter(a => a.delta_e != null).at(-1)

  if (last) {
    deVal.textContent = last.delta_e.toFixed(2)
    deVal.className = `de-value ${deClass(last.delta_e)}`
    deBadge.textContent = deLabel(last.delta_e)
    deBadge.className = `de-badge ${deClass(last.delta_e)}`
    dlVal.textContent = (last.delta_l > 0 ? '+' : '') + last.delta_l.toFixed(2)
    daVal.textContent = (last.delta_a > 0 ? '+' : '') + last.delta_a.toFixed(2)
    dbVal.textContent = (last.delta_b > 0 ? '+' : '') + last.delta_b.toFixed(2)
    dlHint.textContent = last.delta_l > 0 ? 'too light' : last.delta_l < 0 ? 'too dark' : '✓'
    daHint.textContent = last.delta_a > 0 ? 'too red' : last.delta_a < 0 ? 'too green' : '✓'
    dbHint.textContent = last.delta_b > 0 ? 'too yellow' : last.delta_b < 0 ? 'too blue' : '✓'
    guide.innerHTML = correctionGuide(last.delta_l, last.delta_a, last.delta_b)
    // Update result swatch
    resultSwatch.style.background = labToRgb(last.result_l, last.result_a, last.result_b)
  }

  list.innerHTML = attempts.slice().reverse().map(a => `
    <div class="attempt-row ${a.delta_e != null ? deClass(a.delta_e) : ''}"
         data-attempt='${JSON.stringify(a)}'>
      <span class="attempt-num">#${a.attempt_number}</span>
      <span class="attempt-recipe">${recipeStr(a)}</span>
      ${a.delta_e != null
        ? `<span class="attempt-de ${deClass(a.delta_e)}">ΔE ${a.delta_e.toFixed(2)}</span>`
        : `<span class="attempt-de none">no scan</span>`}
    </div>
  `).join('')

  // Click attempt row to load recipe back into fields
  list.querySelectorAll('.attempt-row').forEach(row => {
    row.addEventListener('click', () => {
      const a = JSON.parse(row.dataset.attempt)
      ;['c','m','y','k','o','g'].forEach(ch => {
        document.getElementById(`ch-${ch}`).value = a[ch]
      })
    })
  })
}

// ── Load ink into recipe ───────────────────────────────────────────────────
btnLoadInk.addEventListener('click', async () => {
  const inks = await api.get('/api/inks')
  if (!inks.length) { alert('No custom inks saved yet. Add some in the Ink Library tab.'); return }
  openModal('Load Ink', `
    <div style="display:flex;flex-direction:column;gap:.5rem">
      ${inks.map(ink => `
        <button class="btn-ghost btn-sm" style="text-align:left;width:100%;padding:.5rem .75rem"
          data-ink='${JSON.stringify(ink)}'>
          <strong>${ink.name}</strong>
          <span style="font-size:11px;color:var(--muted);margin-left:.5rem;font-family:monospace">${recipeStr(ink)}</span>
        </button>
      `).join('')}
    </div>
  `)
  document.querySelectorAll('#modal-body [data-ink]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ink = JSON.parse(btn.dataset.ink)
      ;['c','m','y','k','o','g'].forEach(ch => {
        document.getElementById(`ch-${ch}`).value = ink[ch]
      })
      closeModal()
    })
  })
})

// ── History ───────────────────────────────────────────────────────────────
async function renderHistory() {
  const jobs = await api.get('/api/jobs')
  const search = document.getElementById('history-search').value.toLowerCase()
  const filtered = jobs.filter(j => j.name.toLowerCase().includes(search))
  const list = document.getElementById('history-list')
  if (!filtered.length) {
    list.innerHTML = '<p class="empty-state">No jobs yet.</p>'
    return
  }
  list.innerHTML = filtered.map(job => {
    const de = job.best_delta_e
    const cls = deClass(de)
    const lab = `L*${job.target_l} a*${job.target_a} b*${job.target_b}`
    const swatchBg = labToRgb(job.target_l, job.target_a, job.target_b)
    const date = new Date(job.created_at).toLocaleDateString()
    return `
      <div class="history-item" data-job-id="${job.id}">
        <div class="history-swatch" style="background:${swatchBg}"></div>
        <div class="history-info">
          <div class="history-name">${job.name}</div>
          <div class="history-meta">${lab} · ${job.attempt_count} attempt${job.attempt_count !== 1 ? 's' : ''} · ${job.printer_name || 'No printer'} · ${date}</div>
        </div>
        <div class="history-de ${cls}">${de != null ? 'ΔE ' + de.toFixed(2) : '—'}</div>
      </div>
    `
  }).join('')

  list.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', async () => {
      const job = await api.get(`/api/jobs/${item.dataset.jobId}`)
      loadJobIntoMatch(job)
    })
  })
}

document.getElementById('history-search').addEventListener('input', renderHistory)

function loadJobIntoMatch(job) {
  // Switch to match view
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'))
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'))
  document.querySelector('[data-view="match"]').classList.add('active')
  document.getElementById('view-match').classList.add('active')

  // Populate fields
  jobNameInput.value = job.name
  targetL.value = job.target_l
  targetA.value = job.target_a
  targetB.value = job.target_b
  updateTargetSwatch()

  state.activeJob = job
  btnNewJob.textContent = 'Update Target'
  btnCancelJob.style.display = ''
  btnLogAttempt.disabled = false
  document.getElementById('results-empty').style.display = 'none'
  document.getElementById('results-content').style.display = ''
  renderAttempts(job.attempts)

  // Pre-fill recipe from last attempt
  if (job.attempts.length) {
    const last = job.attempts.at(-1)
    ;['c','m','y','k','o','g'].forEach(ch => {
      document.getElementById(`ch-${ch}`).value = last[ch]
    })
  }
}

// ── Ink Library ───────────────────────────────────────────────────────────
async function renderInks() {
  const inks = await api.get('/api/inks')
  const list = document.getElementById('ink-list')
  if (!inks.length) {
    list.innerHTML = '<p class="empty-state" style="grid-column:1/-1">No custom inks yet.</p>'
    return
  }
  list.innerHTML = inks.map(ink => `
    <div class="ink-card">
      <div class="ink-card-header">
        <span class="ink-name">${ink.name}</span>
        <div class="ink-actions">
          <button class="btn-icon" data-edit="${ink.id}" title="Edit">✎</button>
          <button class="btn-icon" data-delete="${ink.id}" title="Delete">✕</button>
        </div>
      </div>
      <div class="ink-recipe">
        <span style="color:var(--c-color)">C${ink.c}</span>
        <span style="color:var(--m-color)">M${ink.m}</span>
        <span style="color:#b5a000">Y${ink.y}</span>
        <span style="color:var(--k-color)">K${ink.k}</span>
        <span style="color:var(--o-color)">O${ink.o}</span>
        <span style="color:var(--g-color)">G${ink.g}</span>
      </div>
      ${ink.notes ? `<div style="font-size:11px;color:var(--muted);margin-top:.4rem">${ink.notes}</div>` : ''}
    </div>
  `).join('')

  list.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this ink?')) return
      await api.delete(`/api/inks/${btn.dataset.delete}`)
      renderInks()
    })
  })
  list.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ink = inks.find(i => i.id === parseInt(btn.dataset.edit))
      openInkForm(ink)
    })
  })
}

document.getElementById('btn-add-ink').addEventListener('click', () => openInkForm())

function openInkForm(ink = null) {
  const isEdit = !!ink
  openModal(isEdit ? 'Edit Ink' : 'Add Custom Ink', `
    <div class="field"><label>Name</label>
      <input type="text" id="ink-form-name" value="${ink?.name || ''}" placeholder="e.g. Customer Red" /></div>
    <div class="cmykog-grid" style="margin-bottom:1rem">
      ${['c','m','y','k','o','g'].map(ch => `
        <div class="channel ${ch}">
          <label>${ch.toUpperCase()}</label>
          <input type="number" id="ink-form-${ch}" step="0.1" min="0" max="100" value="${ink?.[ch] ?? 0}" />
          <span>%</span>
        </div>`).join('')}
    </div>
    <div class="field"><label>Notes</label>
      <input type="text" id="ink-form-notes" value="${ink?.notes || ''}" placeholder="Optional" /></div>
    <button class="btn-primary" id="ink-form-save">${isEdit ? 'Save Changes' : 'Add Ink'}</button>
  `)

  document.getElementById('ink-form-save').addEventListener('click', async () => {
    const body = {
      name:  document.getElementById('ink-form-name').value.trim(),
      c: parseFloat(document.getElementById('ink-form-c').value) || 0,
      m: parseFloat(document.getElementById('ink-form-m').value) || 0,
      y: parseFloat(document.getElementById('ink-form-y').value) || 0,
      k: parseFloat(document.getElementById('ink-form-k').value) || 0,
      o: parseFloat(document.getElementById('ink-form-o').value) || 0,
      g: parseFloat(document.getElementById('ink-form-g').value) || 0,
      notes: document.getElementById('ink-form-notes').value.trim(),
    }
    if (!body.name) { document.getElementById('ink-form-name').focus(); return }
    const result = isEdit
      ? await api.put(`/api/inks/${ink.id}`, body)
      : await api.post('/api/inks', body)
    if (result.error) { alert(result.error); return }
    closeModal()
    renderInks()
  })
}

// ── Modal ─────────────────────────────────────────────────────────────────
function openModal(title, bodyHTML) {
  document.getElementById('modal-title').textContent = title
  document.getElementById('modal-body').innerHTML = bodyHTML
  document.getElementById('modal-overlay').style.display = 'flex'
}
function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none'
}
document.getElementById('modal-close').addEventListener('click', closeModal)
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal()
})

// ── Calibration ───────────────────────────────────────────────────────────
let activeCalMode = 'surface'

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    activeCalMode = btn.dataset.mode
    stopScan()
    renderCalibration()
  })
})

function cmykogToApproxRgb(c, m, y, k, o, g) {
  const mc = Math.min(100, m + o * 0.6)
  const yc = Math.min(100, y + o * 0.4 + g * 0.3)
  const cc = Math.min(100, c + g * 0.7)
  const r  = Math.max(0, Math.min(255, Math.round(255 * (1 - cc/100) * (1 - k/100))))
  const gv = Math.max(0, Math.min(255, Math.round(255 * (1 - mc/100) * (1 - k/100))))
  const b  = Math.max(0, Math.min(255, Math.round(255 * (1 - yc/100) * (1 - k/100))))
  return `rgb(${r},${gv},${b})`
}

async function renderCalibration() {
  if (!state.activePrinterId) return
  const data = await api.get(`/api/calibration/${state.activePrinterId}/${activeCalMode}/patches`)

  // Progress bar
  const pct = data.total ? (data.complete / data.total * 100) : 0
  document.getElementById('cal-progress-fill').style.width = pct + '%'
  document.getElementById('cal-progress-label').textContent =
    `${data.complete} / ${data.total} patches measured`

  // PDF link — mode-specific
  document.getElementById('btn-download-pdf').href =
    `/api/calibration/${state.activePrinterId}/${activeCalMode}/pdf`

  // Table
  const tbody = document.getElementById('cal-tbody')
  tbody.innerHTML = data.patches.map(p => {
    const hasMeasurement = p.measured_l !== null
    const swatchBg = cmykogToApproxRgb(p.c, p.m, p.y, p.k, p.o, p.g)
    return `
      <tr class="${hasMeasurement ? 'measured' : ''}" data-patch-id="${p.id}">
        <td><strong>${p.id}</strong></td>
        <td>${p.c || ''}</td>
        <td>${p.m || ''}</td>
        <td>${p.y || ''}</td>
        <td>${p.k || ''}</td>
        <td>${p.o || ''}</td>
        <td>${p.g || ''}</td>
        <td><span class="cal-swatch" style="background:${swatchBg}"></span></td>
        <td><input type="number" class="cal-l" step="0.01" min="0" max="100"
          value="${hasMeasurement ? p.measured_l : ''}" placeholder="L*" /></td>
        <td><input type="number" class="cal-a" step="0.01" min="-128" max="127"
          value="${hasMeasurement ? p.measured_a : ''}" placeholder="a*" /></td>
        <td><input type="number" class="cal-b" step="0.01" min="-128" max="127"
          value="${hasMeasurement ? p.measured_b : ''}" placeholder="b*" /></td>
        <td>
          <button class="btn-save-patch ${hasMeasurement ? 'saved' : ''}" data-id="${p.id}">
            ${hasMeasurement ? '✓' : 'Save'}
          </button>
        </td>
      </tr>
    `
  }).join('')

  // Manual save handlers
  tbody.querySelectorAll('.btn-save-patch').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('tr')
      const l = parseFloat(row.querySelector('.cal-l').value)
      const a = parseFloat(row.querySelector('.cal-a').value)
      const b = parseFloat(row.querySelector('.cal-b').value)
      if (isNaN(l) || isNaN(a) || isNaN(b)) {
        row.querySelector('.cal-l').focus(); return
      }
      await api.post(
        `/api/calibration/${state.activePrinterId}/${activeCalMode}/patches/${btn.dataset.id}`,
        { measured_l: l, measured_a: a, measured_b: b }
      )
      renderCalibration()
    })
  })

  // Tab/Enter on b* — advance to next row, or in scan mode auto-save and advance
  tbody.querySelectorAll('.cal-b').forEach((input, i) => {
    input.addEventListener('keydown', async e => {
      if ((e.key === 'Tab' && !e.shiftKey) || e.key === 'Enter') {
        e.preventDefault()
        if (scanActive) {
          await advanceScan()
        } else {
          const nextL = tbody.querySelectorAll('.cal-l')[i + 1]
          if (nextL) nextL.focus()
        }
      }
    })
  })
}

document.getElementById('btn-clear-cal').addEventListener('click', async () => {
  const modeLabel = activeCalMode.toUpperCase()
  if (!confirm(`Clear all ${modeLabel} measurements for this printer? This cannot be undone.`)) return
  stopScan()
  await api.delete(`/api/calibration/${state.activePrinterId}/${activeCalMode}/patches`)
  renderCalibration()
})

// ── Scan mode ─────────────────────────────────────────────────────────────
// Designed for use with X-Rite DataCatcher (keyboard wedge mode).
// DataCatcher injects L → Tab → a → Tab → b → Tab/Enter as keystrokes.
// Scan mode keeps focus on the current row's L* field, auto-saves when
// Tab/Enter is received on b*, and advances to the next patch.

let scanActive = false
let scanPos = 0

function getScanRows() {
  return Array.from(document.getElementById('cal-tbody').querySelectorAll('tr'))
}

function startScan() {
  const rows = getScanRows()
  if (!rows.length) return
  // Start from first unmeasured patch
  const firstUnmeasured = rows.findIndex(r => !r.classList.contains('measured'))
  scanPos = firstUnmeasured >= 0 ? firstUnmeasured : 0
  scanActive = true
  document.getElementById('btn-start-scan').textContent = '⏹ Stop'
  document.getElementById('btn-start-scan').classList.add('scanning')
  activateScanRow()
}

function stopScan() {
  scanActive = false
  getScanRows().forEach(r => r.classList.remove('scan-active'))
  document.getElementById('scan-toolbar').style.display = 'none'
  const btn = document.getElementById('btn-start-scan')
  if (btn) { btn.textContent = '▶ Scan'; btn.classList.remove('scanning') }
}

function activateScanRow() {
  const rows = getScanRows()
  rows.forEach(r => r.classList.remove('scan-active'))

  if (scanPos >= rows.length) { stopScan(); return }

  const row = rows[scanPos]
  row.classList.add('scan-active')
  row.scrollIntoView({ block: 'center', behavior: 'smooth' })

  const lInput = row.querySelector('.cal-l')
  if (lInput) { lInput.focus(); lInput.select() }

  // Toolbar
  const toolbar = document.getElementById('scan-toolbar')
  toolbar.style.display = 'flex'
  document.getElementById('scan-counter').textContent = `Patch ${scanPos + 1} of ${rows.length}`
  const statusEl = document.getElementById('scan-status')
  statusEl.textContent = row.classList.contains('measured') ? '(already measured — will overwrite)' : ''
}

async function saveScanCurrent() {
  const rows = getScanRows()
  if (scanPos >= rows.length) return false
  const row = rows[scanPos]
  const l = parseFloat(row.querySelector('.cal-l').value)
  const a = parseFloat(row.querySelector('.cal-a').value)
  const b = parseFloat(row.querySelector('.cal-b').value)
  if (isNaN(l) || isNaN(a) || isNaN(b)) return false

  const patchId = row.dataset.patchId
  await api.post(
    `/api/calibration/${state.activePrinterId}/${activeCalMode}/patches/${patchId}`,
    { measured_l: l, measured_a: a, measured_b: b }
  )

  row.classList.add('measured')
  row.classList.remove('scan-active')
  const btn = row.querySelector('.btn-save-patch')
  if (btn) { btn.textContent = '✓'; btn.classList.add('saved') }

  // Update progress bar in place (no full re-render)
  const allRows = getScanRows()
  const measuredCount = allRows.filter(r => r.classList.contains('measured')).length
  const total = allRows.length
  document.getElementById('cal-progress-fill').style.width = (measuredCount / total * 100) + '%'
  document.getElementById('cal-progress-label').textContent = `${measuredCount} / ${total} patches measured`

  return true
}

async function advanceScan() {
  await saveScanCurrent()
  scanPos++
  if (scanPos >= getScanRows().length) { stopScan(); return }
  activateScanRow()
}

function skipScan() {
  scanPos++
  if (scanPos >= getScanRows().length) { stopScan(); return }
  activateScanRow()
}

document.getElementById('btn-start-scan').addEventListener('click', () => {
  if (scanActive) stopScan()
  else startScan()
})
document.getElementById('btn-scan-skip').addEventListener('click', skipScan)
document.getElementById('btn-scan-stop').addEventListener('click', stopScan)

// ── Chart upload status ───────────────────────────────────────────────────
async function refreshChartStatus() {
  const status = await api.get('/api/calibration/charts/status')
  const labels = { 'no-white': 'status-no-white', 'white': 'status-white' }
  for (const [type, elId] of Object.entries(labels)) {
    const el = document.getElementById(elId)
    if (status[type]) {
      el.textContent = '✓ Uploaded'
      el.style.color = 'var(--pass)'
    } else {
      el.textContent = 'Not uploaded — auto-generated will be used'
      el.style.color = 'var(--muted)'
    }
  }
}

document.querySelectorAll('.chart-file-input').forEach(input => {
  input.addEventListener('change', async () => {
    const file = input.files[0]
    if (!file) return
    const type = input.dataset.type
    const label = input.closest('label')
    const formData = new FormData()
    formData.append('type', type)   // must come before the file
    formData.append('chart', file)
    label.style.opacity = '0.5'
    const r = await fetch('/api/calibration/charts/upload', { method: 'POST', body: formData })
    const result = await r.json()
    label.style.opacity = '1'
    input.value = ''
    if (result.ok) {
      refreshChartStatus()
    } else {
      alert(result.error || 'Upload failed')
    }
  })
})

// Trigger calibration load when tab is clicked
document.querySelector('[data-view="calibrate"]').addEventListener('click', () => {
  renderCalibration()
  refreshChartStatus()
})

// ── Init ──────────────────────────────────────────────────────────────────
loadPrinters()
