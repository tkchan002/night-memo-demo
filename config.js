export const CONFIG = {
  // Replace these two values after creating your Supabase project.
  SUPABASE_URL: 'https://csibbrzbljemusyzpzmo.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_t-q22YijhE1djDdtcPf-lQ_VgX1PISh',

  // The browser automatically uses a local demo database while the values above
  // are placeholders. Set FORCE_DEMO_MODE to true to keep using the local demo.
  FORCE_DEMO_MODE: false,

  APP_NAME: 'Night Memo',
  RECENT_HISTORY_LIMIT: 30,
};

export function isSupabaseConfigured() {
  return !CONFIG.FORCE_DEMO_MODE &&
    CONFIG.SUPABASE_URL.startsWith('https://') &&
    !CONFIG.SUPABASE_URL.includes('YOUR-PROJECT') &&
    CONFIG.SUPABASE_PUBLISHABLE_KEY &&
    !CONFIG.SUPABASE_PUBLISHABLE_KEY.includes('YOUR_SUPABASE');
}
