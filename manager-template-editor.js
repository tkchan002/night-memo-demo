import { qs, qsa, esc, todayISO, flash } from './app.js';
import {
  getManagerPrintTemplates,
  saveManagerPrintTemplate,
  publishManagerPrintTemplate,
} from './manager-template-store.js';

const DEFAULT_TEMPLATE_HTML = `<div class="memo-template">
  <h1 style="text-align:center;text-decoration:underline;margin:0 0 4px">Night Memo ({{section}})</h1>
  <div style="text-align:center;margin-bottom:10px">{{report_date_display}}</div>
  {{ward_summary_table}}
  <h2 style="margin:16px 0 6px">Infection / Device Details</h2>
  {{infection_table}}
</div>`;

const TOKEN_LABELS = {
  report_date_display: 'Report Date',
  report_date: 'Report Date (ISO)',
  section: 'Memo Section',
  ward_summary_table: 'Ward Summary Table',
  infection_table: 'Infection / Device Table',
  page_break: 'Page Break',
};

let api = null;
let bound = false;
let state = {
  templates: [],
  editingTemplate: null,
  templateMode: 'visual',
};

export async function initManagerTemplateEditor(options) {
  api = options;
  if (!bound) bindEditor();
  try {
    await refreshTemplateList();
    setUnavailableMessage('');
    return true;
  } catch (error) {
    console.error('Manager template editor unavailable:', error);
    setUnavailableMessage(
      'The print-template editor could not connect to its Supabase table. The Night Memo and Full Ward Report tabs are still usable. Run the supplied manager-print-template-migration.sql in Supabase, then reload this page.'
    );
    disableTemplateActions(true);
    return false;
  }
}

function bindEditor() {
  bound = true;
  qs('#templateSelect').onchange = () => selectTemplate(qs('#templateSelect').value);
  qs('#newTemplateBtn').onclick = newTemplateDraft;
  qs('#saveTemplateBtn').onclick = saveTemplateDraft;
  qs('#publishTemplateBtn').onclick = publishTemplate;
  qs('#previewTemplateBtn').onclick = previewCurrentTemplate;

  qsa('[data-template-mode]').forEach(b => {
    b.onclick = () => setTemplateMode(b.dataset.templateMode);
  });
  qsa('#templateToolbar [data-cmd]').forEach(b => {
    b.onclick = () => runEditorCommand(b.dataset.cmd);
  });

  qs('#templateBlockFormat').onchange = event => {
    const editor = qs('#templateVisualEditor');
    editor.focus();
    document.execCommand('formatBlock', false, event.target.value);
  };

  qs('#insertTemplateToken').onchange = event => {
    if (event.target.value) insertToken(event.target.value);
    event.target.value = '';
  };
}

function setUnavailableMessage(message) {
  // The template editor runs inside manager-template.html in its own iframe.
  // Do not look for the parent manager page's [data-manager-page="template"]
  // element here; it does not exist inside this document.
  let el = document.getElementById('templateFrameStatus')
    || document.getElementById('templateEditorStatusMessage');

  if (!el) {
    el = document.createElement('div');
    el.id = 'templateEditorStatusMessage';
    el.className = 'manager-status error template-editor-status';

    const host = document.querySelector('.template-frame-main') || document.body;
    host.insertBefore(el, host.firstChild || null);
  }

  el.textContent = message || '';
  el.classList.toggle('error', !!message);
  el.hidden = !message;
}

function disableTemplateActions(disabled) {
  ['#saveTemplateBtn', '#publishTemplateBtn', '#previewTemplateBtn', '#newTemplateBtn']
    .forEach(sel => { const el = qs(sel); if (el) el.disabled = disabled; });
}

async function refreshTemplateList(selectId = null) {
  state.templates = await getManagerPrintTemplates();
  const sel = qs('#templateSelect');
  sel.innerHTML = state.templates
    .map(t => `<option value="${esc(t.id)}">v${esc(t.version)} - ${esc(t.name || 'Night Memo')} - ${esc(t.status)}</option>`)
    .join('');

  const chosen = selectId
    || state.editingTemplate?.id
    || state.templates.find(t => t.status === 'draft')?.id
    || state.templates.find(t => t.status === 'published')?.id
    || '';

  if (chosen && state.templates.some(t => t.id === chosen)) {
    sel.value = chosen;
    selectTemplate(chosen);
  } else {
    newTemplateDraft(false);
  }
}

function selectTemplate(id) {
  const t = state.templates.find(x => x.id === id);
  if (!t) return;
  state.editingTemplate = { ...t };
  qs('#templateName').value = t.name || 'Night Memo';
  qs('#templateEffectiveFrom').value = t.effective_from || todayISO();
  qs('#templateStatus').textContent = (t.status || 'draft').toUpperCase();
  qs('#templateHtmlEditor').value = t.html_template || DEFAULT_TEMPLATE_HTML;
  qs('#templateCssEditor').value = t.css_template || '';
  setVisualEditorFromTemplate(t.html_template || DEFAULT_TEMPLATE_HTML);
}

function newTemplateDraft(showPage = true) {
  const source = state.templates.find(t => t.status === 'published') || state.templates[0];
  state.editingTemplate = {
    id: null,
    name: `${source?.name || 'Night Memo'} Draft`,
    status: 'draft',
    effective_from: todayISO(),
    html_template: source?.html_template || DEFAULT_TEMPLATE_HTML,
    css_template: source?.css_template || '',
  };
  qs('#templateSelect').value = '';
  qs('#templateName').value = state.editingTemplate.name;
  qs('#templateEffectiveFrom').value = state.editingTemplate.effective_from;
  qs('#templateStatus').textContent = 'NEW DRAFT';
  qs('#templateHtmlEditor').value = state.editingTemplate.html_template;
  qs('#templateCssEditor').value = state.editingTemplate.css_template;
  setVisualEditorFromTemplate(state.editingTemplate.html_template);
  if (showPage && api?.showPage) api.showPage('template');
}

function setTemplateMode(mode) {
  if (mode === state.templateMode) return;
  if (mode === 'html') {
    qs('#templateHtmlEditor').value = visualEditorToTemplate();
  } else {
    setVisualEditorFromTemplate(qs('#templateHtmlEditor').value || DEFAULT_TEMPLATE_HTML);
  }
  state.templateMode = mode;
  qsa('[data-template-mode]').forEach(b => b.classList.toggle('active', b.dataset.templateMode === mode));
  qs('#visualEditorPane').classList.toggle('active', mode === 'visual');
  qs('#htmlEditorPane').classList.toggle('active', mode === 'html');
}

function templateToEditorHtml(html) {
  return String(html || '').replace(/\{\{([a-z0-9_]+)\}\}/gi, (match, token) => (
    `<span class="template-token" data-token="${esc(token)}" contenteditable="false">${esc(TOKEN_LABELS[token] || token)}</span>`
  ));
}

function setVisualEditorFromTemplate(html) {
  qs('#templateVisualEditor').innerHTML = templateToEditorHtml(sanitizeTemplateHtml(html || DEFAULT_TEMPLATE_HTML));
}

function visualEditorToTemplate() {
  const clone = qs('#templateVisualEditor').cloneNode(true);
  clone.querySelectorAll('.template-token').forEach(n => {
    n.replaceWith(document.createTextNode(`{{${n.dataset.token}}}`));
  });
  return sanitizeTemplateHtml(clone.innerHTML);
}

function runEditorCommand(cmd) {
  const editor = qs('#templateVisualEditor');
  editor.focus();
  document.execCommand(cmd, false, null);
}

function insertToken(token) {
  const editor = qs('#templateVisualEditor');
  editor.focus();
  const el = document.createElement('span');
  el.className = token === 'page_break' ? 'template-token template-token-block' : 'template-token';
  el.dataset.token = token;
  el.contentEditable = 'false';
  el.textContent = TOKEN_LABELS[token] || token;
  insertNodeAtSelection(el);
}

function insertNodeAtSelection(node) {
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    const editor = qs('#templateVisualEditor');
    if (editor.contains(range.commonAncestorContainer)) {
      range.deleteContents();
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
  }
  qs('#templateVisualEditor').appendChild(node);
}

function sanitizeTemplateHtml(raw) {
  const doc = new DOMParser().parseFromString(`<div id="root">${raw || ''}</div>`, 'text/html');
  const root = doc.querySelector('#root');
  root.querySelectorAll('script,iframe,object,embed,link,meta,form,input,button,textarea,select').forEach(n => n.remove());
  root.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => {
      const name = attr.name.toLowerCase();
      const value = attr.value || '';
      if (name.startsWith('on') || name === 'srcdoc' || (name === 'href' && /^\s*javascript:/i.test(value))) {
        el.removeAttribute(attr.name);
      }
      if (name === 'contenteditable' || name === 'data-token') el.removeAttribute(attr.name);
    });
  });
  return root.innerHTML;
}

function sanitizeTemplateCss(css) {
  return String(css || '')
    .replace(/@import[^;]+;?/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/url\s*\(\s*['"]?\s*javascript:[^)]+\)/gi, '');
}

function currentTemplatePayload() {
  const html = state.templateMode === 'visual'
    ? visualEditorToTemplate()
    : sanitizeTemplateHtml(qs('#templateHtmlEditor').value);
  return {
    ...(state.editingTemplate || {}),
    name: qs('#templateName').value.trim() || 'Night Memo',
    status: 'draft',
    effective_from: qs('#templateEffectiveFrom').value || todayISO(),
    html_template: html,
    css_template: sanitizeTemplateCss(qs('#templateCssEditor').value || ''),
  };
}

async function saveTemplateDraft() {
  try {
    const saved = await saveManagerPrintTemplate(currentTemplatePayload());
    state.editingTemplate = { ...saved };
    await refreshTemplateList(saved.id);
    flash('Print template draft saved.', 'success');
  } catch (error) {
    console.error(error);
    flash(error.message || String(error), 'error', 8000);
  }
}

async function publishTemplate() {
  try {
    const saved = await saveManagerPrintTemplate(currentTemplatePayload());
    const effective = qs('#templateEffectiveFrom').value || todayISO();
    await publishManagerPrintTemplate(saved.id, effective);
    state.editingTemplate = { ...saved, status: 'published', effective_from: effective };
    await refreshTemplateList(saved.id);
    flash(`Template published from ${effective}.`, 'success');
  } catch (error) {
    console.error(error);
    flash(error.message || String(error), 'error', 8000);
  }
}

function renderTemplateHtml(templateHtml) {
  const ctx = api?.getContext?.() || {};
  let out = sanitizeTemplateHtml(templateHtml || DEFAULT_TEMPLATE_HTML);
  const replacements = {
    report_date_display: ctx.reportDateDisplay || '',
    report_date: ctx.reportDate || '',
    section: ctx.section || '',
    ward_summary_table: ctx.wardSummaryTableHtml || '',
    infection_table: ctx.infectionTableHtml || '',
    page_break: '<div class="manager-page-break"></div>',
  };
  for (const [key, value] of Object.entries(replacements)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out.replace(/\{\{[a-z0-9_]+\}\}/gi, '');
}

function openTemplateWindow(template, autoPrint = false, title = 'Night Memo Preview') {
  const win = window.open('', '_blank', 'width=1250,height=900');
  if (!win) {
    flash('Pop-up blocked. Allow pop-ups to preview or print.', 'error');
    return;
  }
  const shellCss = new URL('./css/legacy-shell.css', location.href).href;
  const managerCss = new URL('./css/manager.css', location.href).href;
  const printCss = new URL('./css/print.css', location.href).href;
  const extraCss = sanitizeTemplateCss(template.css_template || '');
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><link rel="stylesheet" href="${shellCss}"><link rel="stylesheet" href="${managerCss}"><link rel="stylesheet" href="${printCss}"><style>${extraCss}</style></head><body class="legacy-page manager-template-output"><main class="manager-template-page">${renderTemplateHtml(template.html_template)}</main>${autoPrint ? '<script>setTimeout(()=>window.print(),600)<\/script>' : ''}</body></html>`);
  win.document.close();
}

function previewCurrentTemplate() {
  openTemplateWindow(currentTemplatePayload(), false, 'Night Memo Template Preview');
}

export function getDefaultTemplate() {
  return { name: 'Night Memo', html_template: DEFAULT_TEMPLATE_HTML, css_template: '' };
}

export function previewTemplateObject(template) {
  openTemplateWindow(template || getDefaultTemplate(), false, template?.name || 'Night Memo Preview');
}

export function printTemplateObject(template) {
  openTemplateWindow(template || getDefaultTemplate(), true, template?.name || 'Night Memo');
}
