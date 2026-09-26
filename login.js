import { DB_MODE } from './database.js';
import { signIn } from './auth.js';
import { qs, qsa, modeBadge, flash } from './app.js';

const titles={ward:'Ward Login',manager:'Patrol Night Login',maintenance:'Night Memo Maintenance'};
const defaults={
  ward:'c10@nightmemo.local',
  manager:'patrolnight@nightmemo.local',
  maintenance:'nightmaintenance@nightmemo.local'
};
let role=null;

qs('#modeBadge').innerHTML=modeBadge();
qsa('.login-option').forEach(b=>b.onclick=()=>selectRole(b.dataset.role));
qs('#backBtn').onclick=()=>{
  role=null;
  qs('#loginBox').classList.remove('show');
  qsa('.login-option').forEach(b=>b.disabled=false);
};
qs('#loginForm').onsubmit=async e=>{
  e.preventDefault();
  if(!role)return;
  const btn=qs('#loginBtn');
  btn.disabled=true;
  try{
    await signIn(qs('#loginId').value,qs('#password').value,role);
    location.href=role==='ward'?'./ward.html':role==='manager'?'./manager.html':'./maintenance.html';
  }catch(err){
    flash(err.message||String(err),'error',6000);
  }finally{
    btn.disabled=false;
  }
};

function selectRole(r){
  role=r;
  qs('#loginTitle').textContent=titles[r];
  qs('#loginIdLabel').textContent='Account';
  qs('#loginId').type='email';
  qs('#loginId').placeholder=r==='ward'?'e.g. c10@nightmemo.local':'Account email';
  qs('#loginId').value=DB_MODE==='demo'?defaults[r]:'';
  qs('#password').value=DB_MODE==='demo'?'demo':'';
  qs('#demoHint').classList.toggle('hidden',DB_MODE!=='demo');
  if(DB_MODE==='demo'){
    qs('#demoHint').textContent='Demo mode: password “demo”. Ward accounts use the full account, e.g. c10@nightmemo.local or h6@nightmemo.local.';
  }
  qs('#loginBox').classList.add('show');
  qsa('.login-option').forEach(b=>b.disabled=b.dataset.role!==r);
  setTimeout(()=>qs('#loginId').focus(),30);
}
