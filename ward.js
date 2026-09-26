import { requireRole, signOut } from './auth.js';
import { CONFIG } from './config.js';
import { getWardById, getWardCapacity, getReportItems, isWardOperational, getWardStaff, saveWardStaff, setStaffActive, getWardReport, getRecentReports, getPreviousReport, upsertWardReport } from './database.js';
import { qs,qsa,esc,todayISO,toDisplayDate,flash,setAppHeader,fullReportPayloadDefaults,getSelectedBeds } from './app.js';
import { renderFullReport } from './report-renderer.js';

const state={access:null,ward:null,capacity:0,items:[],staff:[],report:null,historySelected:null,operational:true};
const $=qs;

init().catch(e=>{console.error(e);flash(e.message||String(e),'error',8000)});

async function init(){
  state.access=await requireRole('ward'); if(!state.access)return;
  state.ward=state.access.wards || await getWardById(state.access.ward_id);
  setAppHeader({title:`${state.ward.display_name} Night Memo`,subtitle:`Tel ${state.ward.phone} · Fax ${state.ward.fax}`,access:state.access});
  $('#wardName').value=state.ward.display_name;$('#wardPhone').value=state.ward.phone||'';$('#wardFax').value=state.ward.fax||'';$('#memoDate').value=todayISO();
  bindUI(); await loadForDate($('#memoDate').value); await refreshHistory();
}

function bindUI(){
  $('#logoutBtn').onclick=signOut; $('#saveBtn').onclick=saveReport; $('#printBtn').onclick=()=>printCurrent(true); $('#staffBtn').onclick=()=>openModal('#staffModal');
  $('#memoDate').onchange=async()=>{await loadForDate($('#memoDate').value)};
  qsa('#wardTabs .tab').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
  qsa('[data-close]').forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
  qsa('[data-copy-section]').forEach(b=>b.onclick=()=>copyPrevious(b.dataset.copySection));
  $('#addEarlyBird').onclick=()=>addEarlyBirdRow(); $('#addPatient').onclick=()=>addPatientRow(); $('#addConsult').onclick=()=>addConsultRow(); $('#addIntub').onclick=()=>addIntubRow(); $('#addNurse').onclick=()=>addNurseRow(); $('#addStaff').onclick=()=>appendStaffEditor();
  $('#nilSpecial').onchange=syncNilStates;$('#nilConsultation').onchange=syncNilStates;$('#nilIntubation').onchange=syncNilStates;
  $('#sigName').addEventListener('change',()=>autofillSignature($('#sigName').value));
  $('#printHistoryBtn').onclick=()=>{if(state.historySelected)printReportObject(state.historySelected)};
}

function showTab(name){qsa('#wardTabs .tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===name));qsa('.tab-page').forEach(x=>x.classList.toggle('active',x.dataset.page===name));}
function openModal(sel){$(sel).classList.add('show')}function closeModal(sel){$(sel).classList.remove('show')}

async function loadForDate(date){
  state.operational=await isWardOperational(state.ward.id,date);
  state.capacity=await getWardCapacity(state.ward.id,date) || 0;
  $('#saveBtn').disabled=!state.operational;
  $('#operatingStatus').textContent=state.operational?'This ward is operational on the selected report date. Ward, telephone and fax details are loaded from the database.':'This ward is NOT operational on the selected date. Historical reports can be viewed, but a new report cannot be saved for this date.';
  $('#operatingStatus').classList.toggle('warning-note',!state.operational);
  state.items=await getReportItems(date);
  state.staff=await getWardStaff(state.ward.id,false);
  state.report=await getWardReport(state.ward.id,date);
  renderStaffSuggestions(); renderConfiguredFields();
  fillPayload(state.report?.payload || fullReportPayloadDefaults());
}

function renderStaffSuggestions(){
  $('#staffSuggestions').innerHTML=state.staff.map(s=>`<option value="${esc(s.name)}">${esc(s.role)} · ${esc(formatAppt(s.appointment_date))}</option>`).join('');
}
function formatAppt(v){if(!v)return''; if(/^\d{4}-\d{2}-\d{2}$/.test(v))return toDisplayDate(v); return v;}

function renderConfiguredFields(){
  $('#admissionFields').innerHTML='<div class="subsection"><div class="section-title">Admission / Discharge / Bed Count</div><div id="admissionDynamic"></div></div>';
  renderItemsInto('#admissionDynamic',state.items.filter(i=>['admission','bedcount'].includes(i.section)));
  renderItemsInto('#infectionFields',state.items.filter(i=>i.section==='infection'));
  renderItemsInto('#deviceFields',state.items.filter(i=>i.section==='devices'));
  const additional=state.items.filter(i=>!i.builtin&&!['infection','devices','admission','bedcount'].includes(i.section));
  $('#additionalFieldsWrap').classList.toggle('hidden',additional.length===0);
  renderItemsInto('#additionalFields',additional);
  const total=$('[data-key="totalPatientM"]'); if(total)total.addEventListener('input',renderEmptyBedArea);
}

function renderItemsInto(sel,items){
  $(sel).innerHTML=items.map(item=>`<div class="dynamic-row"><div class="row-label">${esc(item.label)}</div><div class="row-value">${renderInput(item)}</div></div>`).join('');
  items.filter(i=>i.input_type==='bed_or_count').forEach(bindDeviceToggle);
}
function renderInput(item){
  const k=esc(item.key), type=item.input_type;
  if(type==='dropdown') return `<select class="control" data-key="${k}" data-input-type="dropdown">${(item.options||[]).map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>`;
  if(type==='checkbox') return `<label class="checkbox-line"><input type="checkbox" data-key="${k}" data-input-type="checkbox"> Yes</label>`;
  if(type==='number') return `<input class="control" type="number" min="0" data-key="${k}" data-input-type="number">`;
  if(type==='free_text') return `<textarea class="control" data-key="${k}" data-input-type="free_text"></textarea>`;
  if(type==='bed_chooser') return `<div data-key="${k}" data-input-type="bed_chooser">${bedGrid([])}</div>`;
  if(type==='bed_or_count') return `<div class="dev-control" data-key="${k}" data-input-type="bed_or_count" data-mode="beds"><div class="segmented no-print"><button type="button" class="active" data-mode-btn="beds">By Bed</button><button type="button" data-mode-btn="count">By Count</button></div><div data-bed-part>${bedGrid([])}</div><div data-count-part class="hidden"><input class="control count-input" type="number" min="0" value="0"></div></div>`;
  return `<input class="control" data-key="${k}" data-input-type="free_text">`;
}
function bedGrid(selected=[]){selected=(selected||[]).map(String);return `<div class="bed-grid">${Array.from({length:state.capacity},(_,i)=>{const b=String(i+1);return `<label class="bed-chip"><input type="checkbox" value="${b}" ${selected.includes(b)?'checked':''}><span>${b}</span></label>`}).join('')}</div>`;}
function bindDeviceToggle(item){
  const root=$(`[data-key="${CSS.escape(item.key)}"][data-input-type="bed_or_count"]`); if(!root)return;
  qsa('[data-mode-btn]',root).forEach(btn=>btn.onclick=()=>setDevMode(root,btn.dataset.modeBtn));
}
function setDevMode(root,mode){root.dataset.mode=mode;qsa('[data-mode-btn]',root).forEach(b=>b.classList.toggle('active',b.dataset.modeBtn===mode));qs('[data-bed-part]',root).classList.toggle('hidden',mode!=='beds');qs('[data-count-part]',root).classList.toggle('hidden',mode!=='count');}

function itemStorage(item){return item.config?.storage || (item.builtin?'direct':'dynamicItems');}
function getItemValue(item){
  const el=$(`[data-key="${CSS.escape(item.key)}"]`); if(!el)return null;
  if(item.input_type==='checkbox')return el.checked;
  if(['dropdown','number','free_text'].includes(item.input_type))return el.value;
  if(item.input_type==='bed_chooser')return getSelectedBeds(el);
  if(item.input_type==='bed_or_count'){const mode=el.dataset.mode||'beds';return mode==='count'?{mode:'count',count:Number(qs('input[type="number"]',el).value)||0,beds:[]}:{mode:'beds',count:0,beds:getSelectedBeds(el)};}
  return el.value;
}
function setItemValue(item,value){
  const el=$(`[data-key="${CSS.escape(item.key)}"]`); if(!el)return;
  if(item.input_type==='checkbox'){el.checked=!!value;return;}
  if(['dropdown','number','free_text'].includes(item.input_type)){el.value=value??'';return;}
  if(item.input_type==='bed_chooser'){el.innerHTML=bedGrid(Array.isArray(value)?value:[]);return;}
  if(item.input_type==='bed_or_count'){const v=value||{mode:'beds',beds:[]};setDevMode(el,v.mode==='count'?'count':'beds');qs('[data-bed-part]',el).innerHTML=bedGrid(v.beds||[]);qs('input[type="number"]',el).value=v.count||0;return;}
}

function renderEmptyBedArea(){
  const total=Number($('[data-key="totalPatientM"]')?.value||0); const count=Math.max(0,state.capacity-total);
  const old=collectEmptyDetails();
  const gender=state.ward.empty_bed_gender_mode;
  $('#emptyBedArea').innerHTML=`<div class="row-line"><div class="row-label">Bed Capacity</div><div><b>${state.capacity}</b></div></div><div class="row-line"><div class="row-label">Calculated Empty Bed</div><div><b id="emptyBedCount">${count}</b> <span class="muted">(${state.capacity} − total patient)</span></div></div><div class="row-line"><div class="row-label">Empty-bed details</div><div><div class="empty-details" id="emptyDetails"></div><button type="button" class="btn secondary small no-print" id="addEmptyDetail">+ Add detail</button></div></div>`;
  $('#addEmptyDetail').onclick=()=>addEmptyDetailRow(); (old||[]).forEach(addEmptyDetailRow);
  if(!old.length && gender==='dynamic' && count>0) Array.from({length:count},()=>addEmptyDetailRow());
}
function addEmptyDetailRow(v={}){
  const wrap=$('#emptyDetails'); if(!wrap)return; const dynamic=state.ward.empty_bed_gender_mode==='dynamic';
  const r=document.createElement('div');r.className='empty-detail-row';r.innerHTML=`<input class="control" data-empty-location placeholder="Bed / location" value="${esc(v.location||'')}">${dynamic?`<select class="control" data-empty-gender><option value="">Gender</option><option value="M" ${v.gender==='M'?'selected':''}>Male</option><option value="F" ${v.gender==='F'?'selected':''}>Female</option></select>`:'<span></span>'}<input class="control" data-empty-remark placeholder="Remark (optional)" value="${esc(v.remark||'')}"><button type="button" class="btn danger small no-print">×</button>`;r.querySelector('button').onclick=()=>r.remove();wrap.append(r);
}
function collectEmptyDetails(){
  const wrap=$('#emptyDetails');if(!wrap)return[];return qsa('.empty-detail-row',wrap).map(r=>({location:qs('[data-empty-location]',r)?.value.trim()||'',gender:qs('[data-empty-gender]',r)?.value||null,remark:qs('[data-empty-remark]',r)?.value.trim()||''})).filter(x=>x.location||x.gender||x.remark);
}

function addEarlyBirdRow(v={}){const r=document.createElement('div');r.className='repeat-row';r.innerHTML=`<input class="control" data-eb-bed placeholder="Bed" value="${esc(v.bed||'')}"><input class="control" data-eb-dest placeholder="Destination" value="${esc(v.dest||'')}"><button type="button" class="btn danger small no-print">×</button>`;r.querySelector('button').onclick=()=>r.remove();$('#earlyBirdRows').append(r);}
function addPatientRow(v=['','','']){const tr=document.createElement('tr');tr.innerHTML=`<td><input class="control" value="${esc(v[0]||'')}"></td><td><input class="control" value="${esc(v[1]||'')}"></td><td><textarea class="control">${esc(v[2]||'')}</textarea></td><td class="no-print"><button type="button" class="btn danger small">×</button></td>`;tr.querySelector('button').onclick=()=>tr.remove();$('#patientRows').append(tr);}
function addConsultRow(v=['','','']){const tr=document.createElement('tr');tr.innerHTML=`<td><input class="control" value="${esc(v[0]||'')}"></td><td><input class="control" value="${esc(v[1]||'')}"></td><td><input class="control" value="${esc(v[2]||'')}"></td><td class="no-print"><button type="button" class="btn danger small">×</button></td>`;tr.querySelector('button').onclick=()=>tr.remove();$('#consultRows').append(tr);}
function addIntubRow(v=[]){const tr=document.createElement('tr');tr.innerHTML=Array.from({length:8},(_,i)=>`<td><input class="control" value="${esc(v[i]||'')}"></td>`).join('')+`<td class="no-print"><button type="button" class="btn danger small">×</button></td>`;tr.querySelector('button').onclick=()=>tr.remove();$('#intubRows').append(tr);}
function addNurseRow(v={}){
  const r=document.createElement('div');r.className='nurse-row';r.innerHTML=`<select class="control" data-n-role><option>RN</option><option>EN</option><option>APN</option><option>Student Nurse</option></select><input class="control" list="staffSuggestions" data-n-name placeholder="Name or free text" value="${esc(v.name||'')}"><input class="control" data-n-appt placeholder="Appointment" value="${esc(v.appt||'')}"><label class="checkbox-line"><input type="checkbox" data-n-runner ${v.runner?'checked':''}> Runner</label><button type="button" class="btn danger small no-print">×</button>`;
  qs('[data-n-role]',r).value=v.role||'RN';const name=qs('[data-n-name]',r);name.dataset.source=v.source||'';name.dataset.staffId=v.staffId||'';name.addEventListener('change',()=>autofillNurseRow(r));r.querySelector('button').onclick=()=>r.remove();$('#nurseRows').append(r);
}
function autofillNurseRow(r){const name=qs('[data-n-name]',r).value.trim();const s=state.staff.find(x=>x.name.toLowerCase()===name.toLowerCase());if(s){qs('[data-n-role]',r).value=s.role;qs('[data-n-appt]',r).value=formatAppt(s.appointment_date);qs('[data-n-name]',r).dataset.source='ward_staff';qs('[data-n-name]',r).dataset.staffId=s.id;}else{qs('[data-n-name]',r).dataset.source='free_text';qs('[data-n-name]',r).dataset.staffId='';}}
function autofillSignature(name){const s=state.staff.find(x=>x.name.toLowerCase()===String(name).trim().toLowerCase());if(s){$('#sigRank').value=s.role;$('#sigAppt').value=formatAppt(s.appointment_date);}}
function syncNilStates(){$('#patientRows').closest('.table-scroll').classList.toggle('hidden',$('#nilSpecial').checked);$('#addPatient').classList.toggle('hidden',$('#nilSpecial').checked);$('#consultRows').closest('.table-scroll').classList.toggle('hidden',$('#nilConsultation').checked);$('#addConsult').classList.toggle('hidden',$('#nilConsultation').checked);$('#intubRows').closest('.table-scroll').classList.toggle('hidden',$('#nilIntubation').checked);$('#addIntub').classList.toggle('hidden',$('#nilIntubation').checked);}

function fillPayload(D){
  D={...fullReportPayloadDefaults(),...D};
  state.items.forEach(item=>{const storage=itemStorage(item);let v;if(storage==='infBeds')v=D.infBeds?.[item.key];else if(storage==='devBeds')v=D.devBeds?.[item.key];else if(storage==='dynamicItems')v=D.dynamicItems?.[item.key];else v=D[item.key];setItemValue(item,v);});
  renderEmptyBedArea();$('#emptyDetails').innerHTML='';(D.emptyBeds?.details||[]).forEach(addEmptyDetailRow);
  $('#earlyBirdRows').innerHTML='';(D.earlyBirds||[]).forEach(addEarlyBirdRow); if(!(D.earlyBirds||[]).length)addEarlyBirdRow();
  $('#nilSpecial').checked=!!D.nilSpecial;$('#patientRows').innerHTML='';(D.patients||[]).forEach(addPatientRow);if(!(D.patients||[]).length)addPatientRow();
  $('#nilConsultation').checked=!!D.nilConsultation;$('#consultRows').innerHTML='';(D.consultations||[]).forEach(addConsultRow);if(!(D.consultations||[]).length)addConsultRow();
  $('#nilIntubation').checked=!!D.nilIntubation;$('#intubRows').innerHTML='';(D.intubations||[]).forEach(addIntubRow);if(!(D.intubations||[]).length)addIntubRow();
  $('#nurseRows').innerHTML='';(D.nurses||[]).forEach(addNurseRow);if(!(D.nurses||[]).length)addNurseRow();
  $('#staffAM').value=D.staffAM||'';$('#staffPM').value=D.staffPM||'';$('#sigRank').value=D.sigRank||'RN';$('#sigName').value=D.sigName||'';$('#sigAppt').value=D.sigAppt||'';syncNilStates();
}

function collectRows(sel,count){return qsa('tr',$(sel)).map(tr=>qsa('input,textarea',tr).slice(0,count).map(x=>x.value.trim())).filter(r=>r.some(Boolean));}
function collectPayload(){
  const D=fullReportPayloadDefaults();D.infBeds={};D.devBeds={};D.dynamicItems={};
  state.items.forEach(item=>{const v=getItemValue(item), storage=itemStorage(item);if(storage==='infBeds')D.infBeds[item.key]=v||[];else if(storage==='devBeds')D.devBeds[item.key]=v;else if(storage==='dynamicItems')D.dynamicItems[item.key]=v;else D[item.key]=v;});
  const total=Number(D.totalPatientM||0);D.emptyBeds={count:Math.max(0,state.capacity-total),details:collectEmptyDetails()};
  D.earlyBirds=qsa('.repeat-row',$('#earlyBirdRows')).map(r=>({bed:qs('[data-eb-bed]',r).value.trim(),dest:qs('[data-eb-dest]',r).value.trim()})).filter(x=>x.bed||x.dest);
  D.nilSpecial=$('#nilSpecial').checked;D.patients=D.nilSpecial?[]:collectRows('#patientRows',3);
  D.nilConsultation=$('#nilConsultation').checked;D.consultations=D.nilConsultation?[]:collectRows('#consultRows',3);
  D.nilIntubation=$('#nilIntubation').checked;D.intubations=D.nilIntubation?[]:collectRows('#intubRows',8);
  D.nurses=qsa('.nurse-row',$('#nurseRows')).map(r=>{const name=qs('[data-n-name]',r);return{role:qs('[data-n-role]',r).value,name:name.value.trim(),appt:qs('[data-n-appt]',r).value.trim(),runner:qs('[data-n-runner]',r).checked,source:name.dataset.source||'free_text',staffId:name.dataset.staffId||null}}).filter(x=>x.name);
  D.staffAM=$('#staffAM').value.trim();D.staffPM=$('#staffPM').value.trim();D.sigRank=$('#sigRank').value;D.sigName=$('#sigName').value.trim();D.sigAppt=$('#sigAppt').value.trim();D.savedAt=new Date().toISOString();return D;
}

async function saveReport(){
  const btn=$('#saveBtn');if(!state.operational){flash('This ward is not operational on the selected date.','warning');return;}btn.disabled=true;try{const date=$('#memoDate').value;if(!date)throw new Error('Select a report date.');const payload=collectPayload();state.report=await upsertWardReport({ward_id:state.ward.id,report_date:date,payload,bed_capacity_snapshot:state.capacity,form_version:1});flash('Night memo saved.','success');await refreshHistory();}catch(e){flash(e.message||String(e),'error',7000)}finally{btn.disabled=false;}
}

async function refreshHistory(){const rows=await getRecentReports(state.ward.id,CONFIG.RECENT_HISTORY_LIMIT);$('#historyList').innerHTML=rows.length?rows.map(r=>`<button class="history-item" data-history-id="${esc(r.id)}"><div class="date">${esc(toDisplayDate(r.report_date))}</div><div class="meta">Saved ${esc(r.updated_at?new Date(r.updated_at).toLocaleString():'')}</div></button>`).join(''):'<div class="panel-body muted">No saved entries yet.</div>';qsa('[data-history-id]').forEach(b=>b.onclick=()=>openHistory(rows.find(r=>r.id===b.dataset.historyId)));}
async function openHistory(report){state.historySelected=report;$('#historyModalTitle').textContent=`${state.ward.code} · ${toDisplayDate(report.report_date)}`;const cap=report.bed_capacity_snapshot??await getWardCapacity(state.ward.id,report.report_date);const items=await getReportItems(report.report_date);$('#historyDetail').innerHTML=renderFullReport({ward:state.ward,report,capacity:cap,items});openModal('#historyModal');}

async function copyPrevious(section){const date=$('#memoDate').value;const prev=await getPreviousReport(state.ward.id,date);if(!prev){flash('No earlier report is available.','warning');return;}const current=collectPayload(),p=prev.payload||{};if(section==='admission'){['admissionEC','admissionCC','discharge','death','transferIn','transferOut','totalPatientM'].forEach(k=>current[k]=p[k]);current.emptyBeds=p.emptyBeds;current.earlyBirds=p.earlyBirds||[];}if(section==='infection'){current.infBeds=p.infBeds||{};current.devBeds=p.devBeds||{};current.dynamicItems=p.dynamicItems||{};}if(section==='patients'){current.nilSpecial=p.nilSpecial;current.patients=p.patients||[];}if(section==='consult'){current.nilConsultation=p.nilConsultation;current.consultations=p.consultations||[];current.nilIntubation=p.nilIntubation;current.intubations=p.intubations||[];}if(section==='nurses'){current.nurses=p.nurses||[];current.staffAM=p.staffAM||'';current.staffPM=p.staffPM||'';current.sigRank=p.sigRank||'RN';current.sigName=p.sigName||'';current.sigAppt=p.sigAppt||'';}fillPayload(current);flash(`Copied ${section} data from ${toDisplayDate(prev.report_date)}.`,'success');}

async function renderStaffTable(){state.staff=await getWardStaff(state.ward.id,true);$('#staffTableBody').innerHTML='';state.staff.forEach(appendStaffEditor);renderStaffSuggestions();}
function appendStaffEditor(s={role:'RN',name:'',appointment_date:'',active:true}){const tr=document.createElement('tr');tr.dataset.id=s.id||'';tr.innerHTML=`<td><select class="control" data-s-role><option>RN</option><option>EN</option><option>APN</option><option>Student Nurse</option></select></td><td><input class="control" data-s-name value="${esc(s.name||'')}"></td><td><input class="control" type="date" data-s-appt value="${/^\d{4}-/.test(s.appointment_date||'')?esc(s.appointment_date):''}"></td><td>${s.active===false?'<span class="tag subtle">Inactive</span>':'<span class="tag">Active</span>'}</td><td><div class="inline-actions"><button class="btn secondary small" data-save-staff>Save</button>${s.id?`<button class="btn danger small" data-toggle-staff>${s.active===false?'Activate':'Deactivate'}</button>`:''}</div></td>`;qs('[data-s-role]',tr).value=s.role||'RN';qs('[data-save-staff]',tr).onclick=async()=>{const row=await saveWardStaff({id:tr.dataset.id||undefined,ward_id:state.ward.id,role:qs('[data-s-role]',tr).value,name:qs('[data-s-name]',tr).value.trim(),appointment_date:qs('[data-s-appt]',tr).value||null,active:s.active!==false,display_order:0});tr.dataset.id=row.id;flash('Staff record saved.','success');await renderStaffTable();};const toggle=qs('[data-toggle-staff]',tr);if(toggle)toggle.onclick=async()=>{await setStaffActive(s.id,s.active===false);flash('Staff status updated.','success');await renderStaffTable();};$('#staffTableBody').append(tr);}
$('#staffBtn')?.addEventListener('click',()=>renderStaffTable());

async function printCurrent(autoSave=false){const payload=collectPayload();const reportDate=$('#memoDate').value;let report={report_date:reportDate,payload,bed_capacity_snapshot:state.capacity,updated_at:new Date().toISOString()};if(autoSave){try{report=await upsertWardReport({ward_id:state.ward.id,report_date:reportDate,payload,bed_capacity_snapshot:state.capacity,form_version:1});state.report=report;await refreshHistory();flash('Report auto-saved before printing.','success');}catch(e){flash('Print cancelled because auto-save failed: '+(e.message||e),'error',7000);return;}}printReportObject(report);}
async function printReportObject(report){const items=await getReportItems(report.report_date);const cap=report.bed_capacity_snapshot??await getWardCapacity(state.ward.id,report.report_date);const html=renderFullReport({ward:state.ward,report,capacity:cap,items});const win=window.open('','_blank','width=1200,height=850');if(!win){flash('Pop-up blocked. Allow pop-ups to print.','error');return;}const css=new URL('./css/app.css',location.href).href,printCss=new URL('./css/print.css',location.href).href;win.document.write(`<!doctype html><html><head><title>${esc(state.ward.code)} ${esc(report.report_date)}</title><link rel="stylesheet" href="${css}"><link rel="stylesheet" href="${printCss}"></head><body><main class="content">${html}</main><script>setTimeout(()=>window.print(),500)<\/script></body></html>`);win.document.close();}
