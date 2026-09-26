import { CONFIG, isSupabaseConfigured } from './config.js';
import { DEMO_WARDS, DEMO_REPORT_ITEMS, DEMO_STAFF, DEMO_REPORTS, DEMO_ACCOUNTS } from './demo-data.js';

export const DB_MODE = isSupabaseConfigured() ? 'supabase' : 'demo';
let supabase = null;

if (DB_MODE === 'supabase') {
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}

export { supabase };

const DEMO_KEY = 'nightMemoDemoDbV4';
const uid = (prefix='id') => `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
const isoDate = d => (d || new Date().toISOString().slice(0,10));

function seedDemoState() {
  const wards = DEMO_WARDS.map(w => ({...w, id:`ward-${w.code}`, active:true, created_at:new Date().toISOString()}));
  const operating_periods = wards.map(w => ({id:uid('op'), ward_id:w.id, start_date:'2026-01-01', end_date:null, note:'Demo operating period'}));
  const capacity_history = wards.map(w => ({id:uid('cap'), ward_id:w.id, effective_from:'2026-01-01', effective_to:null, bed_capacity:w.capacity, note:'Initial demo capacity'}));
  const ward_staff = DEMO_STAFF.map(s => {
    const w = wards.find(x=>x.code===s.ward_code);
    return {...s, id:uid('staff'), ward_id:w.id, created_at:new Date().toISOString(), updated_at:new Date().toISOString()};
  });
  const report_items = DEMO_REPORT_ITEMS.map(r => ({...r, id:uid('item'), active:true, effective_from:'2026-01-01', effective_to:null, manager_slot:null, created_at:new Date().toISOString(), updated_at:new Date().toISOString()}));
  const ward_reports = DEMO_REPORTS.map(r => {
    const w = wards.find(x=>x.code===r.ward_code);
    return {...r, id:uid('report'), ward_id:w.id, created_at:new Date().toISOString(), updated_at:new Date().toISOString()};
  });
  const accounts = DEMO_ACCOUNTS.map(a => {
    const w = wards.find(x=>x.code===a.ward_code);
    return {...a, auth_user_id:uid('demo-user'), ward_id:w?.id || null, display_name:a.display_name||a.login_id, created_at:new Date().toISOString(), updated_at:new Date().toISOString()};
  });
  const manager_print_templates=[{...DEFAULT_MANAGER_PRINT_TEMPLATE,id:uid('mgrtpl'),version:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}];
  return {wards, operating_periods, capacity_history, ward_staff, report_items, ward_reports, accounts, audit_log:[], manager_print_templates};
}

export function ensureDemoState(reset=false) {
  if (DB_MODE !== 'demo') return null;
  if (reset || !localStorage.getItem(DEMO_KEY)) localStorage.setItem(DEMO_KEY, JSON.stringify(seedDemoState()));
  const s=JSON.parse(localStorage.getItem(DEMO_KEY));
  if(!Array.isArray(s.manager_print_templates)){
    s.manager_print_templates=[{...DEFAULT_MANAGER_PRINT_TEMPLATE,id:uid('mgrtpl'),version:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}];
    localStorage.setItem(DEMO_KEY,JSON.stringify(s));
  }
  return s;
}
function demoRead(){ return ensureDemoState(false); }
function demoWrite(s){ localStorage.setItem(DEMO_KEY, JSON.stringify(s)); return s; }
function dateInRange(date, start, end){ return (!start || date>=start) && (!end || date<=end); }
function asArray(v){ return Array.isArray(v) ? v : []; }

const DEFAULT_MANAGER_PRINT_TEMPLATE = {
  name:'Night Memo', status:'published', effective_from:'2000-01-01', effective_to:null,
  html_template:`<div class="memo-template"><h1 style="text-align:center;text-decoration:underline;margin:0 0 4px">Night Memo ({{section}})</h1><div style="text-align:center;margin-bottom:10px">{{report_date_display}}</div>{{ward_summary_table}}<h2 style="margin:16px 0 6px">Infection / Device Details</h2>{{infection_table}}</div>`,
  css_template:''
};

export function resetDemoDatabase(){ if(DB_MODE==='demo') ensureDemoState(true); }

export async function getCurrentAccess(authUserId=null) {
  if (DB_MODE === 'demo') {
    const session = JSON.parse(sessionStorage.getItem('nightMemoDemoSession') || 'null');
    if (!session) return null;
    const state = demoRead();
    const a = state.accounts.find(x=>x.login_id.toLowerCase()===session.login_id.toLowerCase());
    if (!a) return null;
    const ward = a.ward_id ? state.wards.find(w=>w.id===a.ward_id) : null;
    return {...a, wards:ward || null};
  }
  const userId = authUserId || (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return null;
  const {data,error} = await supabase.from('user_access').select('*, wards(id,code,display_name,phone,fax,empty_bed_gender_mode,manager_section,display_order,active)').eq('auth_user_id', userId).maybeSingle();
  if(error) throw error;
  return data;
}

export async function getAllWards() {
  if (DB_MODE==='demo') return demoRead().wards.slice().sort((a,b)=>a.display_order-b.display_order);
  const {data,error}=await supabase.from('wards').select('*').order('display_order').order('code');
  if(error) throw error; return data||[];
}

export async function getWardById(wardId) {
  if(DB_MODE==='demo') return demoRead().wards.find(w=>w.id===wardId)||null;
  const {data,error}=await supabase.from('wards').select('*').eq('id',wardId).maybeSingle();
  if(error) throw error; return data;
}

export async function getWardByCode(code) {
  if(DB_MODE==='demo') return demoRead().wards.find(w=>w.code.toLowerCase()===String(code).toLowerCase())||null;
  const {data,error}=await supabase.from('wards').select('*').ilike('code',code).maybeSingle();
  if(error) throw error; return data;
}

export async function getOperatingPeriods(wardId=null) {
  if(DB_MODE==='demo') {
    const a=demoRead().operating_periods; return a.filter(x=>!wardId||x.ward_id===wardId).sort((a,b)=>b.start_date.localeCompare(a.start_date));
  }
  let q=supabase.from('ward_operating_periods').select('*').order('start_date',{ascending:false});
  if(wardId) q=q.eq('ward_id',wardId);
  const {data,error}=await q; if(error) throw error; return data||[];
}

export async function getWardsForDate(date=isoDate(), section=null) {
  const wards=await getAllWards();
  const periods=await getOperatingPeriods();
  return wards.filter(w => {
    const open=periods.some(p=>p.ward_id===w.id && dateInRange(date,p.start_date,p.end_date));
    return open && (!section || w.manager_section===section);
  }).sort((a,b)=>a.display_order-b.display_order);
}

export async function isWardOperational(wardId,date=isoDate()) {
  const periods=await getOperatingPeriods(wardId);
  return periods.some(p=>dateInRange(date,p.start_date,p.end_date));
}

export async function getCapacityHistory(wardId) {
  if(DB_MODE==='demo') return demoRead().capacity_history.filter(x=>x.ward_id===wardId).sort((a,b)=>b.effective_from.localeCompare(a.effective_from));
  const {data,error}=await supabase.from('ward_capacity_history').select('*').eq('ward_id',wardId).order('effective_from',{ascending:false});
  if(error) throw error; return data||[];
}

export async function getWardCapacity(wardId,date=isoDate()) {
  const rows=await getCapacityHistory(wardId);
  const row=rows.find(x=>dateInRange(date,x.effective_from,x.effective_to));
  return row?.bed_capacity ?? null;
}

export async function getReportItems(date=isoDate(), includeInactive=false) {
  if(DB_MODE==='demo') {
    return demoRead().report_items.filter(r => includeInactive ? true : (r.active && dateInRange(date,r.effective_from,r.effective_to))).sort((a,b)=>a.sort_order-b.sort_order);
  }
  let q=supabase.from('report_items').select('*').order('sort_order');
  if(!includeInactive) q=q.eq('active',true);
  const {data,error}=await q; if(error) throw error;
  return includeInactive ? (data||[]) : (data||[]).filter(r=>dateInRange(date,r.effective_from,r.effective_to));
}

export async function getWardStaff(wardId, includeInactive=false) {
  if(DB_MODE==='demo') return demoRead().ward_staff.filter(s=>s.ward_id===wardId && (includeInactive||s.active)).sort((a,b)=>(a.display_order||0)-(b.display_order||0)||a.name.localeCompare(b.name));
  let q=supabase.from('ward_staff').select('*').eq('ward_id',wardId).order('display_order').order('name');
  if(!includeInactive) q=q.eq('active',true);
  const {data,error}=await q; if(error) throw error; return data||[];
}

export async function saveWardStaff(staff) {
  if(DB_MODE==='demo') {
    const s=demoRead(); const now=new Date().toISOString();
    const idx=s.ward_staff.findIndex(x=>x.id===staff.id);
    const row={...staff,id:staff.id||uid('staff'),updated_at:now,created_at:staff.created_at||now};
    if(idx>=0)s.ward_staff[idx]=row;else s.ward_staff.push(row); demoWrite(s); return row;
  }
  const {data,error}=await supabase.from('ward_staff').upsert(staff).select().single(); if(error) throw error; return data;
}

export async function setStaffActive(id,active) {
  if(DB_MODE==='demo'){const s=demoRead();const r=s.ward_staff.find(x=>x.id===id);if(r){r.active=active;r.updated_at=new Date().toISOString();demoWrite(s);}return r;}
  const {data,error}=await supabase.from('ward_staff').update({active,updated_at:new Date().toISOString()}).eq('id',id).select().single();if(error)throw error;return data;
}

export async function getWardReport(wardId,date=isoDate()) {
  if(DB_MODE==='demo') return demoRead().ward_reports.find(r=>r.ward_id===wardId&&r.report_date===date)||null;
  const {data,error}=await supabase.from('ward_reports').select('*').eq('ward_id',wardId).eq('report_date',date).maybeSingle(); if(error)throw error; return data;
}

export async function getReportsForDate(date=isoDate()) {
  if(DB_MODE==='demo') return demoRead().ward_reports.filter(r=>r.report_date===date);
  const {data,error}=await supabase.from('ward_reports').select('*').eq('report_date',date);if(error)throw error;return data||[];
}

export async function getRecentReports(wardId,limit=30) {
  if(DB_MODE==='demo') return demoRead().ward_reports.filter(r=>r.ward_id===wardId).sort((a,b)=>b.report_date.localeCompare(a.report_date)).slice(0,limit);
  const {data,error}=await supabase.from('ward_reports').select('*').eq('ward_id',wardId).order('report_date',{ascending:false}).limit(limit); if(error)throw error; return data||[];
}

export async function getPreviousReport(wardId,beforeDate) {
  if(DB_MODE==='demo') return demoRead().ward_reports.filter(r=>r.ward_id===wardId&&r.report_date<beforeDate).sort((a,b)=>b.report_date.localeCompare(a.report_date))[0]||null;
  const {data,error}=await supabase.from('ward_reports').select('*').eq('ward_id',wardId).lt('report_date',beforeDate).order('report_date',{ascending:false}).limit(1).maybeSingle();if(error)throw error;return data;
}

export async function upsertWardReport(row) {
  const now=new Date().toISOString();
  if(DB_MODE==='demo') {
    const s=demoRead(); const idx=s.ward_reports.findIndex(r=>r.ward_id===row.ward_id&&r.report_date===row.report_date);
    const out={...row,id:idx>=0?s.ward_reports[idx].id:uid('report'),created_at:idx>=0?s.ward_reports[idx].created_at:now,updated_at:now};
    if(idx>=0)s.ward_reports[idx]=out;else s.ward_reports.push(out);demoWrite(s);return out;
  }
  const {data,error}=await supabase.from('ward_reports').upsert({...row,updated_at:now},{onConflict:'ward_id,report_date'}).select().single();if(error)throw error;return data;
}

export async function getNightBundle(date=isoDate(),section='Male') {
  const wards=await getWardsForDate(date,section);
  const reports=await getReportsForDate(date);
  const capacities=await Promise.all(wards.map(w=>getWardCapacity(w.id,date)));
  return wards.map((w,i)=>({ward:w,capacity:capacities[i],report:reports.find(r=>r.ward_id===w.id)||null}));
}

export async function createWard(config) {
  const now=new Date().toISOString();
  if(DB_MODE==='demo') {
    const s=demoRead();
    if(s.wards.some(w=>w.code.toLowerCase()===config.code.toLowerCase())) throw new Error('Ward code already exists.');
    const ward={id:uid('ward'),code:config.code.toUpperCase(),display_name:config.display_name||`Ward ${config.code.toUpperCase()}`,phone:config.phone,fax:config.fax,empty_bed_gender_mode:config.empty_bed_gender_mode||'male',manager_section:config.manager_section||'Male',display_order:Number(config.display_order)||999,active:true,created_at:now,updated_at:now};
    s.wards.push(ward);
    s.operating_periods.push({id:uid('op'),ward_id:ward.id,start_date:config.start_date,end_date:config.end_date||null,note:config.note||'Ward opened'});
    s.capacity_history.push({id:uid('cap'),ward_id:ward.id,effective_from:config.start_date,effective_to:null,bed_capacity:Number(config.bed_capacity)||0,note:'Initial capacity'});
    s.audit_log.unshift({id:uid('audit'),occurred_at:now,action:'ward.create',entity_type:'ward',entity_id:ward.id,details:{code:ward.code}});
    demoWrite(s); return ward;
  }
  const {data:ward,error}=await supabase.from('wards').insert({code:config.code.toUpperCase(),display_name:config.display_name,phone:config.phone,fax:config.fax,empty_bed_gender_mode:config.empty_bed_gender_mode,manager_section:config.manager_section,display_order:Number(config.display_order)||999,active:true}).select().single(); if(error)throw error;
  const {error:e2}=await supabase.from('ward_operating_periods').insert({ward_id:ward.id,start_date:config.start_date,end_date:config.end_date||null,note:config.note||'Ward opened'}); if(e2)throw e2;
  const {error:e3}=await supabase.from('ward_capacity_history').insert({ward_id:ward.id,effective_from:config.start_date,bed_capacity:Number(config.bed_capacity),note:'Initial capacity'});if(e3)throw e3;
  await recordAudit('ward.create','ward',ward.id,{code:ward.code}); return ward;
}

export async function updateWard(wardId,patch) {
  if(DB_MODE==='demo'){const s=demoRead();const w=s.wards.find(x=>x.id===wardId);Object.assign(w,patch,{updated_at:new Date().toISOString()});demoWrite(s);return w;}
  const {data,error}=await supabase.from('wards').update({...patch,updated_at:new Date().toISOString()}).eq('id',wardId).select().single();if(error)throw error;await recordAudit('ward.update','ward',wardId,patch);return data;
}

export async function addOperatingPeriod(wardId,startDate,endDate=null,note='Ward reopened') {
  if(DB_MODE==='demo'){const s=demoRead();const r={id:uid('op'),ward_id:wardId,start_date:startDate,end_date:endDate||null,note};s.operating_periods.push(r);demoWrite(s);return r;}
  const {data,error}=await supabase.from('ward_operating_periods').insert({ward_id:wardId,start_date:startDate,end_date:endDate||null,note}).select().single();if(error)throw error;await recordAudit('ward.period.add','ward',wardId,{startDate,endDate,note});return data;
}

export async function closeOperatingPeriod(periodId,endDate,note='Ward closed') {
  if(DB_MODE==='demo'){const s=demoRead();const p=s.operating_periods.find(x=>x.id===periodId);if(p){p.end_date=endDate;p.note=note;}demoWrite(s);return p;}
  const {data,error}=await supabase.from('ward_operating_periods').update({end_date:endDate,note}).eq('id',periodId).select().single();if(error)throw error;await recordAudit('ward.period.close','ward_period',periodId,{endDate,note});return data;
}

export async function addCapacity(wardId,effectiveFrom,bedCapacity,note='Capacity changed') {
  if(DB_MODE==='demo') {
    const s=demoRead();
    const current=s.capacity_history.filter(x=>x.ward_id===wardId&&x.effective_from<effectiveFrom&&(!x.effective_to||x.effective_to>=effectiveFrom)).sort((a,b)=>b.effective_from.localeCompare(a.effective_from))[0];
    if(current){const d=new Date(effectiveFrom+'T00:00:00');d.setDate(d.getDate()-1);current.effective_to=d.toISOString().slice(0,10);}
    const r={id:uid('cap'),ward_id:wardId,effective_from:effectiveFrom,effective_to:null,bed_capacity:Number(bedCapacity),note};s.capacity_history.push(r);demoWrite(s);return r;
  }
  const {error:e1}=await supabase.rpc('add_ward_capacity',{p_ward_id:wardId,p_effective_from:effectiveFrom,p_bed_capacity:Number(bedCapacity),p_note:note});if(e1)throw e1;await recordAudit('ward.capacity.add','ward',wardId,{effectiveFrom,bedCapacity,note});return true;
}

export async function saveReportItem(item) {
  if(DB_MODE==='demo'){const s=demoRead();const idx=s.report_items.findIndex(x=>x.id===item.id);const now=new Date().toISOString();const row={...item,id:item.id||uid('item'),updated_at:now,created_at:item.created_at||now};if(idx>=0)s.report_items[idx]=row;else s.report_items.push(row);demoWrite(s);return row;}
  const {data,error}=await supabase.from('report_items').upsert(item).select().single();if(error)throw error;await recordAudit(item.id?'report_item.update':'report_item.create','report_item',data.id,{key:data.key,label:data.label});return data;
}

export async function getAccounts() {
  if(DB_MODE==='demo'){
    const s=demoRead();return s.accounts.map(a=>({...a,wards:a.ward_id?s.wards.find(w=>w.id===a.ward_id):null})).sort((a,b)=>a.login_id.localeCompare(b.login_id));
  }
  const {data,error}=await supabase.from('user_access').select('*, wards(id,code,display_name)').order('login_id');if(error)throw error;return data||[];
}

export async function adminAccount(action,payload) {
  if(DB_MODE==='demo'){
    const s=demoRead();
    if(action==='create'){
      if(s.accounts.some(a=>a.login_id.toLowerCase()===payload.login_id.toLowerCase()))throw new Error('Account already exists.');
      if(payload.role==='ward' && s.accounts.some(a=>a.role==='ward'&&a.ward_id===payload.ward_id))throw new Error('This ward already has a ward login account.');
      const a={auth_user_id:uid('demo-user'),login_id:payload.login_id,display_name:payload.display_name||payload.login_id,role:payload.role,ward_id:payload.role==='ward'?(payload.ward_id||null):null,active:true,demo_password:payload.password||'demo',created_at:new Date().toISOString(),updated_at:new Date().toISOString()};s.accounts.push(a);demoWrite(s);return a;
    }
    const a=s.accounts.find(x=>x.auth_user_id===payload.auth_user_id);if(!a)throw new Error('Account not found.');
    if(action==='reset_password'){a.demo_password=payload.password;}
    if(action==='rename_login'){a.login_id=payload.login_id;a.display_name=payload.display_name||a.display_name;}
    if(action==='update_access'){Object.assign(a,{role:payload.role,ward_id:payload.role==='ward'?(payload.ward_id||null):null,active:payload.active,display_name:payload.display_name||a.display_name});}
    a.updated_at=new Date().toISOString();demoWrite(s);return a;
  }
  const {data,error}=await supabase.functions.invoke('admin-users',{body:{action,...payload}});if(error)throw error;if(data?.error)throw new Error(data.error);return data;
}

export async function getAuditLog(limit=200) {
  if(DB_MODE==='demo')return demoRead().audit_log.slice(0,limit);
  const {data,error}=await supabase.from('audit_log').select('*').order('occurred_at',{ascending:false}).limit(limit);if(error)throw error;return data||[];
}

export async function recordAudit(action,entityType,entityId,details={}) {
  if(DB_MODE==='demo'){const s=demoRead();s.audit_log.unshift({id:uid('audit'),occurred_at:new Date().toISOString(),action,entity_type:entityType,entity_id:entityId,details});demoWrite(s);return;}
  const {error}=await supabase.from('audit_log').insert({action,entity_type:entityType,entity_id:entityId,details});
  if(error) console.warn('Audit insert failed',error);
}

// Manager print templates ----------------------------------------------------
export async function getManagerPrintTemplates() {
  if(DB_MODE==='demo') return demoRead().manager_print_templates.slice().sort((a,b)=>(b.version||0)-(a.version||0));
  const {data,error}=await supabase.from('manager_print_templates').select('*').order('version',{ascending:false});
  if(error) throw error; return data||[];
}

export async function getActiveManagerPrintTemplate(date=isoDate()) {
  if(DB_MODE==='demo') {
    return demoRead().manager_print_templates
      .filter(t=>t.status==='published' && dateInRange(date,t.effective_from,t.effective_to))
      .sort((a,b)=>(b.effective_from||'').localeCompare(a.effective_from||''))[0] || null;
  }
  const {data,error}=await supabase.from('manager_print_templates').select('*')
    .eq('status','published').lte('effective_from',date)
    .or(`effective_to.is.null,effective_to.gte.${date}`)
    .order('effective_from',{ascending:false}).limit(1).maybeSingle();
  if(error) throw error; return data;
}

export async function saveManagerPrintTemplate(row) {
  const now=new Date().toISOString();
  const clean={
    name:row.name||'Night Memo', html_template:row.html_template||DEFAULT_MANAGER_PRINT_TEMPLATE.html_template,
    css_template:row.css_template||'', status:'draft', effective_from:row.effective_from||null,
    effective_to:row.effective_to||null, updated_at:now
  };
  if(DB_MODE==='demo') {
    const s=demoRead();
    if(row.id){
      const i=s.manager_print_templates.findIndex(x=>x.id===row.id); if(i<0) throw new Error('Template not found.');
      const current=s.manager_print_templates[i];
      if(current.status==='published'){
        const maxV=Math.max(0,...s.manager_print_templates.map(x=>Number(x.version)||0));
        const draft={...clean,id:uid('mgrtpl'),version:maxV+1,created_at:now}; s.manager_print_templates.push(draft); demoWrite(s); return draft;
      }
      s.manager_print_templates[i]={...current,...clean}; demoWrite(s); return s.manager_print_templates[i];
    }
    const maxV=Math.max(0,...s.manager_print_templates.map(x=>Number(x.version)||0));
    const draft={...clean,id:uid('mgrtpl'),version:maxV+1,created_at:now};s.manager_print_templates.push(draft);demoWrite(s);return draft;
  }
  if(row.id){
    const {data:existing,error:e0}=await supabase.from('manager_print_templates').select('status').eq('id',row.id).single(); if(e0)throw e0;
    if(existing.status==='published'){
      const {data,error}=await supabase.from('manager_print_templates').insert(clean).select().single();if(error)throw error;return data;
    }
    const {data,error}=await supabase.from('manager_print_templates').update(clean).eq('id',row.id).select().single();if(error)throw error;return data;
  }
  const {data,error}=await supabase.from('manager_print_templates').insert(clean).select().single();if(error)throw error;return data;
}

export async function publishManagerPrintTemplate(id,effectiveFrom=isoDate()) {
  if(DB_MODE==='demo') {
    const s=demoRead(),target=s.manager_print_templates.find(x=>x.id===id); if(!target)throw new Error('Template not found.');
    const prior=s.manager_print_templates.filter(x=>x.id!==id&&x.status==='published'&&x.effective_from<effectiveFrom&&(!x.effective_to||x.effective_to>=effectiveFrom)).sort((a,b)=>b.effective_from.localeCompare(a.effective_from))[0];
    if(prior){const d=new Date(effectiveFrom+'T00:00:00');d.setDate(d.getDate()-1);prior.effective_to=d.toISOString().slice(0,10);}
    s.manager_print_templates.filter(x=>x.id!==id&&x.status==='published'&&x.effective_from===effectiveFrom).forEach(x=>x.status='retired');
    const future=s.manager_print_templates.filter(x=>x.id!==id&&x.status==='published'&&x.effective_from>effectiveFrom).sort((a,b)=>a.effective_from.localeCompare(b.effective_from))[0];
    target.status='published';target.effective_from=effectiveFrom;target.effective_to=future?(()=>{const d=new Date(future.effective_from+'T00:00:00');d.setDate(d.getDate()-1);return d.toISOString().slice(0,10)})():null;target.updated_at=new Date().toISOString();demoWrite(s);return target;
  }
  const {data,error}=await supabase.rpc('publish_manager_print_template',{p_template_id:id,p_effective_from:effectiveFrom});
  if(error) throw error; return data;
}

