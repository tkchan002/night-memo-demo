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
  qsa('.login-option').forEach(b=>{b.disabled=false;b.classList.remove('active');});
  qs('#loginIntro')?.classList.remove('hidden');
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
  qs('#loginId').placeholder='';
  qs('#loginId').value=DB_MODE==='demo'?defaults[r]:'';
  qs('#password').value=DB_MODE==='demo'?'demo':'';
  qs('#demoHint').classList.toggle('hidden',DB_MODE!=='demo');
  if(DB_MODE==='demo'){
    qs('#demoHint').textContent='Demo mode is enabled. Password: demo.';
  }
  qs('#loginBox').classList.add('show');
  qs('#loginIntro')?.classList.add('hidden');
  qsa('.login-option').forEach(b=>{b.disabled=false;b.classList.toggle('active',b.dataset.role===r);});
  setTimeout(()=>qs('#loginId').focus(),30);
}
