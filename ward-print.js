// Original Night Memo print renderer adapted for the Supabase ward page.
// The visual structure and default font sizes follow the legacy Ward C5 app.

const STORAGE_KEY = 'nightMemoPdfSettingsV1';

export const DEFAULT_WARD_PRINT_SETTINGS = Object.freeze({
  topTitle: 19,
  topContent: 13,
  boxTitle: 15,
  boxContent: 12,
  lineHeader: 9,
  lineContent: 11,
  consHeader: 10,
  consContent: 10,
  intubHeader: 9,
  intubContent: 10,
  nurseTitle: 9,
  nurseContent: 11,
  sigContent: 11,
  infLabel: 12,
  infValue: 12,
  devLabel: 12,
  devValue: 12
});

export function loadWardPrintSettings(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    return raw?{...DEFAULT_WARD_PRINT_SETTINGS,...JSON.parse(raw)}:{...DEFAULT_WARD_PRINT_SETTINGS};
  }catch{
    return {...DEFAULT_WARD_PRINT_SETTINGS};
  }
}

export function saveWardPrintSettings(settings){
  const merged={...DEFAULT_WARD_PRINT_SETTINGS,...(settings||{})};
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(merged));}catch{}
  return merged;
}

export function resetWardPrintSettings(){
  try{localStorage.removeItem(STORAGE_KEY);}catch{}
  return {...DEFAULT_WARD_PRINT_SETTINGS};
}

function escHtml(v){
  return String(v==null?'':v).replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function fmtDate(v){
  if(!v)return'';
  const p=String(v).split('-');
  const ms=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return p.length===3?`${p[2]}-${ms[(+p[1])-1]||p[1]}-${p[0]}`:String(v);
}

function memoFontSettings(settings){
  const S=settings||{};
  const num=(v,d,min,max)=>{v=parseFloat(v);if(Number.isNaN(v))v=d;return Math.max(min,Math.min(max,v));};
  return{
    topTitle:num(S.topTitle,19,16,28),
    topContent:num(S.topContent,13,9,18),
    boxTitle:num(S.boxTitle,15,10,19),
    boxContent:num(S.boxContent,12,8,17),
    infLabel:num(S.infLabel,12,8,16),
    infValue:num(S.infValue,12,8,16),
    devLabel:num(S.devLabel,12,8,16),
    devValue:num(S.devValue,12,8,16),
    lineHeader:num(S.lineHeader,9,7,13),
    lineContent:num(S.lineContent,11,7,13),
    consHeader:num(S.consHeader,10,7,14),
    consContent:num(S.consContent,10,7,14),
    intubHeader:num(S.intubHeader,9,7,14),
    intubContent:num(S.intubContent,10,7,13),
    nurseTitle:num(S.nurseTitle,9,7,13),
    nurseContent:num(S.nurseContent,11,8,15),
    sigContent:num(S.sigContent,11,8,15)
  };
}

const BUILTIN_INF=[
  ['iCRE','CRE:'],['iVRE','VRE:'],['iCOV','COVID:'],['iMDR','MDRA:'],
  ['iCD','CD+ve:'],['iInf','Inf+ve:'],['iCA','Candida Auris Other Contact:']
];
const BUILTIN_DEV=[
  ['dMV','MV:'],['dNIV','NIV:'],['dHF','HFNC:'],['dHD','HD:'],['dCA','CAPD:']
];

function activeItemMap(items){
  const m=new Map();
  (items||[]).filter(i=>i&&i.active!==false).forEach(i=>m.set(i.key,i));
  return m;
}

function dynamicItemsFor(items,section){
  return (items||[]).filter(i=>i&&!i.builtin&&i.active!==false&&i.section===section);
}

function dynamicValue(D,item){
  return D?.dynamicItems?.[item.key];
}

function countValue(v){
  if(Array.isArray(v))return v.length;
  if(v&&typeof v==='object'){
    if(v.mode==='count')return Number(v.count)||0;
    if(Array.isArray(v.beds))return v.beds.length;
  }
  if(typeof v==='boolean')return v?1:0;
  const n=Number(v);return Number.isFinite(n)?n:0;
}

function memoDetailLoad(D,items){
  let infTotal=0,devTotal=0,active=0;
  const map=activeItemMap(items);
  BUILTIN_INF.forEach(([key])=>{
    if(map.has(key)||!(items||[]).length){const n=(D.infBeds?.[key]||[]).length;infTotal+=n;if(n>0)active++;}
  });
  dynamicItemsFor(items,'infection').forEach(item=>{const n=countValue(dynamicValue(D,item));infTotal+=n;if(n>0)active++;});
  BUILTIN_DEV.forEach(([key])=>{
    if(map.has(key)||!(items||[]).length){const n=countValue(D.devBeds?.[key]);devTotal+=n;if(n>0)active++;}
  });
  dynamicItemsFor(items,'devices').forEach(item=>{const n=countValue(dynamicValue(D,item));devTotal+=n;if(n>0)active++;});
  return{inf:infTotal,dev:devTotal,total:infTotal+devTotal,active};
}

function memoDensityClass(D,items){
  const pt=D.nilSpecial?0:(D.patients||[]).length;
  const con=(D.consultations||[]).length;
  const intb=(D.intubations||[]).length;
  const nur=(D.nurses||[]).length;
  const detail=memoDetailLoad(D,items);
  const pressure=pt*2+con*2+intb*3+nur+Math.ceil(detail.total/8);
  if(pressure>18||detail.total>30||detail.active>8)return'dense';
  if(pressure>10||detail.total>14||detail.active>5)return'compact';
  return'elegant';
}

function memoBedValue(arr){
  arr=Array.isArray(arr)?arr:[];
  if(!arr.length)return'<span class="nil">Nil</span>';
  return escHtml(arr.join(', ')).replace(/, /g,',<wbr> ')+'<span class="total">(Total='+arr.length+')</span>';
}

function memoDevValue(devData){
  if(!devData)return'<span class="nil">Nil</span>';
  if(Array.isArray(devData))return memoBedValue(devData);
  if(devData.mode==='count'){
    const n=parseInt(devData.count,10)||0;
    return n>0?'<span class="total">(Total='+n+')</span>':'<span class="nil">Nil</span>';
  }
  return memoBedValue(devData.beds||[]);
}

function memoGenericValue(v,item){
  if(item?.input_type==='bed_chooser')return memoBedValue(Array.isArray(v)?v:[]);
  if(item?.input_type==='bed_or_count')return memoDevValue(v);
  if(Array.isArray(v))return memoBedValue(v);
  if(typeof v==='boolean')return v?'Yes':'Nil';
  if(v&&typeof v==='object')return escHtml(JSON.stringify(v));
  const s=String(v??'').trim();
  return s?escHtml(s):'<span class="nil">Nil</span>';
}

function memoKV(label,value){
  return'<div class="kv"><div class="k">'+escHtml(label)+'</div><div class="v">'+value+'</div></div>';
}

function memoInfectionHtml(D,items){
  const infBeds=D.infBeds||{};
  const map=activeItemMap(items);
  let html='';
  BUILTIN_INF.forEach(([key,legacyLabel])=>{
    const item=map.get(key);
    if(item||!(items||[]).length)html+=memoKV(item?.label?`${item.label}:`:legacyLabel,memoBedValue(infBeds[key]||[]));
  });
  dynamicItemsFor(items,'infection').forEach(item=>{
    html+=memoKV(`${item.label||item.key}:`,memoGenericValue(dynamicValue(D,item),item));
  });
  return html;
}

function memoDeviceHtml(D,items){
  const devBeds=D.devBeds||{};
  const map=activeItemMap(items);
  let html='';
  BUILTIN_DEV.forEach(([key,legacyLabel])=>{
    const item=map.get(key);
    if(item||!(items||[]).length){
      // Keep the original printed abbreviations, especially NIV rather than the longer maintenance label.
      html+=memoKV(legacyLabel,memoDevValue(devBeds[key]));
    }
  });
  dynamicItemsFor(items,'devices').forEach(item=>{
    html+=memoKV(`${item.label||item.key}:`,memoGenericValue(dynamicValue(D,item),item));
  });
  return html;
}

function memoPatientRows(D){
  if(D.nilSpecial)return'<div class="nil-special">Nil Special</div>';
  const rows=[];
  (D.patients||[]).forEach(r=>{
    rows.push('<div class="patient-row"><div>'+escHtml(r[0])+'</div><div>'+escHtml(r[1])+'</div><div>'+escHtml(r[2])+'</div></div>');
  });
  const blanks=Math.max(2,8-rows.length);
  for(let i=0;i<blanks;i++)rows.push('<div class="patient-row blank"><div></div><div></div><div></div></div>');
  return rows.join('');
}

function memoConsultRows(D){
  const rows=[],data=D.nilConsultation?[]:(D.consultations||[]),count=Math.max(3,data.length);
  for(let i=0;i<count;i++){
    const r=data[i]||['','',''];
    rows.push('<tr><td>'+escHtml(r[0])+'</td><td>'+escHtml(r[1])+'</td><td>'+escHtml(r[2])+'</td></tr>');
  }
  return rows.join('');
}

function memoIntubRows(D){
  const rows=[],data=D.nilIntubation?[]:(D.intubations||[]),count=Math.max(1,data.length);
  for(let i=0;i<count;i++){
    const r=data[i]||['','','','','','','',''];
    rows.push('<tr>'+[0,1,2,3,4,5,6,7].map(idx=>'<td>'+escHtml(r[idx])+'</td>').join('')+'</tr>');
  }
  return rows.join('');
}

function memoNurseLines(D){
  const lines=[],nrs=D.nurses||[];
  if(nrs.length){
    nrs.forEach((n,i)=>{
      lines.push('<div>'+(i+1)+'. '+escHtml((n.role||'RN')+' '+(n.name||''))+' (appt: '+escHtml(n.appt||'______')+')'+(n.runner?' (Night Runner)':'')+'</div>');
    });
  }else{
    lines.push('<div>1. <span class="longline"></span> (appt: ______)</div>');
  }
  lines.push('<div>No of staff in AM duty: '+escHtml(D.staffAM||'_____')+'</div>');
  lines.push('<div>No of staff in PM duty: '+escHtml(D.staffPM||'_____')+'</div>');
  return lines.join('');
}

function emptyBedInfo(D,ward,capacity){
  const computed=Math.max(0,(Number(capacity)||0)-(Number(D.totalPatientM)||0));
  const count=Number.isFinite(Number(D.emptyBeds?.count))?Number(D.emptyBeds.count):computed;
  const mode=ward?.empty_bed_gender_mode||'none';
  const prefix=mode==='male'?'M ':mode==='female'?'F ':'';
  const details=(D.emptyBeds?.details||[]).filter(x=>x&&(x.location||x.gender||x.remark));
  let detailHtml='';
  if(details.length){
    detailHtml='<div class="empty-detail-note">'+details.map(x=>{
      const bits=[];
      if(x.gender)bits.push(escHtml(x.gender));
      if(x.location)bits.push(escHtml(x.location));
      let text=bits.join(' ');
      if(x.remark)text+=(text?' ':'')+'('+escHtml(x.remark)+')';
      return text;
    }).join('<br>')+'</div>';
  }
  return{count,prefix,detailHtml};
}

function legacyFlowGenderPrefix(ward){
  // The original C5 form prints M on flow/total fields because C5 is a male ward.
  // For mixed/dynamic or other wards, gender is intentionally omitted outside Empty Bed.
  return ward?.empty_bed_gender_mode==='male'?'M ':'';
}

function additionalItemsHtml(D,items){
  const extras=(items||[]).filter(i=>i&&!i.builtin&&i.active!==false&&!['infection','devices'].includes(i.section));
  const used=extras.filter(i=>{
    const v=dynamicValue(D,i);
    return !(v==null||v===''||(Array.isArray(v)&&!v.length)||v===false);
  });
  if(!used.length)return'';
  return '<div class="additional-strip"><b>Additional:</b> '+used.map(i=>'<span><b>'+escHtml(i.label||i.key)+':</b> '+memoGenericValue(dynamicValue(D,i),i)+'</span>').join(' &nbsp;&nbsp; ')+'</div>';
}

export function renderWardMemoHtml({ward,report,capacity,items=[],settings,logoUrl}){
  const D=report?.payload||{};
  const S={...DEFAULT_WARD_PRINT_SETTINGS,...(settings||{})};
  const F=memoFontSettings(S),density=memoDensityClass(D,items);
  const date=report?.report_date||D.date||'',fD=fmtDate(date);
  const totalPatient=D.totalPatientM||'0';
  const empty=emptyBedInfo(D,ward,capacity);
  const flowPrefix=legacyFlowGenderPrefix(ward);
  const earlyBirds=(D.earlyBirds||[]).filter(e=>e.bed||e.dest).map(e=>escHtml((e.bed||'__')+'-->'+(e.dest||'____'))).join('<br>');
  const sigRank=D.sigRank||'RN',sigName=(D.sigName||'').trim(),sigAppt=(D.sigAppt||'').trim();
  const wardName=ward?.display_name||ward?.code||'Ward';
  const phone=ward?.phone||'—',fax=ward?.fax||'—';
  const logo=logoUrl?'<img class="logo" src="'+escHtml(logoUrl)+'">':'';

  return'<!doctype html><html><head><meta charset="utf-8"><title>Night Memo</title><style>'+ 
    '@page{size:A4;margin:0;}html,body{margin:0;padding:0;background:#777;}*{box-sizing:border-box;}body{font-family:Tahoma,Arial,sans-serif;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact;}'+
    '.preview-wrap{min-height:100vh;display:flex;justify-content:center;align-items:flex-start;padding:18px;}'+
    '.memo-page{width:210mm;min-height:297mm;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.35);padding:6mm;display:flex;flex-direction:column;}'+
    '@media print{html,body{background:#fff;}.preview-wrap{display:block;padding:0;}.memo-page{box-shadow:none;min-height:297mm;}}'+
    '.memo-header{position:relative;height:51mm;flex:0 0 auto;border-bottom:.45mm solid #000;}'+
    '.logo{position:absolute;top:0;left:50%;transform:translateX(-50%);width:17mm;height:auto;}'+
    '.title{position:absolute;top:20mm;left:0;width:100%;text-align:center;font-size:'+F.topTitle+'pt;font-weight:700;text-decoration:underline;line-height:1;}'+
    '.top-left{position:absolute;left:0;top:29mm;width:82mm;font-size:'+F.topContent+'pt;line-height:1.35;}'+
    '.top-right{position:absolute;left:99mm;top:29mm;width:96mm;font-size:'+F.topContent+'pt;line-height:1.35;}'+
    '.top-row{display:grid;grid-template-columns:16mm 5mm 1fr;margin-bottom:2mm;}.top-label{font-weight:700;}'+
    '.divider-svg{position:absolute;left:91mm;top:28mm;width:7mm;height:22mm;}'+
    'table{border-collapse:collapse;width:100%;table-layout:fixed;}td,th{border:.18mm solid #000;vertical-align:top;padding:.9mm;font-weight:400;}th{font-weight:700;}'+
    '.summary-table{flex:0 0 auto;margin-top:1.6mm;border:.42mm solid #000;font-size:'+F.boxContent+'pt;line-height:1.08;}'+
    '.summary-table td{border-color:#777;padding:1.4mm 1.6mm;}'+
    '.section-title{font-size:'+F.boxTitle+'pt;font-weight:700;line-height:1.05;margin-bottom:1.5mm;}'+
    '.bigline{font-size:'+F.boxContent+'pt;font-weight:400;line-height:1.32;margin-bottom:1mm;}'+
    '.bignum{font-size:1em;font-weight:400;}'+
    '.transfer .section-title{margin-bottom:1mm;}.transfer .bigline{white-space:nowrap;}.summary-table td.transfer{padding-left:1mm;padding-right:1mm;}'+
    '.thin-line{border-bottom:.18mm solid #777;margin:1mm 0 2mm;}'+
    '.kv{display:block;break-inside:avoid;page-break-inside:avoid;margin-bottom:.95mm;}.k{display:inline;font-size:'+F.infLabel+'pt;font-weight:700;line-height:1.08;}.v{display:inline;font-size:'+F.infValue+'pt;font-weight:400;line-height:1.08;overflow-wrap:anywhere;}.dev .k{font-size:'+F.devLabel+'pt;}.dev .v{font-size:'+F.devValue+'pt;}'+
    '.nil{font-weight:400;}.total{display:inline;font-weight:400;white-space:nowrap;margin-left:.7mm;}'+
    '.total-line{font-size:'+F.boxTitle+'pt;font-weight:700;border-bottom:.18mm solid #777;padding-bottom:1mm;margin-bottom:1.5mm;line-height:1.1;white-space:nowrap;}'+
    '.empty-detail-note{font-size:7.3pt;line-height:1.15;margin:-.4mm 0 1.2mm;padding:0 .5mm;color:#222;overflow-wrap:anywhere;}'+
    '.early{background:#fffbd1;min-height:17mm;padding:1.5mm;font-size:8pt;font-weight:400;line-height:1.15;}.early b{font-size:8.5pt;}.early i{font-size:7pt;}'+
    '.additional-strip{border:.18mm solid #777;border-top:0;padding:1.1mm 1.5mm;font-size:8pt;line-height:1.2;}'+
    '.patient-section{flex:0 0 auto;margin-top:1.2mm;}.patient-head{display:grid;grid-template-columns:18mm 54mm 1fr;font-weight:700;font-size:'+F.lineHeader+'pt;margin-bottom:.7mm;}'+
    '.patient-lines{font-size:'+F.lineContent+'pt;}.patient-row{display:grid;grid-template-columns:18mm 54mm 1fr;min-height:2.8mm;border-bottom:.15mm solid #aaa;line-height:1.05;padding-top:.2mm;}.nil-special{text-align:center;font-weight:700;font-size:12pt;padding:3mm 0;}'+
    '.consult-note{font-size:6pt;font-weight:700;margin-top:4mm;}'+
    '.memo-table-box{position:relative;width:100%;}.memo-cross-body{display:none;position:absolute;left:0;right:0;top:0;height:0;z-index:4;width:100%;pointer-events:none;}.crossed .memo-cross-body{display:block;}.memo-cross-body line{stroke:#000;stroke-width:1.45px;vector-effect:non-scaling-stroke;}'+
    '.consult{font-size:'+F.consContent+'pt;}.consult th{font-size:'+F.consHeader+'pt;text-align:left;}.consult td{height:8.5mm;}'+
    '.intub{margin-top:1.4mm;font-size:'+F.intubContent+'pt;}.intub th{font-size:'+F.intubHeader+'pt;text-align:center;line-height:1.05;}.intub small{display:block;font-size:6pt;font-style:italic;font-weight:400;line-height:1.05;}.intub td{height:8mm;}'+
    '.memo-spacer{flex:1 1 auto;min-height:8mm;}'+
    '.memo-footer{flex:0 0 auto;display:grid;grid-template-columns:1fr 74mm;column-gap:18mm;margin-top:8mm;align-items:end;}'+
    '.nurse{font-size:'+F.nurseContent+'pt;line-height:1.3;}.nurse-title{font-size:'+F.nurseTitle+'pt;font-weight:700;margin-bottom:2mm;}'+
    '.signature{font-size:'+F.sigContent+'pt;line-height:1.45;}.sigline{border-top:.25mm solid #000;height:2.5mm;}.stamp{text-align:right;font-size:7pt;color:#888;margin-top:2mm;}'+
    '.longline{display:inline-block;border-bottom:.25mm solid #000;width:44mm;height:3mm;}.linefill{display:inline-block;border-bottom:.25mm solid #000;width:20mm;height:3mm;}'+
    '.compact .patient-row{min-height:2.4mm;}.compact .consult td,.compact .intub td{height:6mm;}'+
    '.dense .summary-table td{padding:1mm;}.dense .kv{margin-bottom:.45mm;}.dense .patient-row{min-height:2mm;}.dense .consult td,.dense .intub td{height:5mm;padding:.6mm;}'+
    '</style></head><body><div class="preview-wrap"><div class="memo-page '+density+'">'+
      '<div class="memo-header">'+logo+
        '<div class="title">Night Memo</div>'+
        '<div class="top-left">'+
          '<div class="top-row"><div class="top-label">From</div><div>:</div><div><b>'+escHtml(wardName)+'</b></div></div>'+
          '<div class="top-row"><div class="top-label">Tel</div><div>:</div><div>Ext '+escHtml(phone)+'</div></div>'+
          '<div class="top-row"><div class="top-label">Fax</div><div>:</div><div>Ext '+escHtml(fax)+'</div></div>'+
        '</div>'+
        '<svg class="divider-svg" viewBox="0 0 20 80" preserveAspectRatio="none"><line x1="5" y1="0" x2="5" y2="80" stroke="#000" stroke-width="2"/><line x1="15" y1="0" x2="15" y2="80" stroke="#000" stroke-width="2"/></svg>'+
        '<div class="top-right">'+
          '<div class="top-row"><div class="top-label">To</div><div>:</div><div><b>DOM (Medical)</b></div></div>'+
          '<div class="top-row"><div class="top-label">via</div><div></div><div>Night NO i/c medical wards</div></div>'+
          '<div class="top-row"><div class="top-label">Date</div><div>:</div><div>'+escHtml(fD)+'</div></div>'+
        '</div>'+
      '</div>'+
      '<table class="summary-table"><colgroup><col style="width:16%"><col style="width:9%"><col style="width:24%"><col style="width:24%"><col style="width:27%"></colgroup><tbody><tr>'+
        '<td><div class="section-title">Admission:</div><div class="bigline">E/C&nbsp;&nbsp;&nbsp;&nbsp; '+escHtml(flowPrefix)+'<span class="bignum">'+escHtml(D.admissionEC||'0')+'</span></div><div class="bigline">C/C&nbsp;&nbsp;&nbsp;&nbsp; '+escHtml(flowPrefix)+'<span class="bignum">'+escHtml(D.admissionCC||'0')+'</span></div><div class="section-title" style="margin-top:3mm">Discharge:</div><div class="bigline">'+escHtml(flowPrefix)+'<span class="bignum">'+escHtml(D.discharge||'0')+'</span></div><div class="section-title" style="margin-top:2mm">Death: <span class="bignum">'+escHtml(D.death||'0')+'</span></div></td>'+
        '<td class="transfer"><div class="section-title">T/I:</div><div class="bigline">Gen&nbsp; '+escHtml(D.transferIn||'0')+'</div><div class="thin-line"></div><div class="section-title">T/O:</div><div class="bigline">Gen&nbsp; '+escHtml(D.transferOut||'0')+'</div><div class="thin-line"></div></td>'+
        '<td>'+memoInfectionHtml(D,items)+'</td>'+
        '<td class="dev">'+memoDeviceHtml(D,items)+'</td>'+
        '<td><div class="total-line">Total Patient: '+escHtml(flowPrefix)+escHtml(totalPatient)+'</div><div class="total-line">Empty Bed: '+escHtml(empty.prefix)+escHtml(empty.count)+'</div>'+empty.detailHtml+'<div class="early"><b>Next day early bird:</b> <i>eg.15--&gt;KH3A</i><br>'+earlyBirds+'</div></td>'+
      '</tr></tbody></table>'+additionalItemsHtml(D,items)+
      '<div class="patient-section"><div class="patient-head"><div>Bed No.</div><div>Name of Patient</div><div>Diagnosis / Condition / Progress</div></div><div class="patient-lines">'+memoPatientRows(D)+'</div></div>'+
      '<div class="consult-note">Please mark down cases awaiting subspecialty consultation (only apply to Fri, Sat &amp; day before public holiday)</div>'+
      '<div class="memo-table-box consult-box '+(D.nilConsultation?'crossed':'')+'"><table class="consult"><colgroup><col style="width:18mm"><col style="width:52mm"><col></colgroup><thead><tr><th>Bed No</th><th>Name</th><th>Pending which subspecialty consultation</th></tr></thead><tbody>'+memoConsultRows(D)+'</tbody></table><svg class="memo-cross-body" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="0" x2="100" y2="100"/><line x1="0" y1="100" x2="100" y2="0"/></svg></div>'+
      '<div class="memo-table-box intub-box '+(D.nilIntubation?'crossed':'')+'"><table class="intub"><colgroup><col style="width:12mm"><col style="width:30mm"><col style="width:24mm"><col style="width:22mm"><col style="width:22mm"><col style="width:20mm"><col style="width:22mm"><col></colgroup><thead><tr><th rowspan="2">Bed<br>No.</th><th rowspan="2">Name of patient<br>&amp;<br>Hospital Number</th><th rowspan="2">Diagnosis</th><th colspan="5">Intubation</th></tr><tr><th>Reason</th><th>Elective or<br>Emergency</th><th>By whom<small>e.g. Anaes<br>Parent team</small></th><th>Location<small>e.g Intubation Rm<br>/ Cubicle</small></th><th>Patient outcome<small>e.g. To ICU/G6/G10<br>Stay in ward / death</small></th></tr></thead><tbody>'+memoIntubRows(D)+'</tbody></table><svg class="memo-cross-body" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="0" x2="100" y2="100"/><line x1="0" y1="100" x2="100" y2="0"/></svg></div>'+
      '<div class="memo-spacer"></div>'+
      '<div class="memo-footer"><div class="nurse"><div class="nurse-title">Night Nurse:</div>'+memoNurseLines(D)+'</div><div><div class="signature"><div class="sigline"></div><div>Signature</div><div>Rank &amp; Name: '+escHtml(sigRank)+'&nbsp; '+(sigName?escHtml(sigName):'<span class="linefill"></span>')+'</div><div>Appointment: '+(sigAppt?escHtml(sigAppt):'<span class="linefill"></span>')+'</div></div><div class="stamp">ward memo:&nbsp;&nbsp; Dec / 2022</div></div></div>'+
    '</div></div></body></html>';
}

export function positionMemoCrosses(frame){
  const doc=frame?.contentDocument;
  if(!doc)return false;
  const boxes=doc.querySelectorAll('.memo-table-box.crossed');
  const win=frame.contentWindow;
  for(const box of boxes){
    const table=box.querySelector('table'),cross=box.querySelector('.memo-cross-body');
    if(!table||!cross)continue;
    const tbody=table.tBodies?.[0];
    if(!tbody||!tbody.rows.length){cross.style.display='none';continue;}
    const theadHeight=table.tHead?table.tHead.offsetHeight:0;
    const mt=win?parseFloat(win.getComputedStyle(table).marginTop)||0:0;
    cross.style.top=(theadHeight+mt)+'px';
    cross.style.height=tbody.offsetHeight+'px';
  }
  return true;
}

export function writeWardMemoToIframe(iframe,context,afterLoad){
  return new Promise(resolve=>{
    iframe.onload=()=>{
      iframe.onload=null;
      setTimeout(()=>{
        positionMemoCrosses(iframe);
        if(afterLoad)afterLoad(iframe);
        resolve(iframe);
      },180);
    };
    iframe.srcdoc=renderWardMemoHtml(context);
  });
}

export async function printWardMemo(context){
  let frame=document.getElementById('memoPrintFrame');
  if(!frame){
    frame=document.createElement('iframe');
    frame.id='memoPrintFrame';
    frame.style.cssText='position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;';
    document.body.appendChild(frame);
  }
  await writeWardMemoToIframe(frame,context);
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
}
