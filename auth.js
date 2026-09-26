import { DB_MODE, supabase, getCurrentAccess } from './database.js';

export async function signIn(account,password,expectedRole=null) {
  account=String(account||'').trim();
  if(!account||!password) throw new Error('Enter account and password.');

  if(DB_MODE==='demo'){
    const { ensureDemoState } = await import('./database.js');
    const demoState = ensureDemoState(false);
    const demoAccount = demoState.accounts.find(a=>a.login_id.toLowerCase()===account.toLowerCase());
    const expectedPassword = demoAccount?.demo_password || 'demo';
    if(!demoAccount || password!==expectedPassword) throw new Error('Invalid account or password.');
    sessionStorage.setItem('nightMemoDemoSession',JSON.stringify({login_id:account}));
    const access=await getCurrentAccess();
    if(!access || !access.active) throw new Error('Account is not active.');
    if(expectedRole && access.role!==expectedRole) {
      sessionStorage.removeItem('nightMemoDemoSession');
      throw new Error('This account does not have access to that login option.');
    }
    return access;
  }

  // The account entered by the user is the exact Supabase Auth email/identifier.
  // No ward-code or domain mapping is performed by the application.
  const {data,error}=await supabase.auth.signInWithPassword({email:account,password});
  if(error) throw error;

  const access=await getCurrentAccess(data.user.id);
  if(!access || !access.active){
    await supabase.auth.signOut();
    throw new Error('This account is disabled or has no Night Memo access.');
  }
  if(expectedRole && access.role!==expectedRole){
    await supabase.auth.signOut();
    throw new Error('This account does not have access to that login option.');
  }
  return access;
}

export async function signOut(){
  if(DB_MODE==='demo') sessionStorage.removeItem('nightMemoDemoSession');
  else await supabase.auth.signOut();
  location.href='./login.html';
}

export async function requireRole(roles) {
  roles=Array.isArray(roles)?roles:[roles];
  if(DB_MODE==='supabase'){
    const {data}=await supabase.auth.getSession();
    if(!data.session){location.href='./login.html';return null;}
  }
  const access=await getCurrentAccess();
  if(!access || !access.active || !roles.includes(access.role)){location.href='./login.html';return null;}
  return access;
}
