// Offline test of the actual page handlers. The SDK, DOM, storage and timers are test doubles.
// No browser navigation, HTTP, real Auth state or environment credentials are used.
const {readFileSync}=require('node:fs'); const path=require('node:path'); const vm=require('node:vm');const assert=require('node:assert/strict');
const root=process.argv[2];if(!root || !path.isAbsolute(root))throw new Error('Pass the absolute path to the patched LegalHub checkout.');
function source(rel){return readFileSync(path.join(root,rel),'utf8');}
function page(name){return source('public/pages/'+name+'.html');}
function appScript(name){const scripts=[...page(name).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);const main=scripts.find(s=>s.includes('form.addEventListener("submit"'));assert(main,name);return main;}
const passed=[];
const tests=[];function test(name,fn){tests.push([name,fn]);}
function setup(name,auth,overrides={},route={}) {
  const ids=[...page(name).matchAll(/\bid=(["'])([\w-]+)\1/g)].map(m=>m[2]);const nodes={};let submit;const timers=new Map();let timerId=0;
  for(const id of ids){const startHidden=['error-msg','success-msg','invalid-link','update-form'].includes(id);const flags=new Set(startHidden?['hidden']:[]);nodes[id]={id,value:'',textContent:'',disabled:false,flags,resets:0,classList:{add(k){flags.add(k)},remove(k){flags.delete(k)}},addEventListener(type,cb){if(type==='submit')submit=cb;},reset(){this.resets++;}};}
  for(const [id,value] of Object.entries(overrides))nodes[id].value=value;
  const store=new Map();if(route.saved)store.set('legalhub_auth_redirect',route.saved);let next='';
  const current=new URL(route.page || `/pages/${name}.html`,'https://fixture.example.test');
  if(route.requested)current.searchParams.set('redirect',route.requested);
  const loc={origin:current.origin,href:current.href,pathname:current.pathname,search:current.search,replace(v){next=v;}};
  const registrar={getElementById:id=>nodes[id]};
  const ctx={document:registrar,window:{location:loc},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},URL,URLSearchParams,supabaseClient:{auth},setTimeout(fn,ms){timers.set(++timerId,{fn,ms});return timerId;},clearTimeout(id){timers.delete(id);}};
  const script=appScript(name),markup=page(name),routes=markup.indexOf('src="../scripts/auth/account-routes.js"');
  if(routes>=0 && !route.missingAsset){assert(routes<markup.indexOf(script));vm.runInNewContext(source('public/scripts/auth/account-routes.js'),ctx);}
  vm.runInNewContext(script,ctx);
  return {nodes,store,loc,sourceUrl:current.href,visible:k=>!nodes[k].flags.has('hidden'),submit:()=>submit({preventDefault(){}}),runTimer(ms){for(const [key,t] of [...timers])if(t.ms===ms){timers.delete(key);t.fn();}},next:()=>next};
}
const fields={email:'  member@example.test  ',password:'  synthetic pass  ',confirm_password:'  synthetic pass  ',username:'',reg_number:''};
const plain=x=>JSON.parse(JSON.stringify(x));

test('Login uses the trimmed email, not the number; preserves password, timestamp and target',async()=>{let called;const t=setup('login',{async signInWithPassword(payload){called=plain(payload);return {error:null};}},{email:fields.email,password:fields.password},{saved:'/pages/materials.html'});await t.submit();assert.deepEqual(called,{email:'member@example.test',password:fields.password});assert(+t.store.get('legalhub_login_time')>0);assert(!t.store.has('legalhub_auth_redirect'));assert.equal(t.loc.href,'/pages/materials.html');});
test('Unconfirmed email is not treated as a successful login',async()=>{const t=setup('login',{async signInWithPassword(){return{error:{code:'email_not_confirmed'}};}});await t.submit();assert.match(t.nodes['error-msg'].textContent,/confirm/i);assert(!t.store.has('legalhub_login_time'));});
// Cover the actual UI handlers with the app at the origin root and under Live Server folders.
const mounts=['/','/public/','/classroom/legalhub/public/'];
const signIn=()=>({signInWithPassword:async()=>({error:null})});
const credentials={email:fields.email,password:fields.password};
test('Direct login opens the homepage under the current mount, not the server root',async()=>{
  for(const base of mounts)for(const leaf of ['login.html','login','login/']){
    const t=setup('login',signIn(),credentials,{page:base+'pages/'+leaf});await t.submit();
    assert.equal(new URL(t.loc.href,t.sourceUrl).pathname,base+'index.html');
  }
});
test('Old root-level home, unrelated paths and account callbacks fall back to the mounted homepage',async()=>{
  for(const saved of ['/index.html','/some-other-site/index.html','/public/pages/login.html','/public/index.html?code=fixture','https://outside.example.test/']){
    const t=setup('login',signIn(),credentials,{page:'/public/pages/login.html',saved});await t.submit();
    assert.equal(t.loc.href,'/public/index.html');assert(!t.store.has('legalhub_auth_redirect'));
  }
});
test('A requested in-app destination wins over an older saved one; filters and anchors survive',async()=>{
  for(const base of mounts){
    const requested=base+'pages/pdf.html?level=200&semester=First#library';
    const t=setup('login',signIn(),credentials,{page:base+'pages/login.html',requested,saved:base+'pages/profile.html'});
    await t.submit();assert.equal(t.loc.href,requested);
  }
});
test('Signup hands the same mounted destination to login and requests the mounted confirmation page',async()=>{
  for(const base of mounts)for(const requested of [null,base+'pages/profile.html#account']){
    let callback;const t=setup('signup',{signUp:async req=>{callback=req.options.emailRedirectTo;return {error:null}}},fields,
      {page:base+'pages/signup.html',requested,saved:base==='/'?null:'/index.html'});
    const expected=requested || base+'index.html';assert.equal(t.store.get('legalhub_auth_redirect'),expected);
    const link=new URL(t.nodes['login-link'].href,t.sourceUrl);assert.equal(link.pathname,base+'pages/login.html');
    assert.equal(link.searchParams.get('redirect'),expected);await t.submit();
    assert.equal(callback,t.loc.origin+base+'pages/confirmed.html');
  }
});
test('The reset request still targets the isolated update-password page inside each mount',async()=>{
  for(const base of mounts){let callback;const t=setup('forgot-password',{resetPasswordForEmail:async (_email,opts)=>{
    callback=opts.redirectTo;return {error:null};}},{email:fields.email},{page:base+'pages/forgot-password.html'});
    await t.submit();assert.equal(callback,t.loc.origin+base+'pages/update-password.html');
  }
});
test('A missing optional routing asset still signs in to the mounted home without forwarding a target',async()=>{
  const t=setup('login',signIn(),credentials,{page:'/public/pages/login.html',saved:'/pages/old.html',missingAsset:true});
  await t.submit();assert.equal(t.loc.href,'/public/index.html');
});
test('Signup accepts a fresh email with every optional field blank',async()=>{let request;const t=setup('signup',{async signUp(x){request=plain(x);return{error:null};}},fields);await t.submit();assert.deepEqual(request,{email:'member@example.test',password:fields.password,options:{data:{},emailRedirectTo:'https://fixture.example.test/pages/confirmed.html'}});assert(t.visible('success-msg'));assert(!/\brequired\b/.test(page('signup').match(/<input id="reg_number"[^>]+>/)[0]));});
test('Optional number is submitted only as self-reported metadata',async()=>{let req;const t=setup('signup',{async signUp(x){req=plain(x);return{error:null};}},{...fields,username:'  Reader  ',reg_number:'  TEST-OLD  '});await t.submit();assert.deepEqual(req.options.data,{username:'Reader',reported_reg_number:'TEST-OLD'});});
test('Signup with mismatched passwords never contacts Auth',async()=>{let calls=0;const t=setup('signup',{async signUp(){calls++;return {};}},{...fields,confirm_password:'different'});await t.submit();assert.equal(calls,0);assert(t.visible('error-msg'));});
test('Existing email gets neutral signup acknowledgement, not a new login',async()=>{const t=setup('signup',{async signUp(){return{error:{code:'user_already_exists'}};}},fields);await t.submit();assert(t.visible('success-msg'));assert(!t.visible('error-msg'));assert(!t.store.has('legalhub_login_time'));});
test('Network failure releases the signup form for retry',async()=>{const t=setup('signup',{async signUp(){throw Error('offline');}},fields);await t.submit();assert(t.visible('error-msg'));assert(!t.nodes['submit-btn'].disabled);});
test('Recovery request uses the typed email and existing same-site callback',async()=>{let call;const t=setup('forgot-password',{async resetPasswordForEmail(email,options){call=[email,options.redirectTo];return{error:null};}},{email:fields.email});await t.submit();assert.deepEqual(call,['member@example.test','https://fixture.example.test/pages/update-password.html']);assert(t.visible('success-msg'));});
test('Known and unknown addresses receive the same recovery acknowledgement',async()=>{const s=[];for(const error of [null,{code:'user_not_found'}]){const t=setup('forgot-password',{async resetPasswordForEmail(){return{error};}},{email:fields.email});await t.submit();assert(t.visible('success-msg'));s.push(t.nodes['success-msg'].textContent);}assert.equal(s[0],s[1]);});
test('No duplicate reset request while first one is pending',async()=>{let resolve,n=0;const t=setup('forgot-password',{resetPasswordForEmail(){n++;return new Promise(r=>{resolve=r;});}},{email:fields.email});const first=t.submit();await t.submit();assert.equal(n,1);resolve({error:null});await first;});
test('A rate limit or lost connection re-enables the recovery request form',async()=>{for(const kind of ['rate','offline']){const t=setup('forgot-password',{async resetPasswordForEmail(){if(kind==='offline')throw Error('offline');return{error:{status:429}};}},{email:fields.email});await t.submit();assert(t.visible('error-msg'));assert(!t.visible('success-msg'));assert(!t.nodes['submit-btn'].disabled);}});
test('Normal pages retain SDK defaults; reset destination opts into isolated, non-persisted Auth',()=>{const code=source('public/scripts/auth/supabase-client.js');const opts=[];for(const isolated of [false,true])vm.runInNewContext(code,{document:{currentScript:{hasAttribute:k=>isolated&&k==='data-recovery-only'}},window:{supabase:{createClient(a,b,o){opts.push(o);return{};}}}});assert.equal(opts[0],undefined);assert.deepEqual(plain(opts[1].auth),{storageKey:'legalhub-recovery-only',persistSession:false,autoRefreshToken:false});assert(/<script src="\.\.\/scripts\/auth\/supabase-client\.js" data-recovery-only>/.test(page('update-password')));});
function update(opts={}){let notify;const calls=[];const s=setup('update-password',{onAuthStateChange(f){notify=f;},async getUser(){calls.push('verify');return opts.userResult||{data:{user:{id:'test-person'}},error:null};},async updateUser(x){calls.push(['update',plain(x)]);return opts.updateResult||{error:null};},async signOut(x){calls.push(['signOut',plain(x)]);return{error:null};}},{password:fields.password,confirm_password:fields.confirm_password});return{...s,calls,event:(ev,who='test-person')=>notify(ev,who?{user:{id:who}}:null)};}
test('A normal or restored sign-in session does not open the reset form',async()=>{const t=update();t.event('INITIAL_SESSION');t.event('SIGNED_IN');await t.submit();t.runTimer(12000);assert(!t.visible('update-form'));assert(t.visible('invalid-link'));assert.deepEqual(t.calls,[]);});
test('An unavailable/expired recovery callback never attempts an update',async()=>{const t=update();t.runTimer(12000);await t.submit();assert(t.visible('invalid-link'));assert.deepEqual(t.calls,[]);});
test('A valid recovery event still works after a slow initial callback',async()=>{const t=update();t.runTimer(12000);t.event('PASSWORD_RECOVERY');assert(t.visible('update-form'));assert(!t.visible('invalid-link'));});
test('Password mismatch does not consume the recovery session',async()=>{const t=update();t.event('PASSWORD_RECOVERY');t.nodes.confirm_password.value='different';await t.submit();assert(t.visible('error-msg'));assert.deepEqual(t.calls,[]);assert(t.visible('update-form'));});
test('Sign-out or a changed identity closes the reset form',async()=>{for(const kind of ['SIGNED_OUT','SIGNED_IN']){const t=update();t.event('PASSWORD_RECOVERY');t.event(kind,kind==='SIGNED_IN'?'other-test-person':null);await t.submit();assert(!t.visible('update-form'));assert.deepEqual(t.calls,[]);}});
test('Provider verification must still match the recovery identity before update',async()=>{const t=update({userResult:{data:{user:{id:'other-test-person'}},error:null}});t.event('PASSWORD_RECOVERY');await t.submit();assert.deepEqual(t.calls,['verify']);assert(t.visible('invalid-link'));});
test('Successful recovery updates once, closes only the isolated session, and returns to login',async()=>{const t=update();t.event('PASSWORD_RECOVERY');await t.submit();await t.submit();assert.deepEqual(t.calls,['verify',['update',{password:fields.password}],['signOut',{scope:'local'}]]);assert(!t.visible('update-form'));assert(t.visible('verifying'));assert.match(t.nodes.verifying.textContent,/Password updated/);t.runTimer(1800);assert.equal(t.next(),'login.html');});
test('Retryable provider failure leaves recovery available without password change',async()=>{const t=update({userResult:{data:{},error:{status:503}}});t.event('PASSWORD_RECOVERY');await t.submit();assert.deepEqual(t.calls,['verify']);assert(t.visible('update-form'));assert(t.visible('error-msg'));assert(!t.nodes['submit-btn'].disabled);});
test('Profile distinguishes official, self-reported, pending legacy and missing numbers',()=>{const s=page('profile');const a=s.indexOf('      document.getElementById("display-name").textContent = data.full_name');const b=s.indexOf('      document.getElementById("username-input").value',a);assert(a>=0&&b>a);const fragment=s.slice(a,b);for(const [official,metadata,expected] of [['TEST-OFFICIAL',{reported_reg_number:'TEST-OTHER'},'TEST-OFFICIAL'],[null,{reported_reg_number:'  TEST-R  '},'TEST-R (self-reported)'],[null,{reg_number:'OLD-PENDING'},'OLD-PENDING (self-reported)'],[null,{},'Not provided']]){const nodes={'display-reg':{},'display-name':{}};vm.runInNewContext(fragment,{data:{reg_number:official},session:{user:{user_metadata:metadata}},document:{getElementById:id=>nodes[id]}});assert.equal(nodes['display-reg'].textContent,expected);assert.equal(nodes['display-name'].textContent,'LegalHub member');}});
(async()=>{for(const [name,fn] of tests){await fn();passed.push(name);console.log('PASS:',name);}console.log('Web rehearsal: '+passed.length+' scenarios passed. Mock SDK; no network.');})().catch(e=>{console.error(e);process.exitCode=1;});
