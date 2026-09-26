const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];

const state = {
  access: null,
  bundle: [],
  items: [],
  selected: null,
  allWards: [],
  api: null,
};

bootstrap();

async function bootstrap() {
  setStatus('Loading manager data...', 'info');
  try {
    const [auth, db, app, renderer] = await Promise.all([
      import('./auth.js'),
      import('./database.js'),
      import('./app.js'),
      import('./report-renderer.js'),
    ]);
    state.api = { auth, db, app, renderer };

    bindCoreControls();

    const access = await auth.requireRole('manager');
    if (!access) return;
    state.access = access;

    app.setAppHeader({
      title: 'Patrol Night',
      subtitle: 'Nightly summary and complete ward reports',
      access,
    });

    const today = app.todayISO();
    $('#reportDate').value = today;
    $('#fullReportDate').value = today;

    await refresh();
    clearStatus();
  } catch (error) {
    console.error('Manager bootstrap failed:', error);
    showFatal(error);
  }
}

function bindCoreControls() {
  const { auth } = state.api;
  $('#logoutBtn').onclick = auth.signOut;
  $('#refreshBtn').onclick = refresh;
  $('#printBtn').onclick = printNightMemo;
  $('#reportDate').onchange = async () => {
    $('#fullReportDate').value = $('#reportDate').value;
    await refresh();
  };
  $('#memoSection').onchange = refresh;
  $('#fullWardSelect').onchange = loadFullWardReport;
  $('#loadFullReportBtn').onclick = loadFullWardReport;
  $('#fullReportPrintBtn').onclick = printSelectedFullReport;

  window.addEventListener('manager-tab-change', event => {
    if (event.detail?.name === 'template') sendTemplateContext();
  });
  window.addEventListener('message', event => {
    if (event.data?.type === 'manager-template-ready') sendTemplateContext();
  });
}

async function refresh() {
  if (!state.api) return;
  const { db, app } = state.api;
  const date = $('#reportDate').value || app.todayISO();
  const section = $('#memoSection').value || 'Male';

  setStatus('Refreshing...', 'info');
  $('#summaryRows').innerHTML = '<tr><td colspan="14">Loading...</td></tr>';
  $('#infectionRows').innerHTML = '<tr><td colspan="10">Loading...</td></tr>';

  try {
    const itemsPromise = db.getReportItems(date).catch(error => {
      console.warn('getReportItems failed:', error);
      return [];
    });
    const bundlePromise = db.getNightBundle(date, section);
    const wardsPromise = db.getWardsForDate
      ? db.getWardsForDate(date).catch(error => {
          console.warn('getWardsForDate failed:', error);
          return [];
        })
      : Promise.resolve([]);

    const [items, bundle, wards] = await Promise.all([itemsPromise, bundlePromise, wardsPromise]);
    state.items = items || [];
    state.bundle = bundle || [];
    state.allWards = (wards && wards.length) ? wards : state.bundle.map(x => x.ward);

    $('#sectionTitle').textContent = section;
    $('#printDateLabel').textContent = app.toDisplayDate(date);
    $('#fullReportDate').value = date;
    fillFullWardSelect();
    renderSummary();
    clearStatus();
    sendTemplateContext();
  } catch (error) {
    console.error('Manager refresh failed:', error);
    $('#summaryRows').innerHTML = `<tr><td colspan="14">Unable to load Night Memo data: ${escapeHtml(error.message || String(error))}</td></tr>`;
    $('#infectionRows').innerHTML = '<tr><td colspan="10">Data load failed. See the message above.</td></tr>';
    setStatus(`Unable to load report data: ${error.message || String(error)}`, 'error');
  }
}

function fillFullWardSelect() {
  const old = $('#fullWardSelect').value;
  $('#fullWardSelect').innerHTML = '<option value="">-- Select ward --</option>' + state.allWards
    .map(w => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.code)} - ${escapeHtml(w.display_name || w.code)}</option>`)
    .join('');
  if (state.allWards.some(w => w.id === old)) $('#fullWardSelect').value = old;
}

function countDev(value) {
  const numberValue = state.api?.app?.numberValue || (v => Number(v) || 0);
  if (!value) return 0;
  if (Array.isArray(value)) return value.length;
  if (value.mode === 'count') return numberValue(value.count);
  return (value.beds || []).length;
}

function bedText(value) {
  return Array.isArray(value) && value.length ? value.join(', ') : '--';
}

function devText(value) {
  const n = countDev(value);
  if (!value || !n) return '--';
  if (value.mode === 'count') return String(n);
  return `${n} (${(value.beds || []).join(', ')})`;
}

function emptyCell(ward, report, capacity) {
  if (!report) return '--';
  const D = report.payload || {};
  const numberValue = state.api?.app?.numberValue || (v => Number(v) || 0);
  const empty = D.emptyBeds || {
    count: Math.max(0, numberValue(capacity) - numberValue(D.totalPatientM)),
    details: [],
  };

  if (ward.empty_bed_gender_mode !== 'dynamic') return String(empty.count ?? 0);
  const details = empty.details || [];
  if (!details.length) return String(empty.count ?? 0);

  const m = details.filter(x => x.gender === 'M').length;
  const f = details.filter(x => x.gender === 'F').length;
  const other = details.length - m - f;
  const parts = [];
  if (m) parts.push(`${m}M`);
  if (f) parts.push(`${f}F`);
  if (other) parts.push(`${other}U`);
  const remarks = details.filter(x => x.remark)
    .map(x => `${x.gender || ''}${x.location ? ` bed ${x.location}` : ''}: ${x.remark}`);
  return `${parts.join(' / ')}${remarks.length ? ` - ${remarks.join('; ')}` : ''}`;
}

function buildSummaryRows(includeStatus = true) {
  return state.bundle.map(({ ward, capacity, report }) => {
    const D = report?.payload || {};
    const statusCell = includeStatus
      ? `<td class="screen-only-col">${report ? 'Submitted' : 'Not submitted'}</td>`
      : '';
    return `<tr class="${report ? 'submitted' : 'missing'}">
      <td class="ward-link" data-ward="${escapeHtml(ward.id)}">${escapeHtml(ward.code)}</td>
      <td>${escapeHtml(D.admissionEC || '--')}</td>
      <td>${escapeHtml(D.admissionCC || '--')}</td>
      <td>${escapeHtml(D.transferIn || '--')}</td>
      <td>${escapeHtml(D.discharge || '--')}</td>
      <td>${escapeHtml(D.transferOut || '--')}</td>
      <td>${escapeHtml(D.death || '--')}</td>
      <td>${escapeHtml(D.totalPatientM || '--')}</td>
      <td>${escapeHtml(emptyCell(ward, report, capacity))}</td>
      <td>${countDev(D.devBeds?.dMV) || '--'}</td>
      <td>${countDev(D.devBeds?.dNIV) || '--'}</td>
      <td>${countDev(D.devBeds?.dHF) || '--'}</td>
      <td>${report ? `${escapeHtml(D.staffAM || '--')} / ${escapeHtml(D.staffPM || '--')}` : '--'}</td>
      ${statusCell}
    </tr>`;
  }).join('');
}

function buildInfectionRows() {
  return state.bundle.map(({ ward, report }) => {
    const D = report?.payload || {};
    const early = (D.earlyBirds || []).map(x => `${x.bed || '?'} -> ${x.dest || '?'}`).join('; ') || '--';
    return `<tr>
      <td class="ward-link" data-ward="${escapeHtml(ward.id)}">${escapeHtml(ward.code)}</td>
      <td>${escapeHtml(bedText(D.infBeds?.iCOV))}</td>
      <td>${escapeHtml(bedText(D.infBeds?.iCRE))}</td>
      <td>${escapeHtml(bedText(D.infBeds?.iVRE))}</td>
      <td>${escapeHtml(bedText(D.infBeds?.iMDR))}</td>
      <td>${escapeHtml(bedText(D.infBeds?.iCD))}</td>
      <td>${escapeHtml(bedText(D.infBeds?.iInf))}</td>
      <td>${escapeHtml(devText(D.devBeds?.dHD))}</td>
      <td>${escapeHtml(devText(D.devBeds?.dCA))}</td>
      <td>${escapeHtml(early)}</td>
    </tr>`;
  }).join('');
}

function renderSummary() {
  $('#summaryRows').innerHTML = buildSummaryRows(true) || '<tr><td colspan="14">No wards configured for this section/date.</td></tr>';
  $('#infectionRows').innerHTML = buildInfectionRows() || '<tr><td colspan="10">No wards configured.</td></tr>';
  $$('.ward-link').forEach(el => {
    el.onclick = () => openWard(el.dataset.ward);
  });
}

async function openWard(wardId) {
  $('#fullWardSelect').value = wardId;
  if (window.showManagerPage) window.showManagerPage('full');
  await loadFullWardReport();
}

async function loadFullWardReport() {
  const wardId = $('#fullWardSelect').value;
  if (!wardId) {
    state.selected = null;
    $('#fullReportBody').innerHTML = '<div class="manager-empty-state">Select a ward to read its complete report.</div>';
    return;
  }

  const { db, renderer } = state.api;
  const date = $('#reportDate').value;
  const ward = state.allWards.find(w => w.id === wardId);
  if (!ward) {
    $('#fullReportBody').innerHTML = '<div class="manager-empty-state">Ward configuration was not found.</div>';
    return;
  }

  setStatus(`Loading ${ward.code}...`, 'info');
  try {
    const [report, capacity] = await Promise.all([
      db.getWardReport(wardId, date),
      db.getWardCapacity(wardId, date),
    ]);
    state.selected = { ward, report, capacity };
    $('#fullReportBody').innerHTML = renderer.renderFullReport({
      ward,
      report,
      capacity,
      items: state.items,
    });
    clearStatus();
  } catch (error) {
    console.error('Full report failed:', error);
    $('#fullReportBody').innerHTML = `<div class="manager-empty-state">Unable to load full report: ${escapeHtml(error.message || String(error))}</div>`;
    setStatus(`Unable to load full report: ${error.message || String(error)}`, 'error');
  }
}

async function printSelectedFullReport() {
  if (!state.selected) {
    setStatus('Select a ward first.', 'warning');
    return;
  }
  const { app, renderer } = state.api;
  const { ward, report, capacity } = state.selected;
  const html = renderer.renderFullReport({ ward, report, capacity, items: state.items });
  const win = window.open('', '_blank', 'width=1200,height=850');
  if (!win) {
    setStatus('Pop-up blocked. Allow pop-ups to print.', 'error');
    return;
  }
  const shellCss = new URL('./css/legacy-shell.css', location.href).href;
  const managerCss = new URL('./css/manager.css', location.href).href;
  const printCss = new URL('./css/print.css', location.href).href;
  const esc = app.esc || escapeHtml;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(ward.code)} ${esc($('#reportDate').value)}</title><link rel="stylesheet" href="${shellCss}"><link rel="stylesheet" href="${managerCss}"><link rel="stylesheet" href="${printCss}"></head><body class="legacy-page"><main class="legacy-shell"><div class="legacy-panel-body">${html}</div></main><script>setTimeout(()=>window.print(),500)<\/script></body></html>`);
  win.document.close();
}

function printNightMemo() {
  if (window.showManagerPage) window.showManagerPage('summary');
  const frame = $('#templateEditorFrame');
  if (frame && frame.src && frame.contentWindow) {
    frame.contentWindow.postMessage({ type: 'manager-template-print', context: templateContext() }, '*');
    setTimeout(() => {
      if (!document.hidden) window.print();
    }, 700);
    return;
  }
  setTimeout(() => window.print(), 0);
}

function templateContext() {
  const app = state.api?.app;
  const date = $('#reportDate')?.value || '';
  return {
    reportDate: date,
    reportDateDisplay: app?.toDisplayDate ? app.toDisplayDate(date) : date,
    section: $('#memoSection')?.value || '',
    wardSummaryTableHtml: managerSummaryTableHtml(),
    infectionTableHtml: infectionTableHtml(),
  };
}

function sendTemplateContext() {
  const frame = $('#templateEditorFrame');
  if (!frame || !frame.src || !frame.contentWindow) return;
  frame.contentWindow.postMessage({ type: 'manager-template-context', context: templateContext() }, '*');
}

function managerSummaryTableHtml() {
  return `<div class="table-scroll print-table-scroll"><table class="data-table manager-summary template-summary-table"><thead><tr><th rowspan="2">Ward</th><th colspan="3">Admission</th><th colspan="3">Discharge</th><th rowspan="2">Total Patient</th><th rowspan="2">Empty Bed</th><th rowspan="2">Vent Case</th><th rowspan="2">BiPAP Case</th><th rowspan="2">HFNC Case</th><th rowspan="2">Staff<br>AM/PM</th></tr><tr><th>E/C</th><th>C/C</th><th>T/I</th><th>Home</th><th>T/O</th><th>Death</th></tr></thead><tbody>${buildSummaryRows(false)}</tbody></table></div>`;
}

function infectionTableHtml() {
  return `<div class="table-scroll print-table-scroll"><table class="data-table manager-summary template-infection-table"><thead><tr><th>Ward</th><th>COVID-19</th><th>CRE</th><th>VRE</th><th>MDRA</th><th>CD</th><th>Influenza</th><th>HD</th><th>CAPD</th><th>Early Bird</th></tr></thead><tbody>${buildInfectionRows()}</tbody></table></div>`;
}

function setStatus(message, type='info') {
  const el = $('#managerStatus');
  if (!el) return;
  el.hidden = false;
  el.className = `manager-status no-print ${type}`;
  el.textContent = message;
}

function clearStatus() {
  const el = $('#managerStatus');
  if (!el) return;
  el.hidden = true;
  el.textContent = '';
}

function showFatal(error) {
  const message = error?.message || String(error);
  setStatus(`Manager page could not initialise: ${message}`, 'error');
  $('#summaryRows').innerHTML = `<tr><td colspan="14">Manager page could not initialise: ${escapeHtml(message)}</td></tr>`;
  $('#infectionRows').innerHTML = '<tr><td colspan="10">The tabs remain usable. Check the error message above.</td></tr>';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}
