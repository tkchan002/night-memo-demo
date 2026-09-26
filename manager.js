import { requireRole, signOut } from './auth.js';
import {
  getNightBundle, getReportItems, getWardCapacity, getWardsForDate, getWardReport,
  getManagerPrintTemplates, getActiveManagerPrintTemplate, saveManagerPrintTemplate,
  publishManagerPrintTemplate
} from './database.js';
import { qs,qsa,esc,todayISO,toDisplayDate,flash,setAppHeader,numberValue } from './app.js';
import { renderFullReport } from './report-renderer.js';

const DEFAULT_TEMPLATE_HTML = `<div class="memo-template">
  <h1 style="text-align:center;text-decoration:underline;margin:0 0 4px">Night Memo ({{section}})</h1>
  <div style="text-align:center;margin-bottom:10px">{{report_date_display}}</div>
  {{ward_summary_table}}
  <h2 style="margin:16px 0 6px">Infection / Device Details</h2>
  {{infection_table}}
</div>`;

const TOKEN_LABELS = {
  report_date_display:'Report Date', report_date:'Report Date (ISO)', section:'Memo Section',
  ward_summary_table:'Ward Summary Table', infection_table:'Infection / Device Table', page_break:'Page Break'
};

const state={access:null,bundle:[],items:[],selected:null,allWards:[],templates:[],editingTemplate:null,templateMode:'visual'};
init().catch(e=>{console.error(e);flash(e.message||String(e),'error',8000)});

async function init(){
  state.access=await requireRole('manager');
  if(!state.access)return;
  setAppHeader({title:'Patrol Night',subtitle:'Nightly summary and complete ward reports',access:state.access});
  qs('#reportDate').value=todayISO();
  qs('#fullReportDate').value=qs('#reportDate').value;
  qs('#templateEffectiveFrom').value=todayISO();
  bind();
  await refresh();
  await refreshTemplateList();
}

function bind(){
  qs('#logoutBtn').onclick=signOut;
  qs('#refreshBtn').onclick=refresh;
  qs('#printBtn').onclick=printNightMemo;
  qs('#reportDate').onchange=async()=>{qs('#fullReportDate').value=qs('#reportDate').value;await refresh();};
  qs('#memoSection').onchange=refresh;
  qsa('[data-manager-tab]').forEach(b=>b.onclick=()=>showManagerPage(b.dataset.managerTab));
  qs('#fullWardSelect').onchange=loadFullWardReport;
  qs('#loadFullReportBtn').onclick=loadFullWardReport;
  qs('#fullReportPrintBtn').onclick=printSelectedFullReport;

  qs('#templateSelect').onchange=()=>selectTemplate(qs('#templateSelect').value);
  qs('#newTemplateBtn').onclick=newTemplateDraft;
  qs('#saveTemplateBtn').onclick=saveTemplateDraft;
  qs('#publishTemplateBtn').onclick=publishTemplate;
  qs('#previewTemplateBtn').onclick=previewCurrentTemplate;
  qsa('[data-template-mode]').forEach(b=>b.onclick=()=>setTemplateMode(b.dataset.templateMode));
  qsa('#templateToolbar [data-cmd]').forEach(b=>b.onclick=()=>runEditorCommand(b.dataset.cmd));
  qs('#templateBlockFormat').onchange=e=>{document.execCommand('formatBlock',false,e.target.value);qs('#templateVisualEditor').focus();};
  qs('#insertTemplateToken').onchange=e=>{if(e.target.value)insertToken(e.target.value);e.target.value='';};
  qs('#templateHtmlEditor').addEventListener('input',()=>{ if(state.templateMode==='html') state.editingTemplate={...(state.editingTemplate||{}),html_template:qs('#templateHtmlEditor').value}; });
  qs('#templateCssEditor').addEventListener('input',()=>{ if(state.editingTemplate) state.editingTemplate.css_template=qs('#templateCssEditor').value; });
}

function showManagerPage(name){
  qsa('[data-manager-tab]').forEach(x=>x.classList.toggle('active',x.dataset.managerTab===name));
  qsa('[data-manager-page]').forEach(x=>x.classList.toggle('active',x.dataset.managerPage===name));
}

async function refresh(){
  const date=qs('#reportDate').value,section=qs('#memoSection').value;
  state.items=await getReportItems(date);
  state.bundle=await getNightBundle(date,section);
  state.allWards=await getWardsForDate(date);
  qs('#sectionTitle').textContent=section;
  qs('#printDateLabel').textContent=toDisplayDate(date);
  qs('#fullReportDate').value=date;
  fillFullWardSelect();
  renderSummary();
}

function fillFullWardSelect(){
  const old=qs('#fullWardSelect').value;
  qs('#fullWardSelect').innerHTML='<option value="">— Select ward —</option>'+state.allWards.map(w=>`<option value="${esc(w.id)}">${esc(w.code)} — ${esc(w.display_name||w.code)}</option>`).join('');
  if(state.allWards.some(w=>w.id===old))qs('#fullWardSelect').value=old;
}

function countDev(v){if(!v)return 0;if(Array.isArray(v))return v.length;if(v.mode==='count')return numberValue(v.count);return (v.beds||[]).length;}
function bedText(v){return Array.isArray(v)&&v.length?v.join(', '):'—';}
function devText(v){const n=countDev(v);if(!v||!n)return'—';if(v.mode==='count')return String(n);return `${n} (${(v.beds||[]).join(', ')})`;}
function emptyCell(ward,report,capacity){
  if(!report)return'—';
  const D=report.payload||{},e=D.emptyBeds||{count:Math.max(0,numberValue(capacity)-numberValue(D.totalPatientM)),details:[]};
  if(ward.empty_bed_gender_mode!=='dynamic')return String(e.count??0);
  const d=e.details||[];if(!d.length)return String(e.count??0);
  const m=d.filter(x=>x.gender==='M').length,f=d.filter(x=>x.gender==='F').length,other=d.length-m-f;
  const parts=[];if(m)parts.push(`${m}M`);if(f)parts.push(`${f}F`);if(other)parts.push(`${other}U`);
  const remarks=d.filter(x=>x.remark).map(x=>`${x.gender||''}${x.location?` bed ${x.location}`:''}: ${x.remark}`);
  return `${parts.join(' / ')}${remarks.length?` · ${remarks.join('; ')}`:''}`;
}

function buildSummaryRows(){
  return state.bundle.map(({ward,capacity,report})=>{const D=report?.payload||{};return `<tr class="${report?'submitted':'missing'}"><td class="ward-link" data-ward="${esc(ward.id)}">${esc(ward.code)}</td><td>${esc(D.admissionEC||'—')}</td><td>${esc(D.admissionCC||'—')}</td><td>${esc(D.transferIn||'—')}</td><td>${esc(D.discharge||'—')}</td><td>${esc(D.transferOut||'—')}</td><td>${esc(D.death||'—')}</td><td>${esc(D.totalPatientM||'—')}</td><td>${esc(emptyCell(ward,report,capacity))}</td><td>${countDev(D.devBeds?.dMV)||'—'}</td><td>${countDev(D.devBeds?.dNIV)||'—'}</td><td>${countDev(D.devBeds?.dHF)||'—'}</td><td>${report?`${esc(D.staffAM||'—')} / ${esc(D.staffPM||'—')}`:'—'}</td><td class="screen-only-col">${report?'Submitted':'Not submitted'}</td></tr>`;}).join('');
}

function buildInfectionRows(){
  return state.bundle.map(({ward,report})=>{const D=report?.payload||{};const e=(D.earlyBirds||[]).map(x=>`${x.bed||'?'}→${x.dest||'?'}`).join('; ')||'—';return `<tr><td class="ward-link" data-ward="${esc(ward.id)}">${esc(ward.code)}</td><td>${esc(bedText(D.infBeds?.iCOV))}</td><td>${esc(bedText(D.infBeds?.iCRE))}</td><td>${esc(bedText(D.infBeds?.iVRE))}</td><td>${esc(bedText(D.infBeds?.iMDR))}</td><td>${esc(bedText(D.infBeds?.iCD))}</td><td>${esc(bedText(D.infBeds?.iInf))}</td><td>${esc(devText(D.devBeds?.dHD))}</td><td>${esc(devText(D.devBeds?.dCA))}</td><td>${esc(e)}</td></tr>`;}).join('');
}

function renderSummary(){
  qs('#summaryRows').innerHTML=buildSummaryRows()||'<tr><td colspan="14">No wards configured for this section/date.</td></tr>';
  qs('#infectionRows').innerHTML=buildInfectionRows()||'<tr><td colspan="10">No wards configured.</td></tr>';
  qsa('.ward-link').forEach(el=>el.onclick=()=>openWard(el.dataset.ward));
}

function managerSummaryTableHtml(){
  return `<div class="table-scroll print-table-scroll"><table class="data-table manager-summary template-summary-table"><thead><tr><th rowspan="2">Ward</th><th colspan="3">Admission</th><th colspan="3">Discharge</th><th rowspan="2">Total Patient</th><th rowspan="2">Empty Bed</th><th rowspan="2">Vent Case</th><th rowspan="2">BiPAP Case</th><th rowspan="2">HFNC Case</th><th rowspan="2">Staff<br>AM/PM</th></tr><tr><th>E/C</th><th>C/C</th><th>T/I</th><th>Home</th><th>T/O</th><th>Death</th></tr></thead><tbody>${buildSummaryRows().replaceAll(' class="screen-only-col"',' style="display:none"').replace(/<td style="display:none">.*?<\/td>/g,'')}</tbody></table></div>`;
}

function infectionTableHtml(){
  return `<div class="table-scroll print-table-scroll"><table class="data-table manager-summary template-infection-table"><thead><tr><th>Ward</th><th>COVID-19</th><th>CRE</th><th>VRE</th><th>MDRA</th><th>CD</th><th>Influenza</th><th>HD</th><th>CAPD</th><th>Early Bird</th></tr></thead><tbody>${buildInfectionRows()}</tbody></table></div>`;
}

async function openWard(wardId){qs('#fullWardSelect').value=wardId;showManagerPage('full');await loadFullWardReport();}

async function loadFullWardReport(){
  const wardId=qs('#fullWardSelect').value;
  if(!wardId){state.selected=null;qs('#fullReportBody').innerHTML='<div class="manager-empty-state">Select a ward to read its complete report.</div>';return;}
  const date=qs('#reportDate').value,ward=state.allWards.find(w=>w.id===wardId);if(!ward)return;
  const [report,capacity]=await Promise.all([getWardReport(wardId,date),getWardCapacity(wardId,date)]);
  state.selected={ward,report,capacity};
  qs('#fullReportBody').innerHTML=renderFullReport({ward,report,capacity,items:state.items});
}

async function printSelectedFullReport(){
  if(!state.selected){flash('Select a ward first.','warning');return;}
  const {ward,report,capacity}=state.selected,html=renderFullReport({ward,report,capacity,items:state.items});
  const win=window.open('','_blank','width=1200,height=850');if(!win){flash('Pop-up blocked. Allow pop-ups to print.','error');return;}
  const shellCss=new URL('./css/legacy-shell.css',location.href).href,managerCss=new URL('./css/manager.css',location.href).href,printCss=new URL('./css/print.css',location.href).href;
  win.document.write(`<!doctype html><html><head><title>${esc(ward.code)} ${esc(qs('#reportDate').value)}</title><link rel="stylesheet" href="${shellCss}"><link rel="stylesheet" href="${managerCss}"><link rel="stylesheet" href="${printCss}"></head><body class="legacy-page"><main class="legacy-shell"><div class="legacy-panel-body">${html}</div></main><script>setTimeout(()=>window.print(),500)<\/script></body></html>`);win.document.close();
}

// ---------------- Manager print template editor ----------------
async function refreshTemplateList(selectId=null){
  state.templates=await getManagerPrintTemplates();
  const sel=qs('#templateSelect');
  sel.innerHTML=state.templates.map(t=>`<option value="${esc(t.id)}">v${esc(t.version)} · ${esc(t.name||'Night Memo')} · ${esc(t.status)}</option>`).join('');
  let chosen=selectId || state.editingTemplate?.id || state.templates.find(t=>t.status==='draft')?.id || state.templates.find(t=>t.status==='published')?.id || '';
  if(chosen && state.templates.some(t=>t.id===chosen)){sel.value=chosen;selectTemplate(chosen);}
  else newTemplateDraft();
}

function selectTemplate(id){
  const t=state.templates.find(x=>x.id===id);if(!t)return;
  state.editingTemplate={...t};
  qs('#templateName').value=t.name||'Night Memo';
  qs('#templateEffectiveFrom').value=t.effective_from||todayISO();
  qs('#templateStatus').textContent=(t.status||'draft').toUpperCase();
  qs('#templateHtmlEditor').value=t.html_template||DEFAULT_TEMPLATE_HTML;
  qs('#templateCssEditor').value=t.css_template||'';
  setVisualEditorFromTemplate(t.html_template||DEFAULT_TEMPLATE_HTML);
}

function newTemplateDraft(){
  const source=state.templates.find(t=>t.status==='published') || state.templates[0];
  state.editingTemplate={id:null,name:(source?.name||'Night Memo')+' Draft',status:'draft',effective_from:todayISO(),html_template:source?.html_template||DEFAULT_TEMPLATE_HTML,css_template:source?.css_template||''};
  qs('#templateSelect').value='';
  qs('#templateName').value=state.editingTemplate.name;
  qs('#templateEffectiveFrom').value=state.editingTemplate.effective_from;
  qs('#templateStatus').textContent='NEW DRAFT';
  qs('#templateHtmlEditor').value=state.editingTemplate.html_template;
  qs('#templateCssEditor').value=state.editingTemplate.css_template;
  setVisualEditorFromTemplate(state.editingTemplate.html_template);
  showManagerPage('template');
}

function setTemplateMode(mode){
  if(mode===state.templateMode)return;
  if(mode==='html'){
    qs('#templateHtmlEditor').value=visualEditorToTemplate();
  }else{
    setVisualEditorFromTemplate(qs('#templateHtmlEditor').value||DEFAULT_TEMPLATE_HTML);
  }
  state.templateMode=mode;
  qsa('[data-template-mode]').forEach(b=>b.classList.toggle('active',b.dataset.templateMode===mode));
  qs('#visualEditorPane').classList.toggle('active',mode==='visual');
  qs('#htmlEditorPane').classList.toggle('active',mode==='html');
}

function templateToEditorHtml(html){
  return String(html||'').replace(/\{\{([a-z0-9_]+)\}\}/gi,(m,t)=>`<span class="template-token" data-token="${esc(t)}" contenteditable="false">${esc(TOKEN_LABELS[t]||t)}</span>`);
}
function setVisualEditorFromTemplate(html){qs('#templateVisualEditor').innerHTML=templateToEditorHtml(sanitizeTemplateHtml(html||DEFAULT_TEMPLATE_HTML));}
function visualEditorToTemplate(){
  const clone=qs('#templateVisualEditor').cloneNode(true);
  clone.querySelectorAll('.template-token').forEach(n=>n.replaceWith(document.createTextNode(`{{${n.dataset.token}}}`)));
  return sanitizeTemplateHtml(clone.innerHTML);
}

function runEditorCommand(cmd){
  qs('#templateVisualEditor').focus();
  document.execCommand(cmd,false,null);
}

function insertToken(token){
  const editor=qs('#templateVisualEditor');editor.focus();
  if(token==='page_break'){
    const el=document.createElement('span');el.className='template-token template-token-block';el.dataset.token=token;el.contentEditable='false';el.textContent=TOKEN_LABELS[token];
    insertNodeAtSelection(el);return;
  }
  const el=document.createElement('span');el.className='template-token';el.dataset.token=token;el.contentEditable='false';el.textContent=TOKEN_LABELS[token]||token;
  insertNodeAtSelection(el);
}
function insertNodeAtSelection(node){
  const sel=window.getSelection();
  if(sel&&sel.rangeCount){const r=sel.getRangeAt(0);r.deleteContents();r.insertNode(node);r.setStartAfter(node);r.collapse(true);sel.removeAllRanges();sel.addRange(r);}else qs('#templateVisualEditor').appendChild(node);
}

function sanitizeTemplateHtml(raw){
  const doc=new DOMParser().parseFromString(`<div id="root">${raw||''}</div>`,'text/html'),root=doc.querySelector('#root');
  root.querySelectorAll('script,iframe,object,embed,link,meta,form,input,button,textarea,select').forEach(n=>n.remove());
  root.querySelectorAll('*').forEach(el=>{
    [...el.attributes].forEach(a=>{
      const n=a.name.toLowerCase(),v=a.value||'';
      if(n.startsWith('on')||n==='srcdoc'||(n==='href'&&/^\s*javascript:/i.test(v)))el.removeAttribute(a.name);
      if(n==='contenteditable'||n==='data-token')el.removeAttribute(a.name);
    });
  });
  return root.innerHTML;
}

function currentTemplatePayload(){
  const html=state.templateMode==='visual'?visualEditorToTemplate():sanitizeTemplateHtml(qs('#templateHtmlEditor').value);
  return {...(state.editingTemplate||{}),name:qs('#templateName').value.trim()||'Night Memo',status:'draft',effective_from:qs('#templateEffectiveFrom').value||todayISO(),html_template:html,css_template:qs('#templateCssEditor').value||''};
}

async function saveTemplateDraft(){
  try{
    const payload=currentTemplatePayload();
    const saved=await saveManagerPrintTemplate(payload);state.editingTemplate={...saved};
    await refreshTemplateList(saved.id);flash('Print template draft saved.','success');
  }catch(e){console.error(e);flash(e.message||String(e),'error',8000);}
}

async function publishTemplate(){
  try{
    let payload=currentTemplatePayload();
    let saved=await saveManagerPrintTemplate(payload);
    const effective=qs('#templateEffectiveFrom').value||todayISO();
    await publishManagerPrintTemplate(saved.id,effective);
    await refreshTemplateList(saved.id);flash(`Template published from ${effective}.`,'success');
  }catch(e){console.error(e);flash(e.message||String(e),'error',8000);}
}

function renderTemplateHtml(html){
  let out=sanitizeTemplateHtml(html||DEFAULT_TEMPLATE_HTML);
  const replacements={
    report_date_display:toDisplayDate(qs('#reportDate').value),report_date:qs('#reportDate').value,
    section:qs('#memoSection').value,ward_summary_table:managerSummaryTableHtml(),infection_table:infectionTableHtml(),
    page_break:'<div class="manager-page-break"></div>'
  };
  for(const [k,v] of Object.entries(replacements))out=out.split(`{{${k}}}`).join(v);
  return out.replace(/\{\{[a-z0-9_]+\}\}/gi,'');
}

function openTemplateWindow(html,css='',autoPrint=false,title='Night Memo Preview'){
  const win=window.open('','_blank','width=1250,height=900');if(!win){flash('Pop-up blocked. Allow pop-ups to preview/print.','error');return;}
  const shellCss=new URL('./css/legacy-shell.css',location.href).href,managerCss=new URL('./css/manager.css',location.href).href,printCss=new URL('./css/print.css',location.href).href;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><link rel="stylesheet" href="${shellCss}"><link rel="stylesheet" href="${managerCss}"><link rel="stylesheet" href="${printCss}"><style>${css||''}</style></head><body class="legacy-page manager-template-output"><main class="manager-template-page">${renderTemplateHtml(html)}</main>${autoPrint?'<script>setTimeout(()=>window.print(),600)<\/script>':''}</body></html>`);win.document.close();
}

function previewCurrentTemplate(){const p=currentTemplatePayload();openTemplateWindow(p.html_template,p.css_template,false,'Night Memo Template Preview');}

async function printNightMemo(){
  try{
    showManagerPage('summary');
    const t=await getActiveManagerPrintTemplate(qs('#reportDate').value);
    if(!t){openTemplateWindow(DEFAULT_TEMPLATE_HTML,'',true,'Night Memo');return;}
    openTemplateWindow(t.html_template,t.css_template||'',true,t.name||'Night Memo');
  }catch(e){console.error(e);flash(e.message||String(e),'error',8000);}
}
