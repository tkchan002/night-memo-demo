import { esc, toDisplayDate, numberValue } from './app.js';

const beds=v=>Array.isArray(v)&&v.length?v.join(', '):'Nil';
const dev=v=>{
  if(!v)return'Nil';
  if(Array.isArray(v))return beds(v);
  if(v.mode==='count')return numberValue(v.count)>0?`Total: ${numberValue(v.count)}`:'Nil';
  return beds(v.beds||[]);
};

export function renderFullReport({ward,report,capacity,items=[]}){
  if(!report)return `<div class="empty-state">No report submitted.</div>`;
  const D=report.payload||{};
  const inf=items.filter(i=>i.section==='infection'&&i.builtin&&i.active!==false);
  const devices=items.filter(i=>i.section==='devices'&&i.builtin&&i.active!==false);
  const dynamic=items.filter(i=>!i.builtin&&i.active!==false);
  const empty=D.emptyBeds||{count:Math.max(0,numberValue(capacity)-numberValue(D.totalPatientM)),details:[]};
  const emptyDetails=(empty.details||[]).map(x=>`${esc(x.location||'')} ${x.gender?`(${esc(x.gender)})`:''}${x.remark?` – ${esc(x.remark)}`:''}`).join('<br>')||'—';
  const patientRows=D.nilSpecial?'<tr><td colspan="3" class="nil">Nil Special</td></tr>':(D.patients||[]).map(r=>`<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')||'<tr><td colspan="3">No entries</td></tr>';
  const consultRows=D.nilConsultation?'<tr><td colspan="3" class="nil">Nil Consultation</td></tr>':(D.consultations||[]).map(r=>`<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')||'<tr><td colspan="3">No entries</td></tr>';
  const intubRows=D.nilIntubation?'<tr><td colspan="8" class="nil">Nil Intubation</td></tr>':(D.intubations||[]).map(r=>`<tr>${Array.from({length:8},(_,i)=>`<td>${esc(r[i]||'')}</td>`).join('')}</tr>`).join('')||'<tr><td colspan="8">No entries</td></tr>';
  const nurses=(D.nurses||[]).map(n=>`<li><b>${esc(n.role||'')}</b> ${esc(n.name||'')}${n.appt?` <span class="muted">(${esc(n.appt)})</span>`:''}${n.runner?' <span class="tag">Night Runner</span>':''}${n.source==='free_text'?' <span class="tag subtle">Free text</span>':''}</li>`).join('')||'<li>None recorded</li>';
  const early=(D.earlyBirds||[]).filter(x=>x.bed||x.dest).map(x=>`<li>${esc(x.bed||'?')} → ${esc(x.dest||'?')}</li>`).join('')||'<li>None</li>';

  return `<article class="full-report">
    <header class="report-head">
      <div><h2>${esc(ward?.display_name||ward?.code||'Ward')}</h2><div>${esc(toDisplayDate(report.report_date))}</div></div>
      <div class="report-contact">Tel ${esc(ward?.phone||'—')} &nbsp; Fax ${esc(ward?.fax||'—')}<br>Capacity: ${esc(report.bed_capacity_snapshot??capacity??'—')}</div>
    </header>
    <section class="report-grid three">
      <div><h3>Admission / Flow</h3><dl><dt>Admission E/C</dt><dd>${esc(D.admissionEC||'0')}</dd><dt>Admission C/C</dt><dd>${esc(D.admissionCC||'0')}</dd><dt>Discharge</dt><dd>${esc(D.discharge||'0')}</dd><dt>Death</dt><dd>${esc(D.death||'0')}</dd><dt>Transfer In</dt><dd>${esc(D.transferIn||'0')}</dd><dt>Transfer Out</dt><dd>${esc(D.transferOut||'0')}</dd></dl></div>
      <div><h3>Bed Count</h3><dl><dt>Total Patient</dt><dd>${esc(D.totalPatientM||'0')}</dd><dt>Empty Bed</dt><dd>${esc(String(empty.count??0))}</dd><dt>Empty-bed detail</dt><dd>${emptyDetails}</dd></dl><h4>Next Day Early Bird</h4><ul>${early}</ul></div>
      <div><h3>Staffing</h3><dl><dt>AM duty</dt><dd>${esc(D.staffAM||'—')}</dd><dt>PM duty</dt><dd>${esc(D.staffPM||'—')}</dd><dt>Signature</dt><dd>${esc(`${D.sigRank||''} ${D.sigName||''}`.trim()||'—')}</dd><dt>Appointment</dt><dd>${esc(D.sigAppt||'—')}</dd></dl></div>
    </section>
    <section class="report-grid two">
      <div><h3>Infection Control</h3><dl>${inf.map(i=>`<dt>${esc(i.label)}</dt><dd>${esc(beds(D.infBeds?.[i.key]||[]))}</dd>`).join('')}</dl></div>
      <div><h3>Devices</h3><dl>${devices.map(i=>`<dt>${esc(i.label)}</dt><dd>${esc(dev(D.devBeds?.[i.key]))}</dd>`).join('')}</dl></div>
    </section>
    ${dynamic.length?`<section><h3>Additional Report Items</h3><dl class="wide-dl">${dynamic.map(i=>`<dt>${esc(i.label)}</dt><dd>${esc(formatDynamic(D.dynamicItems?.[i.key]))}</dd>`).join('')}</dl></section>`:''}
    <section><h3>Patient List</h3><table class="report-table"><thead><tr><th>Bed</th><th>Name</th><th>Diagnosis / Condition / Progress</th></tr></thead><tbody>${patientRows}</tbody></table></section>
    <section><h3>Subspecialty Consultation</h3><table class="report-table"><thead><tr><th>Bed</th><th>Name</th><th>Pending consultation</th></tr></thead><tbody>${consultRows}</tbody></table></section>
    <section><h3>Intubation Record</h3><table class="report-table compact"><thead><tr><th>Bed</th><th>Name / Hosp No.</th><th>Diagnosis</th><th>Reason</th><th>Elective / Emergency</th><th>By Whom</th><th>Location</th><th>Outcome</th></tr></thead><tbody>${intubRows}</tbody></table></section>
    <section><h3>Night Nurse</h3><ul class="nurse-list">${nurses}</ul></section>
    <footer>Saved ${esc(report.updated_at?new Date(report.updated_at).toLocaleString():(D.savedAt?new Date(D.savedAt).toLocaleString():''))}</footer>
  </article>`;
}

function formatDynamic(v){
  if(v==null||v==='')return'—';
  if(Array.isArray(v))return v.length?v.join(', '):'Nil';
  if(typeof v==='boolean')return v?'Yes':'No';
  if(typeof v==='object')return JSON.stringify(v);
  return String(v);
}
