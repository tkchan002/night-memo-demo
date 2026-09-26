import { requireRole, signOut } from './auth.js';
import { getNightBundle, getReportItems, getWardCapacity } from './database.js';
import { qs,qsa,esc,todayISO,toDisplayDate,flash,setAppHeader,numberValue } from './app.js';
import { renderFullReport } from './report-renderer.js';

const state={access:null,bundle:[],items:[],selected:null};
init().catch(e=>{console.error(e);flash(e.message||String(e),'error',8000)});
async function init(){state.access=await requireRole('manager');if(!state.access)return;setAppHeader({title:'Patrol Night',subtitle:'Nightly summary and complete ward reports',access:state.access});qs('#reportDate').value=todayISO();bind();await refresh();}
function bind(){qs('#logoutBtn').onclick=signOut;qs('#refreshBtn').onclick=refresh;qs('#printBtn').onclick=()=>window.print();qs('#reportDate').onchange=refresh;qs('#memoSection').onchange=refresh;qs('#drawerClose').onclick=()=>qs('#reportDrawer').classList.remove('show');qs('#reportDrawer').addEventListener('click',e=>{if(e.target===qs('#reportDrawer'))qs('#reportDrawer').classList.remove('show')});qs('#drawerPrint').onclick=printSelectedFullReport;}
async function refresh(){const date=qs('#reportDate').value,section=qs('#memoSection').value;state.items=await getReportItems(date);state.bundle=await getNightBundle(date,section);qs('#sectionTitle').textContent=section;qs('#printDateLabel').textContent=toDisplayDate(date);renderSummary();}
function countDev(v){if(!v)return 0;if(Array.isArray(v))return v.length;if(v.mode==='count')return numberValue(v.count);return (v.beds||[]).length;}
function bedText(v){return Array.isArray(v)&&v.length?v.join(', '):'—';}
function devText(v){const n=countDev(v);if(!v||!n)return'—';if(v.mode==='count')return String(n);return `${n} (${(v.beds||[]).join(', ')})`;}
function emptyCell(ward,report,capacity){if(!report)return'—';const D=report.payload||{},e=D.emptyBeds||{count:Math.max(0,numberValue(capacity)-numberValue(D.totalPatientM)),details:[]};if(ward.empty_bed_gender_mode!=='dynamic')return String(e.count??0);const d=e.details||[];if(!d.length)return String(e.count??0);const m=d.filter(x=>x.gender==='M').length,f=d.filter(x=>x.gender==='F').length,other=d.length-m-f;const parts=[];if(m)parts.push(`${m}M`);if(f)parts.push(`${f}F`);if(other)parts.push(`${other}U`);const remarks=d.filter(x=>x.remark).map(x=>`${x.gender||''}${x.location?` bed ${x.location}`:''}: ${x.remark}`);return `${parts.join(' / ')}${remarks.length?` · ${remarks.join('; ')}`:''}`;}
function renderSummary(){
  const rows=state.bundle.map(({ward,capacity,report})=>{const D=report?.payload||{};return `<tr class="${report?'submitted':'missing'}"><td class="ward-link" data-ward="${esc(ward.id)}">${esc(ward.code)}</td><td>${esc(D.admissionEC||'—')}</td><td>${esc(D.admissionCC||'—')}</td><td>${esc(D.transferIn||'—')}</td><td>${esc(D.discharge||'—')}</td><td>${esc(D.transferOut||'—')}</td><td>${esc(D.death||'—')}</td><td>${esc(D.totalPatientM||'—')}</td><td>${esc(emptyCell(ward,report,capacity))}</td><td>${countDev(D.devBeds?.dMV)||'—'}</td><td>${countDev(D.devBeds?.dNIV)||'—'}</td><td>${countDev(D.devBeds?.dHF)||'—'}</td><td>${report?`${esc(D.staffAM||'—')} / ${esc(D.staffPM||'—')}`:'—'}</td><td class="screen-only-col">${report?'Submitted':'Not submitted'}</td></tr>`;}).join('');
  qs('#summaryRows').innerHTML=rows||'<tr><td colspan="14">No wards configured for this section/date.</td></tr>';
  const inf=state.bundle.map(({ward,report})=>{const D=report?.payload||{};const e=(D.earlyBirds||[]).map(x=>`${x.bed||'?'}→${x.dest||'?'}`).join('; ')||'—';return `<tr><td class="ward-link" data-ward="${esc(ward.id)}">${esc(ward.code)}</td><td>${esc(bedText(D.infBeds?.iCOV))}</td><td>${esc(bedText(D.infBeds?.iCRE))}</td><td>${esc(bedText(D.infBeds?.iVRE))}</td><td>${esc(bedText(D.infBeds?.iMDR))}</td><td>${esc(bedText(D.infBeds?.iCD))}</td><td>${esc(bedText(D.infBeds?.iInf))}</td><td>${esc(devText(D.devBeds?.dHD))}</td><td>${esc(devText(D.devBeds?.dCA))}</td><td>${esc(e)}</td></tr>`;}).join('');
  qs('#infectionRows').innerHTML=inf||'<tr><td colspan="10">No wards configured.</td></tr>';
  qsa('.ward-link').forEach(el=>el.onclick=()=>openWard(el.dataset.ward));
}
async function openWard(wardId){const entry=state.bundle.find(x=>x.ward.id===wardId);if(!entry)return;state.selected=entry;qs('#drawerTitle').textContent=`${entry.ward.code} · ${toDisplayDate(qs('#reportDate').value)}`;qs('#drawerBody').innerHTML=renderFullReport({ward:entry.ward,report:entry.report,capacity:entry.capacity,items:state.items});qs('#reportDrawer').classList.add('show');}

async function printSelectedFullReport(){
  if(!state.selected)return;
  const {ward,report,capacity}=state.selected;
  const html=renderFullReport({ward,report,capacity,items:state.items});
  const win=window.open('','_blank','width=1200,height=850');
  if(!win){flash('Pop-up blocked. Allow pop-ups to print.','error');return;}
  const css=new URL('./css/app.css',location.href).href, printCss=new URL('./css/print.css',location.href).href;
  win.document.write(`<!doctype html><html><head><title>${esc(ward.code)} ${esc(qs('#reportDate').value)}</title><link rel="stylesheet" href="${css}"><link rel="stylesheet" href="${printCss}"></head><body><main class="content">${html}</main><script>setTimeout(()=>window.print(),500)<\/script></body></html>`);
  win.document.close();
}
