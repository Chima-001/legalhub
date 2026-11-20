// Exercises the real patched scripts using synthetic link markers, DOM, SDK and storage. No network.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const repo=process.argv[2]; if(!repo||!path.isAbsolute(repo))throw Error('Pass the absolute checkout path.');
const source=f=>fs.readFileSync(path.join(repo,'public',f),'utf8'),app=source('scripts/auth/signup-confirmation.js'),page=source('pages/confirmed.html'),index=source('index.html'),guard=source('scripts/auth/auth-guard.js');
const origin='https://staging.example.test', landing=origin+'/pages/confirmed.html';
const signed='#type=signup&access_token=fixture-access&refresh_token=fixture-refresh';
const good={user:{id:'fixture-member'},access_token:'fixture-access'};
const cases=[];const test=(s,f)=>cases.push([s,f]);
function location(base){const u=new URL(base);return {href:u.href,origin:u.origin,pathname:u.pathname,search:u.search,hash:u.hash,replaced:[],replace(s){this.replaced.push(s)}};}
function open(suffix=signed,opts={}){
 const mountedLanding=origin+(opts.mount||'/')+'pages/confirmed.html';
 const loc=location(mountedLanding+suffix),node={textContent:''},store=new Map(),calls=[]; if(opts.target)store.set('legalhub_auth_redirect',opts.target);if(opts.priorTime)store.set('legalhub_login_time',opts.priorTime);
 let ready,timer,read=0;
 const api={auth:{async getSession(){calls.push('session');return {data:{session:++read===1?(opts.initial===undefined?good:opts.initial):(opts.current===undefined?good:opts.current)},error:null};},async getUser(){calls.push('verify');if(opts.pause)return opts.pause;if(opts.throw)throw Error('offline');return opts.verified||{data:{user:{id:'fixture-member',email_confirmed_at:'2026-01-01Z'}},error:null};}},from(table){assert.equal(table,'users');return{select(cols){assert.equal(cols,'id');return {eq(col,id){assert.equal(col,'id');assert.equal(id,'fixture-member');return{async maybeSingle(){calls.push('own-profile');return opts.profile||{data:{id},error:null};}};}};}};}};
 const ctx={URL,URLSearchParams,window:{location:loc},history:{replaceState(_s,_t,relative){assert.equal(relative,new URL(mountedLanding).pathname);loc.href=mountedLanding;loc.hash='';loc.search='';}},document:{getElementById(id){assert.equal(id,'status-text');return node;},addEventListener(type,cb){assert.equal(type,'DOMContentLoaded');ready=cb;}},setTimeout(fn){timer=fn;return 1;},clearTimeout(){timer=null;},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},supabaseClient:opts.missingClient?null:api};
 vm.runInNewContext(app,ctx);
 if(page.includes('src="../scripts/auth/account-routes.js"') && !opts.missingRoutes)vm.runInNewContext(source('scripts/auth/account-routes.js'),ctx);
 return {boot:()=>ready?.(),timeout:()=>timer?.(),loc,node,store,calls};
}
function noSuccess(t){assert(!t.loc.replaced.length);assert(!t.store.has('legalhub_login_time'));assert.equal(t.loc.hash,'');assert.equal(t.loc.search,'');}

test('Callback receipt is captured before SDK initialization; login fallback and referrer protection are present',()=>{
 const a=page.indexOf('src="../scripts/auth/signup-confirmation.js"'),b=page.indexOf('src="../scripts/auth/supabase-client.js"');assert(a>=0&&b>a);assert(page.includes('href="login.html"'));assert(page.includes('name="referrer" content="no-referrer"'));assert(!page.includes('auth-guard.js'));
});
test('Confirmed email plus its matching profile opens the saved internal page once',async()=>{const t=open(signed,{target:'/pages/materials.html'});await t.boot();assert.deepEqual(t.calls,['session','verify','own-profile','session']);assert.deepEqual(t.loc.replaced,[origin+'/pages/materials.html']);assert(+t.store.get('legalhub_login_time')>0);assert(!t.store.has('legalhub_auth_redirect'));assert(!t.loc.hash);});
test('Another device with no saved destination opens the same-site homepage',async()=>{const t=open();await t.boot();assert.deepEqual(t.loc.replaced,[origin+'/index.html']);});
test('An unrelated stored session on a bare, expired, recovery or incomplete return cannot claim success',async()=>{for(const suffix of ['', '#error=access_denied&error_code=otp_expired',signed.replace('type=signup','type=recovery'),'#type=signup','?error=access_denied'+signed,'?code=unhandled-fixture-code']){const t=open(suffix,{priorTime:'42'});await t.boot();assert.equal(t.store.get('legalhub_login_time'),'42');assert(!t.loc.replaced.length);assert.deepEqual(t.calls,[]);assert.equal(t.loc.hash+t.loc.search,'');}});
test('A current session must match the actual signup callback, not merely have an ID',async()=>{for(const initial of [null,{user:{id:'prior'},access_token:'different-fixture'}]){const t=open(signed,{initial});await t.boot();noSuccess(t);assert.deepEqual(t.calls,['session']);}});
test('The provider must verify the same identity with a confirmed email',async()=>{for(const verified of [{data:{user:{id:'other',email_confirmed_at:'yes'}}},{data:{user:{id:'fixture-member',email_confirmed_at:null}}},{data:{user:null},error:{status:401}}]){const t=open(signed,{verified});await t.boot();noSuccess(t);assert(!t.calls.includes('own-profile'));}});
test('A missing, inaccessible or different profile cannot show success',async()=>{for(const profile of [{data:null,error:null},{data:{id:'other'},error:null},{data:null,error:{code:'unavailable'}}]){const t=open(signed,{profile});await t.boot();noSuccess(t);assert(t.calls.includes('own-profile'));}});
test('Switching session during the check does not refresh the login clock',async()=>{const t=open(signed,{current:null});await t.boot();noSuccess(t);});
test('SDK outage, network error and timeout give a sign-in fallback; a late response cannot redirect',async()=>{for(const opts of [{missingClient:true},{throw:true}]){const t=open(signed,opts);await t.boot();noSuccess(t);}let resolve;const pause=new Promise(r=>{resolve=r});const t=open(signed,{pause});const work=t.boot();await new Promise(r=>setImmediate(r));t.timeout();resolve({data:{user:{id:'fixture-member',email_confirmed_at:'yes'}},error:null});await work;noSuccess(t);});
test('Saved external destinations, auth callbacks and auth-return parameters fall back to the homepage',async()=>{for(const target of ['https://outside.example.test/', '/pages/confirmed.html', '/index.html?code=fixture']){const t=open(signed,{target});await t.boot();assert.deepEqual(t.loc.replaced,[origin+'/index.html']);}});
const bridge=[...index.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).find(x=>x.includes('signupHandoff'));
function rootHandoff(suffix,home='/'){const loc=location(origin+home+suffix);const dataset={};vm.runInNewContext(bridge,{window:{location:loc},URL,URLSearchParams,document:{documentElement:{dataset}},history:{replaceState(){loc.hash='';loc.search='';loc.href=origin+home}}});return {loc,dataset};}
test('Already-issued typed signup links at the root hand off before SDK/guard; no custom return address is forwarded',()=>{assert(bridge);assert(index.indexOf('signupHandoff')<index.indexOf('scripts/auth/supabase-client.js'));const {loc,dataset}=rootHandoff('?other=not-forwarded'+signed);assert.deepEqual(loc.replaced,[landing+signed]);assert(!loc.hash&&!loc.search);assert.equal(dataset.signupHandoff,'1');assert.deepEqual(rootHandoff('?error=access_denied'+signed).loc.replaced,[landing]);assert.deepEqual(rootHandoff('#ordinary-section').loc.replaced,[]);});
test('Verified confirmation returns only inside the mounted app, with or without old saved state',async()=>{
  const mount='/public/',path=mount+'pages/pdf.html?level=200#cases';
  for(const [target,want] of [[null,mount+'index.html'],['/index.html',mount+'index.html'],[path,path]]){
    const t=open(signed,{mount,target});await t.boot();assert.deepEqual(t.loc.replaced,[origin+want]);
  }
  const without=open(signed,{mount,target:path,missingRoutes:true});await without.boot();
  assert.deepEqual(without.loc.replaced,[origin+mount+'index.html']);
});
test('Legacy signup handoff uses the mounted index directory, both as a file and a directory URL',()=>{
  for(const home of ['/public/index.html','/public/','/classroom/public/index.html']){
    const expected=new URL('pages/confirmed.html',origin+home).href;
    assert.deepEqual(rootHandoff(signed,home).loc.replaced,[expected+signed]);
    assert.deepEqual(rootHandoff('?error=denied'+signed,home).loc.replaced,[expected]);
    assert.deepEqual(rootHandoff('#levels',home).loc.replaced,[]);
  }
});
function guardRun(suffix,handoff){const loc=location(origin+'/'+suffix),store=new Map(),calls=[];const ctx={URL,URLSearchParams,window:{location:loc},document:{head:{appendChild(){}},createElement(){return {}},documentElement:{style:{},dataset:handoff?{signupHandoff:'1'}:{}}},localStorage:{getItem:k=>store.get(k),removeItem:k=>store.delete(k),setItem:(k,v)=>store.set(k,v)},supabaseClient:{auth:{async getSession(){calls.push('read');return {data:{session:null}}},signOut(){calls.push('logout')}}},setTimeout(){return 1}};return {loc,store,calls,work:vm.runInNewContext(guard,ctx)};}
test('The guarded home stays hidden and does not sign out or save transient data during a legacy handoff',async()=>{const t=guardRun('',true);await t.work;assert.deepEqual(t.calls,[]);assert.equal(t.store.size,0);assert.equal(t.loc.replaced.length,0);});
test('Ordinary deep links survive the guard, but auth-return data is not copied into storage or a redirect',async()=>{const ordinary=guardRun('pages/pdf.html?level=100#books',false);await ordinary.work;assert.equal(ordinary.store.get('legalhub_auth_redirect'),'/pages/pdf.html?level=100#books');const t=guardRun('?code=fake',false);await t.work;assert.equal(t.store.get('legalhub_auth_redirect'),'/');assert(t.loc.replaced.every(x=>!x.includes('fake')));});
(async()=>{for(const [name,fn] of cases){await fn();console.log('PASS:',name);}console.log('Signup callback rehearsal: '+cases.length+' checks passed. Test doubles; no Auth server or email used.');})().catch(e=>{console.error(e);process.exitCode=1;});
