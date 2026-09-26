import { DB_MODE } from './database.js';

export const qs=(s,p=document)=>p.querySelector(s);
export const qsa=(s,p=document)=>[...p.querySelectorAll(s)];
export const esc=(v='')=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
export const todayISO=()=>new Date().toISOString().slice(0,10);
export const toDisplayDate=(iso)=>{if(!iso)return'';const [y,m,d]=iso.split('-');return `${d}/${m}/${y}`;};
export const fromDisplayDate=(s)=>{const m=String(s||'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:s;};
export const formatDateTime=(v)=>v?new Date(v).toLocaleString():'';
export const numberValue=(v)=>{const n=Number(v);return Number.isFinite(n)?n:0;};

export function flash(message,type='info',timeout=3500){
  let host=qs('#toastHost');if(!host){host=document.createElement('div');host.id='toastHost';host.className='toast-host';document.body.append(host);}
  const el=document.createElement('div');el.className=`toast ${type}`;el.textContent=message;host.append(el);setTimeout(()=>el.remove(),timeout);
}

export function showBusy(el,on,label='Working…'){
  if(!el)return;
  if(on){el.dataset.oldText=el.textContent;el.disabled=true;el.textContent=label;}
  else{el.disabled=false;el.textContent=el.dataset.oldText||el.textContent;}
}

export function modeBadge(){return DB_MODE==='demo'?'<span class="mode-badge demo">Local demo mode</span>':'<span class="mode-badge live">Supabase live</span>';}

export function setAppHeader({title,subtitle='',access=null}){
  const t=qs('#appTitle'),s=qs('#appSubtitle'),u=qs('#userBadge'),m=qs('#modeBadge');
  if(t)t.textContent=title;if(s)s.textContent=subtitle;
  if(u&&access)u.textContent=access.role==='ward'?(access.wards?.code||access.login_id):access.display_name||access.login_id;
  if(m)m.innerHTML=modeBadge();
}

export function buildBedButtons(capacity,selected=[]){
  selected=selected.map(String);
  return `<div class="bed-grid">${Array.from({length:Math.max(0,Number(capacity)||0)},(_,i)=>{const b=String(i+1);return `<label class="bed-chip ${selected.includes(b)?'selected':''}"><input type="checkbox" value="${b}" ${selected.includes(b)?'checked':''}><span>${b}</span></label>`;}).join('')}</div>`;
}

export function getSelectedBeds(container){return qsa('input[type="checkbox"]:checked',container).map(x=>x.value).sort((a,b)=>Number(a)-Number(b));}

export function renderSimpleTable(rows,headers){
  return `<table class="data-table"><thead><tr>${headers.map(h=>`<th>${esc(h.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${headers.map(h=>`<td>${h.render?h.render(r):esc(r[h.key]??'')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

export function fullReportPayloadDefaults(){
  return {admissionEC:'0',admissionCC:'0',discharge:'0',death:'0',transferIn:'0',transferOut:'0',totalPatientM:'0',emptyBeds:{count:0,details:[]},earlyBirds:[],infBeds:{},devBeds:{},dynamicItems:{},nilSpecial:true,patients:[],nilConsultation:true,consultations:[],nilIntubation:true,intubations:[],nurses:[],staffAM:'',staffPM:'',sigRank:'RN',sigName:'',sigAppt:''};
}
