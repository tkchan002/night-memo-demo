import { requireRole, signOut } from './auth.js';
import { getNightBundle, getReportItems, getWardCapacity, getWardsForDate, getWardReport } from './database.js';
import { qs, qsa, esc, todayISO, toDisplayDate, flash, setAppHeader, numberValue } from './app.js';
import { renderFullReport } from './report-renderer.js';

const state = {
  access: null,
  bundle: [],
  items: [],
  selected: null,
  allWards: [],
};

let templateEditorPromise = null;

init().catch(error => {
  console.error(error);
  flash(error.message || String(error), 'error', 8000);
});

async function init() {
  state.access = await requireRole('manager');
  if (!state.access) return;

  setAppHeader({
    title: 'Patrol Night',
    subtitle: 'Nightly summary and complete ward reports',
    access: state.access,
  });

  qs('#reportDate').value = todayISO();
  qs('#fullReportDate').value = qs('#reportDate').value;
  if (qs('#templateEffectiveFrom')) qs('#templateEffectiveFrom').value = todayISO();

  bind();
  await refresh();
}

function bind() {
  qs('#logoutBtn').onclick = signOut;
  qs('#refreshBtn').onclick = refresh;
  qs('#printBtn').onclick = printNightMemoSafe;
  qs('#reportDate').onchange = async () => {
    qs('#fullReportDate').value = qs('#reportDate').value;
    await refresh();
  };
  qs('#memoSection').onchange = refresh;

  qsa('[data-manager-tab]').forEach(button => {
    button.onclick = async () => {
      const name = button.dataset.managerTab;
      showManagerPage(name);
      if (name === 'template') await loadTemplateEditorSafe();
    };
  });

  qs('#fullWardSelect').onchange = loadFullWardReport;
  qs('#loadFullReportBtn').onclick = loadFullWardReport;
  qs('#fullReportPrintBtn').onclick = printSelectedFullReport;
}

function showManagerPage(name) {
  qsa('[data-manager-tab]').forEach(x => x.classList.toggle('active', x.dataset.managerTab === name));
  qsa('[data-manager-page]').forEach(x => x.classList.toggle('active', x.dataset.managerPage === name));
}

async function loadTemplateEditorSafe() {
  if (!templateEditorPromise) {
    templateEditorPromise = import('./manager-template-editor.js')
      .then(async module => {
        await module.initManagerTemplateEditor({
          showPage: showManagerPage,
          getContext: getTemplateContext,
        });
        return module;
      })
      .catch(error => {
        console.error('Print template editor failed to load:', error);
        templateEditorPromise = null;
        const page = qs('[data-manager-page="template"]');
        if (page) {
          let message = document.getElementById('templateEditorStatusMessage');
          if (!message) {
            message = document.createElement('div');
            message.id = 'templateEditorStatusMessage';
            message.className = 'template-editor-status';
            page.insertBefore(message, page.children[1] || null);
          }
          message.hidden = false;
          message.textContent = 'Print-template editor failed to load. Night Memo and Full Ward Report remain available. Check that manager-template-editor.js and manager-template-store.js were uploaded to the repository.';
        }
        flash('Print-template editor is unavailable, but the manager report is still working.', 'warning', 8000);
        return null;
      });
  }
  return templateEditorPromise;
}

async function refresh() {
  const date = qs('#reportDate').value;
  const section = qs('#memoSection').value;

  state.items = await getReportItems(date);
  state.bundle = await getNightBundle(date, section);
  state.allWards = await getWardsForDate(date);

  qs('#sectionTitle').textContent = section;
  qs('#printDateLabel').textContent = toDisplayDate(date);
  qs('#fullReportDate').value = date;

  fillFullWardSelect();
  renderSummary();
}

function fillFullWardSelect() {
  const old = qs('#fullWardSelect').value;
  qs('#fullWardSelect').innerHTML = '<option value="">-- Select ward --</option>' + state.allWards
    .map(w => `<option value="${esc(w.id)}">${esc(w.code)} - ${esc(w.display_name || w.code)}</option>`)
    .join('');
  if (state.allWards.some(w => w.id === old)) qs('#fullWardSelect').value = old;
}

function countDev(value) {
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

  const remarks = details
    .filter(x => x.remark)
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
      <td class="ward-link" data-ward="${esc(ward.id)}">${esc(ward.code)}</td>
      <td>${esc(D.admissionEC || '--')}</td>
      <td>${esc(D.admissionCC || '--')}</td>
      <td>${esc(D.transferIn || '--')}</td>
      <td>${esc(D.discharge || '--')}</td>
      <td>${esc(D.transferOut || '--')}</td>
      <td>${esc(D.death || '--')}</td>
      <td>${esc(D.totalPatientM || '--')}</td>
      <td>${esc(emptyCell(ward, report, capacity))}</td>
      <td>${countDev(D.devBeds?.dMV) || '--'}</td>
      <td>${countDev(D.devBeds?.dNIV) || '--'}</td>
      <td>${countDev(D.devBeds?.dHF) || '--'}</td>
      <td>${report ? `${esc(D.staffAM || '--')} / ${esc(D.staffPM || '--')}` : '--'}</td>
      ${statusCell}
    </tr>`;
  }).join('');
}

function buildInfectionRows() {
  return state.bundle.map(({ ward, report }) => {
    const D = report?.payload || {};
    const early = (D.earlyBirds || []).map(x => `${x.bed || '?'} -> ${x.dest || '?'}`).join('; ') || '--';
    return `<tr>
      <td class="ward-link" data-ward="${esc(ward.id)}">${esc(ward.code)}</td>
      <td>${esc(bedText(D.infBeds?.iCOV))}</td>
      <td>${esc(bedText(D.infBeds?.iCRE))}</td>
      <td>${esc(bedText(D.infBeds?.iVRE))}</td>
      <td>${esc(bedText(D.infBeds?.iMDR))}</td>
      <td>${esc(bedText(D.infBeds?.iCD))}</td>
      <td>${esc(bedText(D.infBeds?.iInf))}</td>
      <td>${esc(devText(D.devBeds?.dHD))}</td>
      <td>${esc(devText(D.devBeds?.dCA))}</td>
      <td>${esc(early)}</td>
    </tr>`;
  }).join('');
}

function renderSummary() {
  qs('#summaryRows').innerHTML = buildSummaryRows(true) || '<tr><td colspan="14">No wards configured for this section/date.</td></tr>';
  qs('#infectionRows').innerHTML = buildInfectionRows() || '<tr><td colspan="10">No wards configured.</td></tr>';
  qsa('.ward-link').forEach(el => {
    el.onclick = () => openWard(el.dataset.ward);
  });
}

function managerSummaryTableHtml() {
  return `<div class="table-scroll print-table-scroll"><table class="data-table manager-summary template-summary-table">
    <thead>
      <tr><th rowspan="2">Ward</th><th colspan="3">Admission</th><th colspan="3">Discharge</th><th rowspan="2">Total Patient</th><th rowspan="2">Empty Bed</th><th rowspan="2">Vent Case</th><th rowspan="2">BiPAP Case</th><th rowspan="2">HFNC Case</th><th rowspan="2">Staff<br>AM/PM</th></tr>
      <tr><th>E/C</th><th>C/C</th><th>T/I</th><th>Home</th><th>T/O</th><th>Death</th></tr>
    </thead>
    <tbody>${buildSummaryRows(false)}</tbody>
  </table></div>`;
}

function infectionTableHtml() {
  return `<div class="table-scroll print-table-scroll"><table class="data-table manager-summary template-infection-table">
    <thead><tr><th>Ward</th><th>COVID-19</th><th>CRE</th><th>VRE</th><th>MDRA</th><th>CD</th><th>Influenza</th><th>HD</th><th>CAPD</th><th>Early Bird</th></tr></thead>
    <tbody>${buildInfectionRows()}</tbody>
  </table></div>`;
}

function getTemplateContext() {
  return {
    reportDate: qs('#reportDate').value,
    reportDateDisplay: toDisplayDate(qs('#reportDate').value),
    section: qs('#memoSection').value,
    wardSummaryTableHtml: managerSummaryTableHtml(),
    infectionTableHtml: infectionTableHtml(),
  };
}

async function openWard(wardId) {
  qs('#fullWardSelect').value = wardId;
  showManagerPage('full');
  await loadFullWardReport();
}

async function loadFullWardReport() {
  const wardId = qs('#fullWardSelect').value;
  if (!wardId) {
    state.selected = null;
    qs('#fullReportBody').innerHTML = '<div class="manager-empty-state">Select a ward to read its complete report.</div>';
    return;
  }

  const date = qs('#reportDate').value;
  const ward = state.allWards.find(w => w.id === wardId);
  if (!ward) return;

  const [report, capacity] = await Promise.all([
    getWardReport(wardId, date),
    getWardCapacity(wardId, date),
  ]);

  state.selected = { ward, report, capacity };
  qs('#fullReportBody').innerHTML = renderFullReport({
    ward,
    report,
    capacity,
    items: state.items,
  });
}

async function printSelectedFullReport() {
  if (!state.selected) {
    flash('Select a ward first.', 'warning');
    return;
  }

  const { ward, report, capacity } = state.selected;
  const html = renderFullReport({ ward, report, capacity, items: state.items });
  const win = window.open('', '_blank', 'width=1200,height=850');
  if (!win) {
    flash('Pop-up blocked. Allow pop-ups to print.', 'error');
    return;
  }

  const shellCss = new URL('./css/legacy-shell.css', location.href).href;
  const managerCss = new URL('./css/manager.css', location.href).href;
  const printCss = new URL('./css/print.css', location.href).href;

  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(ward.code)} ${esc(qs('#reportDate').value)}</title><link rel="stylesheet" href="${shellCss}"><link rel="stylesheet" href="${managerCss}"><link rel="stylesheet" href="${printCss}"></head><body class="legacy-page"><main class="legacy-shell"><div class="legacy-panel-body">${html}</div></main><script>setTimeout(()=>window.print(),500)<\/script></body></html>`);
  win.document.close();
}

async function printNightMemoSafe() {
  showManagerPage('summary');
  try {
    const [{ getActiveManagerPrintTemplate }, editor] = await Promise.all([
      import('./manager-template-store.js'),
      import('./manager-template-editor.js'),
    ]);
    const template = await getActiveManagerPrintTemplate(qs('#reportDate').value);
    editor.printTemplateObject(template || editor.getDefaultTemplate());
  } catch (error) {
    console.warn('Custom print template unavailable. Falling back to standard manager print.', error);
    flash('Custom print template is unavailable. Printing the standard Night Memo layout instead.', 'warning', 6000);
    setTimeout(() => window.print(), 0);
  }
}
