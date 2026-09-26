import { DB_MODE, supabase } from './database.js';

const DEMO_KEY = 'nightMemoManagerTemplatesV1';

const DEFAULT_TEMPLATE = {
  id: 'demo-default',
  version: 1,
  name: 'Night Memo',
  html_template: '<div class="memo-template"><h1 style="text-align:center;text-decoration:underline;margin:0 0 4px">Night Memo ({{section}})</h1><div style="text-align:center;margin-bottom:10px">{{report_date_display}}</div>{{ward_summary_table}}<h2 style="margin:16px 0 6px">Infection / Device Details</h2>{{infection_table}}</div>',
  css_template: '',
  status: 'published',
  effective_from: '2000-01-01',
  effective_to: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function demoRead() {
  const raw = localStorage.getItem(DEMO_KEY);
  if (!raw) {
    localStorage.setItem(DEMO_KEY, JSON.stringify([DEFAULT_TEMPLATE]));
    return [structuredClone(DEFAULT_TEMPLATE)];
  }
  try {
    const rows = JSON.parse(raw);
    return Array.isArray(rows) ? rows : [structuredClone(DEFAULT_TEMPLATE)];
  } catch {
    return [structuredClone(DEFAULT_TEMPLATE)];
  }
}

function demoWrite(rows) {
  localStorage.setItem(DEMO_KEY, JSON.stringify(rows));
}

function inRange(date, start, end) {
  return (!start || date >= start) && (!end || date <= end);
}

export async function getManagerPrintTemplates() {
  if (DB_MODE === 'demo') {
    return demoRead().slice().sort((a,b)=>(Number(b.version)||0)-(Number(a.version)||0));
  }
  const { data, error } = await supabase
    .from('manager_print_templates')
    .select('*')
    .order('version', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getActiveManagerPrintTemplate(date) {
  if (DB_MODE === 'demo') {
    return demoRead()
      .filter(t => t.status === 'published' && inRange(date, t.effective_from, t.effective_to))
      .sort((a,b)=>(b.effective_from || '').localeCompare(a.effective_from || ''))[0] || null;
  }
  const { data, error } = await supabase
    .from('manager_print_templates')
    .select('*')
    .eq('status', 'published')
    .lte('effective_from', date)
    .or(`effective_to.is.null,effective_to.gte.${date}`)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function saveManagerPrintTemplate(row) {
  const now = new Date().toISOString();
  const clean = {
    name: row.name || 'Night Memo',
    html_template: row.html_template || DEFAULT_TEMPLATE.html_template,
    css_template: row.css_template || '',
    status: 'draft',
    effective_from: row.effective_from || null,
    effective_to: row.effective_to || null,
    updated_at: now,
  };

  if (DB_MODE === 'demo') {
    const rows = demoRead();
    const maxVersion = Math.max(0, ...rows.map(x => Number(x.version) || 0));
    if (row.id) {
      const idx = rows.findIndex(x => x.id === row.id);
      if (idx < 0) throw new Error('Template not found.');
      if (rows[idx].status === 'published') {
        const draft = { ...clean, id: crypto.randomUUID(), version: maxVersion + 1, created_at: now };
        rows.push(draft);
        demoWrite(rows);
        return draft;
      }
      rows[idx] = { ...rows[idx], ...clean };
      demoWrite(rows);
      return rows[idx];
    }
    const draft = { ...clean, id: crypto.randomUUID(), version: maxVersion + 1, created_at: now };
    rows.push(draft);
    demoWrite(rows);
    return draft;
  }

  if (row.id) {
    const { data: existing, error: readError } = await supabase
      .from('manager_print_templates')
      .select('status')
      .eq('id', row.id)
      .single();
    if (readError) throw readError;

    if (existing.status === 'published') {
      const { data, error } = await supabase
        .from('manager_print_templates')
        .insert(clean)
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    const { data, error } = await supabase
      .from('manager_print_templates')
      .update(clean)
      .eq('id', row.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('manager_print_templates')
    .insert(clean)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function publishManagerPrintTemplate(id, effectiveFrom) {
  if (DB_MODE === 'demo') {
    const rows = demoRead();
    const target = rows.find(x => x.id === id);
    if (!target) throw new Error('Template not found.');

    const prior = rows
      .filter(x => x.id !== id && x.status === 'published' && x.effective_from < effectiveFrom && (!x.effective_to || x.effective_to >= effectiveFrom))
      .sort((a,b)=>(b.effective_from || '').localeCompare(a.effective_from || ''))[0];
    if (prior) {
      const d = new Date(`${effectiveFrom}T00:00:00`);
      d.setDate(d.getDate() - 1);
      prior.effective_to = d.toISOString().slice(0,10);
    }

    rows.filter(x => x.id !== id && x.status === 'published' && x.effective_from === effectiveFrom)
      .forEach(x => { x.status = 'retired'; });

    const future = rows
      .filter(x => x.id !== id && x.status === 'published' && x.effective_from > effectiveFrom)
      .sort((a,b)=>(a.effective_from || '').localeCompare(b.effective_from || ''))[0];

    target.status = 'published';
    target.effective_from = effectiveFrom;
    if (future) {
      const d = new Date(`${future.effective_from}T00:00:00`);
      d.setDate(d.getDate() - 1);
      target.effective_to = d.toISOString().slice(0,10);
    } else {
      target.effective_to = null;
    }
    target.updated_at = new Date().toISOString();
    demoWrite(rows);
    return target;
  }

  const { data, error } = await supabase.rpc('publish_manager_print_template', {
    p_template_id: id,
    p_effective_from: effectiveFrom,
  });
  if (error) throw error;
  return data;
}
