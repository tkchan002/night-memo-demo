import { requireRole, signOut } from './auth.js';
import { CONFIG } from './config.js';
import {
  DB_MODE, getWardById, getWardCapacity, getReportItems, isWardOperational,
  getWardStaff, saveWardStaff, setStaffActive, getWardReport, getRecentReports,
  getPreviousReport, upsertWardReport
} from './database.js';
import { esc, todayISO, toDisplayDate, fullReportPayloadDefaults } from './app.js';

const $ = (s,p=document)=>p.querySelector(s);
const $$ = (s,p=document)=>[...p.querySelectorAll(s)];
const state={access:null,ward:null,capacity:0,items:[],staff:[],report:null,history:[],currentHist:null,operational:true,historyMode:false,staffMode:false,gdTab:null,gdPrev:null};
const INF_MAP={iCRE:'i_CRE',iVRE:'i_VRE',iCOV:'i_COVID',iMDR:'i_MDRA',iCD:'i_CD',iInf:'i_Inf',iCA:'i_CA'};
const DEV_MAP={dMV:'d_MV',dNIV:'d_NIV',dHF:'d_HFNC',dHD:'d_HD',dCA:'d_CAPD'};
const DIRECT_KEYS=['admissionEC','admissionCC','discharge','death','transferIn','transferOut','totalPatientM'];

const FALLBACK_WARD_PRINT_SETTINGS = Object.freeze({
  topTitle:19, topContent:13, boxTitle:15, boxContent:12,
  lineHeader:9, lineContent:11, consHeader:10, consContent:10,
  intubHeader:9, intubContent:10, nurseTitle:9, nurseContent:11,
  sigContent:11, infLabel:12, infValue:12, devLabel:12, devValue:12
});
let printModulePromise=null;
async function getPrintModule(){
  if(!printModulePromise) printModulePromise=import('./ward-print.js');
  return printModulePromise;
}

init().catch(e=>{console.error(e);showStatus('error',e.message||String(e));});

async function init(){
  state.access=await requireRole('ward'); if(!state.access)return;
  state.ward=state.access.wards || await getWardById(state.access.ward_id);
  $('#wardFrom').textContent=state.ward.display_name||`Ward ${state.ward.code}`;
  $('#wardContact').innerHTML=`Ext ${esc(state.ward.phone||'—')} &nbsp;&nbsp;&nbsp;<b>Fax:</b> Ext ${esc(state.ward.fax||'—')}`;
  $('#liveIndicator').textContent=DB_MODE==='demo'?'Local demo mode':'Supabase live';
  $('#memoDate').value=todayISO();
  $('#memoDate').addEventListener('change',()=>loadForDate($('#memoDate').value));
  $('#logoutBtn').addEventListener('click',signOut);
  $('#sigName').addEventListener('input',()=>autofillSignature($('#sigName').value));
  $('#gdOverlay').addEventListener('click',e=>{if(e.target.id==='gdOverlay')gdClose();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){gdClose();closePdfSettings();}});
  document.addEventListener('click',e=>{if(!e.target.closest('.bed-w'))$$('.bed-dd.show').forEach(x=>x.classList.remove('show'));});
  await loadForDate($('#memoDate').value);
  await refreshHistory();
}

function showStatus(type,msg){
  const box=$('#statusBox'); if(!box)return;
  box.className=type||'loading'; box.textContent=msg; box.style.display='block';
  clearTimeout(showStatus._t); if(type!=='loading')showStatus._t=setTimeout(()=>{box.style.display='none';},4500);
}

function itemByKey(key){return state.items.find(i=>i.key===key);}
function itemStorage(item){return item?.config?.storage || (item?.builtin?(item.section==='infection'?'infBeds':item.section==='devices'?'devBeds':'direct'):'dynamicItems');}
function optionsOf(item){return Array.isArray(item?.options)?item.options:[];}
function bedCeiling(){return Math.max(60,Number(state.capacity)||0);}
function formatAppt(v){if(!v)return'';if(/^\d{4}-\d{2}-\d{2}$/.test(v)){const [y,m,d]=v.split('-');return `${d}/${m}/${y}`;}return v;}
function apptToISO(v){const s=String(v||'').trim();if(!s)return null;if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:null;}

async function loadForDate(date){
  if(!date)return;
  showStatus('loading','Loading ward data…');
  try{
    const [operational,capacity,items,staff,report]=await Promise.all([
      isWardOperational(state.ward.id,date),getWardCapacity(state.ward.id,date),getReportItems(date),getWardStaff(state.ward.id,false),getWardReport(state.ward.id,date)
    ]);
    state.operational=operational;state.capacity=Number(capacity)||0;state.items=items||[];state.staff=staff||[];state.report=report||null;
    buildControls();
    fillPayload(report?.payload||fullReportPayloadDefaults());
    renderStaffDataLists();
    if(!operational)showStatus('error',`${state.ward.code} is not operational on ${toDisplayDate(date)}. Saving is disabled for this date.`);
    else if(report)showStatus('success',`Loaded saved entry for ${toDisplayDate(date)}.`);
    else showStatus('success',`Ready for ${toDisplayDate(date)}.`);
  }catch(e){showStatus('error',e.message||String(e));throw e;}
}

function buildControls(){
  DIRECT_KEYS.slice(0,6).forEach(key=>populateSelect(key,itemByKey(key)));
  Object.entries(INF_MAP).forEach(([key,id])=>makeBedWidget(id,key));
  Object.entries(DEV_MAP).forEach(([key,id])=>makeDeviceWidget(id,key));
  renderDynamicItems();
  updateEmptyBedMode();
}

function populateSelect(id,item){
  const el=$(`#${id}`); if(!el)return;
  const old=el.value; const opts=optionsOf(item).length?optionsOf(item):Array.from({length:31},(_,i)=>String(i));
  el.innerHTML=opts.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
  if(opts.includes(old))el.value=old;
}

function makeBedWidget(containerId,key){
  const par=document.getElementById(containerId); if(!par)return;
  par.innerHTML=`<div class="bed-w" data-bed-key="${esc(key)}"><div class="bed-b" data-bed-btn><span class="bc" data-bed-summary>None</span><span style="font-size:10px;color:#888">&#9660;</span></div><div class="bed-dd" data-bed-dd></div></div>`;
  const wrap=$('[data-bed-key]',par),dd=$('[data-bed-dd]',wrap),btn=$('[data-bed-btn]',wrap);
  for(let i=1;i<=bedCeiling();i++){
    const lab=document.createElement('label');lab.innerHTML=`<input type="checkbox" value="${i}"> ${i}`;dd.append(lab);
    $('input',lab).addEventListener('change',()=>updateBedSummary(wrap));
  }
  btn.addEventListener('click',e=>{e.stopPropagation();$$('.bed-dd.show').forEach(x=>{if(x!==dd)x.classList.remove('show')});dd.classList.toggle('show');});
  dd.addEventListener('click',e=>e.stopPropagation()); updateBedSummary(wrap);
}
function bedWrap(key){return $(`[data-bed-key="${CSS.escape(key)}"]`);}
function getBeds(key){const w=bedWrap(key);return w?$$('input[type=checkbox]:checked',w).map(x=>x.value):[];}
function setBeds(key,beds=[]){const w=bedWrap(key);if(!w)return;const s=new Set((beds||[]).map(String));$$('input[type=checkbox]',w).forEach(x=>x.checked=s.has(x.value));updateBedSummary(w);}
function updateBedSummary(w){const b=$$('input[type=checkbox]:checked',w).map(x=>x.value);const s=$('[data-bed-summary]',w);s.innerHTML=b.length?`${b.map(v=>`<span class="bch">${esc(v)}</span>`).join('')}<span class="bch-cnt">${b.length}</span>`:'None';}

function makeDeviceWidget(containerId,key){
  const par=document.getElementById(containerId);if(!par)return;
  par.innerHTML=`<div class="dev-wrap" data-dev-key="${esc(key)}"><div class="dev-tog"><button class="dev-tog-btn active" type="button" data-mode="beds">By Bed</button><button class="dev-tog-btn" type="button" data-mode="count">By Count</button></div><div data-dev-beds id="devbeds_${esc(key)}"></div><div class="dev-cnt-sec" data-dev-count-wrap style="display:none"><input type="number" min="0" placeholder="0" class="dev-cnt-inp" data-dev-count><span style="font-size:0.9rem;color:#555">patients</span></div></div>`;
  const w=$('[data-dev-key]',par);makeBedWidget(`devbeds_${key}`,`${key}__beds`);
  $$('[data-mode]',w).forEach(b=>b.addEventListener('click',()=>setDeviceMode(key,b.dataset.mode)));
}
function devWrap(key){return $(`[data-dev-key="${CSS.escape(key)}"]`);}
function setDeviceMode(key,mode){const w=devWrap(key);if(!w)return;const bed=mode!=='count';$$('[data-mode]',w).forEach(b=>b.classList.toggle('active',b.dataset.mode===(bed?'beds':'count')));$('[data-dev-beds]',w).style.display=bed?'':'none';$('[data-dev-count-wrap]',w).style.display=bed?'none':'';w.dataset.mode=bed?'beds':'count';}
function getDeviceValue(key){const w=devWrap(key);if(!w)return{mode:'beds',count:0,beds:[]};if(w.dataset.mode==='count')return{mode:'count',count:Number($('[data-dev-count]',w).value)||0,beds:[]};return{mode:'beds',count:0,beds:getBeds(`${key}__beds`)};}
function setDeviceValue(key,v){const w=devWrap(key);if(!w)return;if(Array.isArray(v))v={mode:'beds',count:0,beds:v};v=v||{mode:'beds',count:0,beds:[]};setDeviceMode(key,v.mode==='count'?'count':'beds');if(v.mode==='count')$('[data-dev-count]',w).value=v.count||0;else setBeds(`${key}__beds`,v.beds||[]);}

function renderDynamicItems(){
  const dyn=state.items.filter(i=>!i.builtin&&i.active!==false);
  const admission=dyn.filter(i=>i.section==='admission'||i.section==='bedcount');
  const other=dyn.filter(i=>!admission.includes(i));
  $('#dynamicAdmissionRows').innerHTML=admission.map(dynamicRowHtml).join('');
  $('#dynamicAdditionalRows').innerHTML=other.map(dynamicRowHtml).join('');
  $('#dynamicAdditionalWrap').classList.toggle('hidden',other.length===0);
  dyn.forEach(i=>{
    if(i.input_type==='bed_chooser')makeBedWidget(`dyn_host_${i.key}`,`dyn_${i.key}`);
    if(i.input_type==='bed_or_count')makeDeviceWidget(`dyn_host_${i.key}`,`dyn_${i.key}`);
  });
}
function dynamicRowHtml(i){
  let control='';
  if(i.input_type==='dropdown')control=`<select id="dyn_${esc(i.key)}">${optionsOf(i).map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select>`;
  else if(i.input_type==='checkbox')control=`<label class="dynamic-check"><input type="checkbox" id="dyn_${esc(i.key)}"> Yes</label>`;
  else if(i.input_type==='bed_chooser'||i.input_type==='bed_or_count')control=`<span id="dyn_host_${esc(i.key)}"></span>`;
  else if(i.input_type==='number')control=`<input type="number" id="dyn_${esc(i.key)}">`;
  else control=`<input type="text" id="dyn_${esc(i.key)}" class="w280">`;
  return `<div class="fr dynamic-report-row"><span class="fl">${esc(i.label)}:</span><span class="fc">${control}</span></div>`;
}
function setDynamicValue(i,v){if(i.input_type==='bed_chooser')setBeds(`dyn_${i.key}`,Array.isArray(v)?v:[]);else if(i.input_type==='bed_or_count')setDeviceValue(`dyn_${i.key}`,v);else{const el=$(`#dyn_${CSS.escape(i.key)}`);if(!el)return;if(i.input_type==='checkbox')el.checked=!!v;else el.value=v??'';}}
function getDynamicValue(i){if(i.input_type==='bed_chooser')return getBeds(`dyn_${i.key}`);if(i.input_type==='bed_or_count')return getDeviceValue(`dyn_${i.key}`);const el=$(`#dyn_${CSS.escape(i.key)}`);if(!el)return null;return i.input_type==='checkbox'?el.checked:el.value;}

function updateEmptyBedMode(){
  const mode=state.ward.empty_bed_gender_mode||'male';
  $('#emptyBedLabel').textContent=mode==='female'?'Empty Bed F:':mode==='male'?'Empty Bed M:':'Empty Bed:';
  $('#emptyDetailBlock').classList.toggle('hidden',mode!=='dynamic');
  calcEmpty();
}
function calcEmpty(){const total=Number($('#totalPatientM').value)||0;const count=Math.max(0,(Number(state.capacity)||0)-total);$('#emptyBedM').textContent=String(count);$('#emptyBedFormula').textContent=`(${state.capacity} - Total)`;return count;}
function addEmptyDetail(v={}){const row=document.createElement('div');row.className='empty-detail-row';const dynamic=(state.ward.empty_bed_gender_mode==='dynamic');row.innerHTML=`<input type="text" data-empty-location style="width:120px" placeholder="Bed / location" value="${esc(v.location||'')}">${dynamic?`<select data-empty-gender><option value="">--</option><option value="M">Male</option><option value="F">Female</option></select>`:''}<input type="text" data-empty-remark style="width:260px" placeholder="Remark" value="${esc(v.remark||'')}"><button class="btn-x" type="button">x</button>`;if(dynamic&&v.gender)$('[data-empty-gender]',row).value=v.gender;$('.btn-x',row).onclick=()=>row.remove();$('#emptyDetailRows').append(row);$('#emptyDetailBlock').classList.remove('hidden');}
function collectEmptyDetails(){return $$('.empty-detail-row',$('#emptyDetailRows')).map(r=>({location:$('[data-empty-location]',r)?.value.trim()||'',gender:$('[data-empty-gender]',r)?.value||null,remark:$('[data-empty-remark]',r)?.value.trim()||''})).filter(x=>x.location||x.gender||x.remark);}

function addEB(bv='',dv=''){const d=document.createElement('div');d.className='fr';d.style.marginBottom='4px';let o='<option value="">--</option>';for(let i=1;i<=bedCeiling();i++)o+=`<option value="${i}" ${String(bv)===String(i)?'selected':''}>${i}</option>`;d.innerHTML=`<select class="eB" style="width:70px">${o}</select><span style="padding:0 8px;font-size:1rem;font-weight:700">--&gt;</span><input type="text" class="eD" style="width:150px" placeholder="e.g. KH3A" value="${esc(dv||'')}"><button class="btn-x" type="button" style="margin-left:6px">x</button>`;$('.btn-x',d).onclick=()=>d.remove();$('#ebRows').append(d);}
function addPt(b='',n='',dx=''){const r=document.createElement('tr');r.innerHTML=`<td><input placeholder="Bed" value="${esc(b||'')}"></td><td><input placeholder="Name" value="${esc(n||'')}"></td><td><input placeholder="Dx/Condition" value="${esc(dx||'')}"></td><td><button class="btn-x" type="button">x</button></td>`;$('.btn-x',r).onclick=()=>r.remove();$('#ptBody').append(r);}
function addCs(b='',n='',p=''){const r=document.createElement('tr');r.innerHTML=`<td><input placeholder="Bed" value="${esc(b||'')}"></td><td><input placeholder="Name" value="${esc(n||'')}"></td><td><input placeholder="Pending which subspecialty consultation" value="${esc(p||'')}"></td><td><button class="btn-x" type="button">x</button></td>`;$('.btn-x',r).onclick=()=>r.remove();$('#csBody').append(r);}
function addIt(cols=['','','','','','','','']){const r=document.createElement('tr');r.innerHTML=`<td><input placeholder="Bed" value="${esc(cols[0]||'')}"></td><td><input placeholder="Name & Hosp No" value="${esc(cols[1]||'')}"></td><td><input placeholder="Diagnosis" value="${esc(cols[2]||'')}"></td><td><input placeholder="Reason" value="${esc(cols[3]||'')}"></td><td><select><option value="">--</option><option value="Elective">Elective</option><option value="Emergency">Emergency</option></select></td><td><input placeholder="e.g. Anaes / Parent team" value="${esc(cols[5]||'')}"></td><td><input placeholder="e.g. Intubation Rm / Cubicle" value="${esc(cols[6]||'')}"></td><td><input placeholder="e.g. To ICU/G6/G10 / Stay in ward / death" value="${esc(cols[7]||'')}"></td><td><button class="btn-x" type="button">x</button></td>`;$$('select',r)[0].value=cols[4]||'';$('.btn-x',r).onclick=()=>r.remove();$('#itBody').append(r);}

let nurseCounter=0;
function addNR(opts={}){nurseCounter++;const d=document.createElement('div');d.className='nr';const id=`nr_${nurseCounter}`;d.innerHTML=`<span class="nr-num">${$('#nrRows').children.length+1}.</span><select class="nR" style="width:120px"><option>RN</option><option>EN</option><option>APN</option><option>Student Nurse</option></select><input type="text" class="nN" list="${id}_list" style="width:220px" placeholder="Name" value="${esc(opts.name||'')}"><datalist id="${id}_list"></datalist><input type="text" class="nA" style="width:90px" placeholder="Appt" value="${esc(opts.appt||'')}"><label class="ctl"><input type="checkbox" class="nRu" ${opts.runner?'checked':''}> Night Runner</label><button class="btn-x" type="button">x</button>`;$('.nR',d).value=opts.role||'RN';$('.nN',d).dataset.source=opts.source||'free_text';$('.nN',d).dataset.staffId=opts.staffId||'';$('.btn-x',d).onclick=()=>{d.remove();renumberNurses();};$('.nR',d).onchange=()=>populateNurseDatalist(d);$('.nN',d).oninput=()=>autofillNurse(d);$('#nrRows').append(d);populateNurseDatalist(d);}
function renumberNurses(){$$('.nr',$('#nrRows')).forEach((r,i)=>$('.nr-num',r).textContent=`${i+1}.`);}
function populateNurseDatalist(row){const role=$('.nR',row).value;const dl=$('datalist',row);dl.innerHTML=state.staff.filter(s=>s.role===role).map(s=>`<option value="${esc(s.name)}"></option>`).join('');}
function autofillNurse(row){const name=$('.nN',row),role=$('.nR',row).value,s=state.staff.find(x=>x.role===role&&x.name.toLowerCase()===name.value.trim().toLowerCase());if(s){$('.nA',row).value=formatAppt(s.appointment_date);name.dataset.source='ward_staff';name.dataset.staffId=s.id;}else{name.dataset.source='free_text';name.dataset.staffId='';}}
function renderStaffDataLists(){$('#signatureStaffList').innerHTML=state.staff.map(s=>`<option value="${esc(s.name)}"></option>`).join('');$$('.nr',$('#nrRows')).forEach(populateNurseDatalist);}
function autofillSignature(name){const s=state.staff.find(x=>x.name.toLowerCase()===String(name||'').trim().toLowerCase());if(s){$('#sigRank').value=s.role;$('#sigAppt').value=formatAppt(s.appointment_date);}}

function toggleNil(){const on=$('#nilCb').checked;$('#patientEntryArea').classList.toggle('disabled',on);}
function toggleNilConsult(){const on=$('#nilConsultCb').checked;$('#consultEntryArea').classList.toggle('disabled',on);}
function toggleNilIntub(){const on=$('#nilIntubCb').checked;$('#intubEntryArea').classList.toggle('disabled',on);}

function fillPayload(raw){
  const D={...fullReportPayloadDefaults(),...(raw||{})};
  DIRECT_KEYS.forEach(k=>{if($(`#${k}`))$(`#${k}`).value=D[k]??(k==='totalPatientM'?'':'0');});
  Object.keys(INF_MAP).forEach(k=>setBeds(k,D.infBeds?.[k]||[]));
  Object.keys(DEV_MAP).forEach(k=>setDeviceValue(k,D.devBeds?.[k]));
  state.items.filter(i=>!i.builtin).forEach(i=>setDynamicValue(i,D.dynamicItems?.[i.key]));
  $('#emptyDetailRows').innerHTML='';(D.emptyBeds?.details||[]).forEach(addEmptyDetail);if(state.ward.empty_bed_gender_mode==='dynamic')$('#emptyDetailBlock').classList.remove('hidden');
  $('#ebRows').innerHTML='';(D.earlyBirds||[]).forEach(x=>addEB(x.bed,x.dest));if(!(D.earlyBirds||[]).length)addEB();
  $('#nilCb').checked=!!D.nilSpecial;$('#ptBody').innerHTML='';(D.patients||[]).forEach(r=>addPt(r[0],r[1],r[2]));if(!(D.patients||[]).length)addPt();
  $('#nilConsultCb').checked=!!D.nilConsultation;$('#csBody').innerHTML='';(D.consultations||[]).forEach(r=>addCs(r[0],r[1],r[2]));if(!(D.consultations||[]).length)addCs();
  $('#nilIntubCb').checked=!!D.nilIntubation;$('#itBody').innerHTML='';(D.intubations||[]).forEach(addIt);if(!(D.intubations||[]).length)addIt();
  $('#nrRows').innerHTML='';(D.nurses||[]).forEach(addNR);if(!(D.nurses||[]).length)addNR();
  $('#staffAM').value=D.staffAM||'';$('#staffPM').value=D.staffPM||'';$('#sigRank').value=D.sigRank||'RN';$('#sigName').value=D.sigName||'';$('#sigAppt').value=D.sigAppt||'';
  toggleNil();toggleNilConsult();toggleNilIntub();calcEmpty();
}
function collectTableRows(tbody,count){return $$('tr',$(tbody)).map(r=>$$('input,select',r).slice(0,count).map(x=>x.value.trim())).filter(r=>r.some(Boolean));}
function collectPayload(){
  const D=fullReportPayloadDefaults();D.infBeds={};D.devBeds={};D.dynamicItems={};
  DIRECT_KEYS.forEach(k=>D[k]=$(`#${k}`)?.value??'');
  Object.keys(INF_MAP).forEach(k=>D.infBeds[k]=getBeds(k));
  Object.keys(DEV_MAP).forEach(k=>D.devBeds[k]=getDeviceValue(k));
  state.items.filter(i=>!i.builtin).forEach(i=>D.dynamicItems[i.key]=getDynamicValue(i));
  D.emptyBeds={count:calcEmpty(),details:collectEmptyDetails()};
  D.earlyBirds=$$('#ebRows>.fr').map(r=>({bed:$('.eB',r).value,dest:$('.eD',r).value.trim()})).filter(x=>x.bed||x.dest);
  D.nilSpecial=$('#nilCb').checked;D.patients=D.nilSpecial?[]:collectTableRows('#ptBody',3);
  D.nilConsultation=$('#nilConsultCb').checked;D.consultations=D.nilConsultation?[]:collectTableRows('#csBody',3);
  D.nilIntubation=$('#nilIntubCb').checked;D.intubations=D.nilIntubation?[]:collectTableRows('#itBody',8);
  D.nurses=$$('.nr',$('#nrRows')).map(r=>{const n=$('.nN',r);return{role:$('.nR',r).value,name:n.value.trim(),appt:$('.nA',r).value.trim(),runner:$('.nRu',r).checked,source:n.dataset.source||'free_text',staffId:n.dataset.staffId||null};}).filter(x=>x.name);
  D.staffAM=$('#staffAM').value.trim();D.staffPM=$('#staffPM').value.trim();D.sigRank=$('#sigRank').value;D.sigName=$('#sigName').value.trim();D.sigAppt=$('#sigAppt').value.trim();D.savedAt=new Date().toISOString();return D;
}

async function saveEntry(){
  if(!state.operational){showStatus('error','This ward is not operational on the selected date.');return null;}
  const date=$('#memoDate').value;if(!date){showStatus('error','Select a report date.');return null;}
  showStatus('loading','Saving…');
  try{const report=await upsertWardReport({ward_id:state.ward.id,report_date:date,payload:collectPayload(),bed_capacity_snapshot:state.capacity,form_version:1});state.report=report;await refreshHistory();showStatus('success',`Saved entry for ${toDisplayDate(date)}!`);return report;}catch(e){showStatus('error',e.message||String(e));return null;}
}

async function refreshHistory(){state.history=await getRecentReports(state.ward.id,CONFIG.RECENT_HISTORY_LIMIT);const host=$('#histEntryList');if(!state.history.length){host.innerHTML='<div id="histEmpty">No saved entries yet.</div>';return;}host.innerHTML='';state.history.forEach(r=>{const e=document.createElement('div');e.className='hist-entry'+(state.currentHist?.id===r.id?' selected':'');e.innerHTML=`<div class="he-body"><span class="he-date">${esc(toDisplayDate(r.report_date))}</span><span class="he-sub">${esc(r.updated_at?new Date(r.updated_at).toLocaleString():'')}</span></div><button class="he-del" title="Historical deletion is disabled">x</button>`;$('.he-body',e).onclick=()=>openHistory(r);$('.he-del',e).onclick=ev=>{ev.stopPropagation();showStatus('error','Historical report deletion is disabled in the Supabase version.');};host.append(e);});}

async function openHistory(report){state.currentHist=report;state.historyMode=true;state.staffMode=false;$('#formWrap').classList.add('hidden');$('#staffListWrap').classList.remove('open');$('#histIdle').classList.remove('show');$('#histDetailWrap').classList.add('open');$('#tabStrip').classList.add('disabled-strip');$('#normalBar').style.display='none';$('#staffBar').classList.remove('show');$('#histBar').classList.add('show');$('#hbReprint').disabled=false;$('#hbDelete').disabled=true;$('#histViewLabel').textContent=`Viewing: ${toDisplayDate(report.report_date)}`;$('#histViewSavedAt').textContent=report.updated_at?`Saved ${new Date(report.updated_at).toLocaleString()}`:'';const items=await getReportItems(report.report_date);renderHistorySections(report,items);await refreshHistory();}
function renderHistorySections(report,items){const D={...fullReportPayloadDefaults(),...(report.payload||{})};const cap=report.bed_capacity_snapshot??state.capacity;const empty=D.emptyBeds||{count:Math.max(0,cap-Number(D.totalPatientM||0)),details:[]};
  $('#hd0').innerHTML=`<div class="ro-wrap"><div class="ro-sec-title">Admission / Discharge / Death</div>${roFr('Admission E/C:',D.admissionEC)}${roFr('Admission C/C:',D.admissionCC)}${roFr('Discharge:',D.discharge)}${roFr('Death:',D.death)}${roFr('T/I Gen:',D.transferIn)}${roFr('T/O Gen:',D.transferOut)}${roFr('Total Patient:',D.totalPatientM)}${roFr('Empty Bed:',empty.count)}${roFr('Early Bird(s):',(D.earlyBirds||[]).map(x=>`${x.bed||'?'} -> ${x.dest||'?'}`).join(' | ')||'None')}</div>`;
  const inf=items.filter(i=>i.section==='infection'&&i.builtin&&i.active!==false).map(i=>roFr(`${i.label}:`,D.infBeds?.[i.key]||[])).join('');const dev=items.filter(i=>i.section==='devices'&&i.builtin&&i.active!==false).map(i=>roFr(`${i.label}:`,formatDevice(D.devBeds?.[i.key]))).join('');const dyn=items.filter(i=>!i.builtin&&i.active!==false).map(i=>roFr(`${i.label}:`,formatDynamic(D.dynamicItems?.[i.key]))).join('');$('#hd1').innerHTML=`<div class="ro-wrap"><div class="ro-sec-title">Infection Control</div>${inf}<div class="ro-sec-title">Devices</div>${dev}${dyn?`<div class="ro-sec-title">Additional Report Items</div>${dyn}`:''}</div>`;
  $('#hd2').innerHTML=D.nilSpecial?`<div class="ro-wrap"><div class="ro-sec-title">Patient List</div><div class="ro-nil">Nil Special</div></div>`:`<div class="ro-wrap"><div class="ro-sec-title">Patient List</div>${roTable(['Bed','Name','Diagnosis / Condition / Progress'],D.patients||[])}</div>`;
  $('#hd3').innerHTML=`<div class="ro-wrap"><div class="ro-sec-title">Subspecialty Consultation</div>${D.nilConsultation?'<div class="ro-nil">Nil Consultation</div>':roTable(['Bed','Name','Pending consultation'],D.consultations||[])}<div class="ro-sec-title">Intubation Record</div>${D.nilIntubation?'<div class="ro-nil">Nil Intubation</div>':roTable(['Bed','Name / Hosp No.','Diagnosis','Reason','Elective / Emergency','By Whom','Location','Outcome'],D.intubations||[])}</div>`;
  $('#hd4').innerHTML=`<div class="ro-wrap"><div class="ro-sec-title">Night Nurse</div>${(D.nurses||[]).map((n,i)=>`<p style="font-size:.92rem;margin-bottom:4px;padding:3px 0;border-bottom:1px solid #E0E0D8;color:#333">${i+1}. ${esc(n.role||'')} ${esc(n.name||'')}${n.appt?` (${esc(n.appt)})`:''}${n.runner?' [Night Runner]':''}</p>`).join('')||'<p style="color:#999">No nurses recorded.</p>'}${roFr('AM Duty Staff:',D.staffAM)}${roFr('PM Duty Staff:',D.staffPM)}${roFr('Signature:',`${D.sigRank||''} ${D.sigName||''}`.trim())}${roFr('Appointment:',D.sigAppt)}</div>`;
}
function roFr(label,value){const v=Array.isArray(value)?(value.length?value.map(x=>`<span class="ro-bch">${esc(x)}</span>`).join(''):'Nil'):esc(value??'');return `<div class="ro-fr"><span class="ro-fl">${esc(label)}</span><span class="ro-fc">${v||'—'}</span></div>`;}
function roTable(headers,rows){return `<table class="ro-tbl"><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${(rows||[]).map(r=>`<tr>${headers.map((_,i)=>`<td>${esc(r[i]||'')}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${headers.length}">No entries</td></tr>`}</tbody></table>`;}
function formatDevice(v){if(!v)return'Nil';if(Array.isArray(v))return v.length?v.join(', '):'Nil';if(v.mode==='count')return Number(v.count)>0?`Total: ${v.count}`:'Nil';return (v.beds||[]).length?(v.beds||[]).join(', '):'Nil';}
function formatDynamic(v){if(v==null||v==='')return'—';if(Array.isArray(v))return v.length?v.join(', '):'Nil';if(typeof v==='boolean')return v?'Yes':'No';if(typeof v==='object')return JSON.stringify(v);return String(v);}

function setFormMode(){state.historyMode=false;state.staffMode=false;$('#histSidebar').classList.remove('open');$('#histDetailWrap').classList.remove('open');$('#histIdle').classList.remove('show');$('#staffListWrap').classList.remove('open');$('#formWrap').classList.remove('hidden');$('#tabStrip').classList.remove('disabled-strip');$('#histBar').classList.remove('show');$('#staffBar').classList.remove('show');$('#normalBar').style.display='flex';}
async function toggleHistory(){if(state.historyMode){setFormMode();return;}state.historyMode=true;state.staffMode=false;$('#histSidebar').classList.add('open');$('#formWrap').classList.add('hidden');$('#staffListWrap').classList.remove('open');$('#histDetailWrap').classList.remove('open');$('#histIdle').classList.add('show');$('#tabStrip').classList.add('disabled-strip');$('#normalBar').style.display='none';$('#staffBar').classList.remove('show');$('#histBar').classList.add('show');$('#hbReprint').disabled=true;$('#hbDelete').disabled=true;await refreshHistory();}
async function toggleStaffList(){if(state.staffMode){setFormMode();return;}state.staffMode=true;state.historyMode=false;$('#histSidebar').classList.remove('open');$('#formWrap').classList.add('hidden');$('#histDetailWrap').classList.remove('open');$('#histIdle').classList.remove('show');$('#staffListWrap').classList.add('open');$('#tabStrip').classList.add('disabled-strip');$('#normalBar').style.display='none';$('#histBar').classList.remove('show');$('#staffBar').classList.add('show');await renderStaffList();}

async function renderStaffList(){state.staff=await getWardStaff(state.ward.id,false);const tb=$('#staffListBody');tb.innerHTML='';state.staff.forEach(s=>appendStaffRow(s));renderStaffDataLists();}
function appendStaffRow(s={role:'RN',name:'',appointment_date:'',active:true}){const tr=document.createElement('tr');tr.dataset.id=s.id||'';tr.innerHTML=`<td><select class="staffRole"><option>RN</option><option>EN</option><option>APN</option><option>Student Nurse</option></select></td><td><input class="staffName" value="${esc(s.name||'')}"></td><td><input class="staffAppt" placeholder="dd/mm/yyyy" value="${esc(formatAppt(s.appointment_date))}"></td><td><button class="btn-x" type="button">x</button></td>`;$('.staffRole',tr).value=s.role||'RN';['.staffRole','.staffName','.staffAppt'].forEach(sel=>$(sel,tr).addEventListener('change',()=>saveStaffRow(tr)));$('.btn-x',tr).onclick=async()=>{if(!tr.dataset.id){tr.remove();return;}await setStaffActive(tr.dataset.id,false);showStatus('success','Staff record deactivated.');await renderStaffList();};$('#staffListBody').append(tr);}
function addStaffRow(){appendStaffRow();}
async function saveStaffRow(tr){const name=$('.staffName',tr).value.trim();if(!name)return;try{const saved=await saveWardStaff({id:tr.dataset.id||undefined,ward_id:state.ward.id,role:$('.staffRole',tr).value,name,appointment_date:apptToISO($('.staffAppt',tr).value),active:true,display_order:0});tr.dataset.id=saved.id;showStatus('success','Staff record saved.');state.staff=await getWardStaff(state.ward.id,false);renderStaffDataLists();}catch(e){showStatus('error',e.message||String(e));}}

async function getDataForTab(tab){state.gdTab=tab;const prev=await getPreviousReport(state.ward.id,$('#memoDate').value);state.gdPrev=prev;$('#gdOverlay').classList.add('show');$('#gdSectionHdr').textContent={1:'Admission / Bed Count',2:'Infection / Devices',3:'Patient List',4:'Consultation / Intubation',5:'Night Nurse'}[tab]||'Previous Data';const no=!prev;$('#gdNoHistory').classList.toggle('show',no);$('#gdTable').style.display=no?'none':'table';$('#gdConfirmBtn').disabled=no;if(no){$('#gdTbody').innerHTML='';return;}const D=prev.payload||{};const rows=[];if(tab===1){rows.push(['Admission E/C',D.admissionEC],['Admission C/C',D.admissionCC],['Discharge',D.discharge],['Death',D.death],['Transfer In',D.transferIn],['Transfer Out',D.transferOut],['Total Patient',D.totalPatientM],['Empty Bed',D.emptyBeds?.count??''],['Early Bird',(D.earlyBirds||[]).map(x=>`${x.bed||'?'}→${x.dest||'?'}`).join(' | ')||'None']);}else if(tab===2){state.items.filter(i=>i.builtin&&i.section==='infection').forEach(i=>rows.push([i.label,(D.infBeds?.[i.key]||[]).join(', ')||'Nil']));state.items.filter(i=>i.builtin&&i.section==='devices').forEach(i=>rows.push([i.label,formatDevice(D.devBeds?.[i.key])]));state.items.filter(i=>!i.builtin).forEach(i=>rows.push([i.label,formatDynamic(D.dynamicItems?.[i.key])]));}else if(tab===3){rows.push(['Nil Special',D.nilSpecial?'Yes':'No'],['Patients',D.nilSpecial?'Nil Special':`${(D.patients||[]).length} row(s)`]);}else if(tab===4){rows.push(['Nil Consultation',D.nilConsultation?'Yes':'No'],['Consultations',`${(D.consultations||[]).length} row(s)`],['Nil Intubation',D.nilIntubation?'Yes':'No'],['Intubations',`${(D.intubations||[]).length} row(s)`]);}else if(tab===5){rows.push(['Night Nurse',(D.nurses||[]).map(n=>`${n.role} ${n.name}`).join(' | ')||'None'],['AM Duty Staff',D.staffAM],['PM Duty Staff',D.staffPM],['Signature',`${D.sigRank||''} ${D.sigName||''}`.trim()],['Appointment',D.sigAppt]);}$('#gdTbody').innerHTML=rows.map(([a,b])=>`<tr><td>${esc(a)}</td><td class="${b==null||b===''?'gd-nil':''}">${esc(b??'')}</td></tr>`).join('');}
function gdClose(){state.gdTab=null;state.gdPrev=null;$('#gdOverlay').classList.remove('show');}
function gdConfirm(){if(!state.gdPrev||!state.gdTab)return;const p=state.gdPrev.payload||{},c=collectPayload();if(state.gdTab===1){DIRECT_KEYS.forEach(k=>c[k]=p[k]??c[k]);c.emptyBeds=p.emptyBeds||c.emptyBeds;c.earlyBirds=p.earlyBirds||[];state.items.filter(i=>!i.builtin&&(i.section==='admission'||i.section==='bedcount')).forEach(i=>c.dynamicItems[i.key]=p.dynamicItems?.[i.key]);}else if(state.gdTab===2){c.infBeds=p.infBeds||{};c.devBeds=p.devBeds||{};state.items.filter(i=>!i.builtin).forEach(i=>c.dynamicItems[i.key]=p.dynamicItems?.[i.key]);}else if(state.gdTab===3){c.nilSpecial=!!p.nilSpecial;c.patients=p.patients||[];}else if(state.gdTab===4){c.nilConsultation=!!p.nilConsultation;c.consultations=p.consultations||[];c.nilIntubation=!!p.nilIntubation;c.intubations=p.intubations||[];}else if(state.gdTab===5){c.nurses=p.nurses||[];c.staffAM=p.staffAM||'';c.staffPM=p.staffPM||'';c.sigRank=p.sigRank||'RN';c.sigName=p.sigName||'';c.sigAppt=p.sigAppt||'';}fillPayload(c);showStatus('success',`Copied data from ${toDisplayDate(state.gdPrev.report_date)}.`);gdClose();}

function sT(n){if(state.historyMode||state.staffMode)return;$$('.tab','#tabStrip').forEach((b,i)=>b.classList.toggle('active',i===n));$$('.tp','#formWrap').forEach((p,i)=>p.classList.toggle('active',i===n));}
function hDTab(n,btn){$$('.hd-tab').forEach(x=>x.classList.remove('active'));$$('.hd-section').forEach(x=>x.classList.remove('active'));btn?.classList.add('active');$(`#hd${n}`)?.classList.add('active');}
function maintenanceManagedNotice(){showStatus('loading','Additional report items are configured in Night Memo Maintenance.');}
function histDeleteCurrent(){showStatus('error','Historical report deletion is disabled in the Supabase version.');}
async function histReprint(){if(state.currentHist)await printReportObject(state.currentHist);}

let pdfSettings={...FALLBACK_WARD_PRINT_SETTINGS};
let pdfDebounceTimer=null;

function printContext(report,items,capacity){
  return {
    ward:state.ward, report, capacity, items, settings:pdfSettings,
    logoUrl:new URL('./assets/heart-logo.png',location.href).href
  };
}

async function getPrintContext(report){
  const [items,capacity]=await Promise.all([
    getReportItems(report.report_date),
    report.bed_capacity_snapshot!=null?Promise.resolve(report.bed_capacity_snapshot):getWardCapacity(state.ward.id,report.report_date)
  ]);
  return printContext(report,items,capacity);
}

async function handleGen(mode){
  if(mode==='download')showStatus('loading','The browser print dialog will open. Choose “Save as PDF” as the destination.');
  await printCurrent(true);
}
async function printCurrent(autoSave=false){
  let report={report_date:$('#memoDate').value,payload:collectPayload(),bed_capacity_snapshot:state.capacity,updated_at:new Date().toISOString()};
  if(autoSave){const saved=await saveEntry();if(!saved)return;report=saved;}
  await printReportObject(report);
}
async function printReportObject(report){
  try{
    const context=await getPrintContext(report);
    const mod=await getPrintModule();
    await mod.printWardMemo(context);
    showStatus('success','Print dialog opened.');
  }catch(e){
    showStatus('error','Unable to open print dialog: '+(e.message||String(e)));
    console.error(e);
  }
}

function setPrintControl(id,value){const el=document.getElementById(id);if(el)el.value=value;}
function loadPrintControls(){
  const S=pdfSettings;
  setPrintControl('pset_topTitle',S.topTitle);setPrintControl('pset_topContent',S.topContent);
  setPrintControl('pset_boxTitle',S.boxTitle);setPrintControl('pset_boxContent',S.boxContent);
  setPrintControl('pset_infLabel',S.infLabel);setPrintControl('pset_infValue',S.infValue);
  setPrintControl('pset_devLabel',S.devLabel);setPrintControl('pset_devValue',S.devValue);
  setPrintControl('pset_lineHeader',S.lineHeader);setPrintControl('pset_lineContent',S.lineContent);
  setPrintControl('pset_consHeader',S.consHeader);setPrintControl('pset_consContent',S.consContent);
  setPrintControl('pset_intubHeader',S.intubHeader);setPrintControl('pset_intubContent',S.intubContent);
  setPrintControl('pset_nurseTitle',S.nurseTitle);setPrintControl('pset_nurseContent',S.nurseContent);
  setPrintControl('pset_sigContent',S.sigContent);
}
function readPrintControls(){
  const num=(id,fallback)=>{const n=parseFloat(document.getElementById(id)?.value);return Number.isFinite(n)?n:fallback;};
  return {
    topTitle:num('pset_topTitle',FALLBACK_WARD_PRINT_SETTINGS.topTitle),topContent:num('pset_topContent',FALLBACK_WARD_PRINT_SETTINGS.topContent),
    boxTitle:num('pset_boxTitle',FALLBACK_WARD_PRINT_SETTINGS.boxTitle),boxContent:num('pset_boxContent',FALLBACK_WARD_PRINT_SETTINGS.boxContent),
    infLabel:num('pset_infLabel',FALLBACK_WARD_PRINT_SETTINGS.infLabel),infValue:num('pset_infValue',FALLBACK_WARD_PRINT_SETTINGS.infValue),
    devLabel:num('pset_devLabel',FALLBACK_WARD_PRINT_SETTINGS.devLabel),devValue:num('pset_devValue',FALLBACK_WARD_PRINT_SETTINGS.devValue),
    lineHeader:num('pset_lineHeader',FALLBACK_WARD_PRINT_SETTINGS.lineHeader),lineContent:num('pset_lineContent',FALLBACK_WARD_PRINT_SETTINGS.lineContent),
    consHeader:num('pset_consHeader',FALLBACK_WARD_PRINT_SETTINGS.consHeader),consContent:num('pset_consContent',FALLBACK_WARD_PRINT_SETTINGS.consContent),
    intubHeader:num('pset_intubHeader',FALLBACK_WARD_PRINT_SETTINGS.intubHeader),intubContent:num('pset_intubContent',FALLBACK_WARD_PRINT_SETTINGS.intubContent),
    nurseTitle:num('pset_nurseTitle',FALLBACK_WARD_PRINT_SETTINGS.nurseTitle),nurseContent:num('pset_nurseContent',FALLBACK_WARD_PRINT_SETTINGS.nurseContent),
    sigContent:num('pset_sigContent',FALLBACK_WARD_PRINT_SETTINGS.sigContent)
  };
}
async function previewCurrentMemo(){
  const report={report_date:$('#memoDate').value,payload:collectPayload(),bed_capacity_snapshot:state.capacity,updated_at:new Date().toISOString()};
  const context=await getPrintContext(report);
  const mod=await getPrintModule();
  await mod.writeWardMemoToIframe($('#pdfPreviewFrame'),context);
}
async function openPdfSettings(){
  const mod=await getPrintModule();
  pdfSettings=mod.loadWardPrintSettings();
  loadPrintControls();
  $('#pdfSettingsModal').classList.add('show');
  await previewCurrentMemo();
}
function closePdfSettings(){clearTimeout(pdfDebounceTimer);$('#pdfSettingsModal').classList.remove('show');}
function updatePdfPreviewDebounced(){
  clearTimeout(pdfDebounceTimer);
  pdfDebounceTimer=setTimeout(()=>updatePdfPreview(),250);
}
async function updatePdfPreview(){
  const mod=await getPrintModule();
  pdfSettings=mod.saveWardPrintSettings(readPrintControls());
  await previewCurrentMemo();
}
async function resetPdfSettings(){
  if(!confirm('Reset all font sizes to the original Night Memo defaults?'))return;
  const mod=await getPrintModule();
  pdfSettings=mod.resetWardPrintSettings();loadPrintControls();await previewCurrentMemo();
}
function printPdf(){const f=$('#pdfPreviewFrame');f.contentWindow?.focus();f.contentWindow?.print();}
async function applyPdfSettings(){const mod=await getPrintModule();pdfSettings=mod.saveWardPrintSettings(readPrintControls());showStatus('loading','Choose “Save as PDF” in the print dialog.');printPdf();}

Object.assign(window,{sT,hDTab,calcEmpty,addEmptyDetail,addEB,addPt,addCs,addIt,addNR,toggleNil,toggleNilConsult,toggleNilIntub,saveEntry,handleGen,openPdfSettings,closePdfSettings,printPdf,applyPdfSettings,updatePdfPreviewDebounced,resetPdfSettings,toggleHistory,toggleStaffList,addStaffRow,getDataForTab,gdClose,gdConfirm,histReprint,histDeleteCurrent,maintenanceManagedNotice});
