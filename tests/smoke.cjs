// Smoke test for the board page: runs it in jsdom against in-memory fakes of the artifact db and user capabilities.
// Run: npm install --no-save jsdom@24.1.1 && node tests/smoke.cjs
const {JSDOM}=require('jsdom');const fs=require('fs');const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','skills','artiboard','assets','board.html'),'utf8');
const T0='2026-01-05T09:00:00.000Z';
const seed=()=>({
  'meta/config':{title:'Test Board',lang:'en',milestone:'M1',people:[{id:'ana'},{id:'ben',name:'Ben'},{id:'cy'}]},
  'meta/protocol':{text:'Intro line\n0. Collections\n- tasks\n1. Reading\n- query'},
  'notices/n-1':{at:T0,author:'ana',kind:'agent',type:'note',text:'Board is up'},
  'tasks/M1-1':{key:'M1-1',title:'Schema',feature:'Data',status:'todo',owner:null,deps:[],waitingOn:[],claimedBy:null,updatedAt:T0},
  'tasks/M1-2':{key:'M1-2',title:'API',feature:'Data',status:'todo',owner:null,deps:['M1-1'],waitingOn:['M1-1'],claimedBy:null,updatedAt:T0},
  'tasks/M1-3':{key:'M1-3',title:'Screen',feature:'UI',status:'todo',owner:null,deps:['M1-2'],claimedBy:null,updatedAt:T0},
  'tasks/M1-4':{key:'M1-4',title:'Docs',feature:'UI',status:'done',owner:'cy',deps:[],waitingOn:[],claimedBy:null,updatedAt:T0},
  'details/M1-1':{spec:'docs/db.md',acceptance:'Migrations run',summary:''}
});
// user: the namespace claude.use('user') resolves (null = no identity, today's picker); deny: every write rejects like a view-only viewer's
function boot({user=null,docs={},me=null,deny=false}={}){
  const store={...seed(),...docs},subs=[],writes=[],errors=[];
  const notify=()=>subs.slice().forEach(s=>s());
  const put=(p,f)=>{if(deny)return Promise.reject({code:'invalid_argument'});writes.push(p);store[p]=f(store[p]);setTimeout(notify,0);return Promise.resolve()};
  function snapColl(p,o){let docs=Object.keys(store).filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')).map(k=>({id:k.slice(p.length+1),data:()=>store[k]}));
    if(o.order)docs.sort((a,b)=>(a.data()[o.order]>b.data()[o.order]?1:-1)*(o.dir==='desc'?-1:1));return {docs:o.limit?docs.slice(0,o.limit):docs}}
  function coll(p,o={}){return {orderBy:(f,d)=>coll(p,{...o,order:f,dir:d}),limit:n=>coll(p,{...o,limit:n}),onSnapshot(cb){const run=()=>cb(snapColl(p,o));subs.push(run);run();return()=>subs.splice(subs.indexOf(run),1)}}}
  function doc(p){return {get:async()=>({exists:!!store[p],data:()=>store[p]}),onSnapshot(cb){const run=()=>cb({exists:!!store[p],data:()=>store[p]});subs.push(run);run();return()=>subs.splice(subs.indexOf(run),1)},
    acquire:async()=>({acquired:true}),update:o=>put(p,c=>({...c,...o})),set:o=>put(p,()=>o)}}
  const dom=new JSDOM('<!doctype html><body>'+html+'</body>',{runScripts:'dangerously',url:'https://board.test/',pretendToBeVisual:true,
    beforeParse(w){w.Math.random=()=>0;if(me)w.localStorage.setItem('ab-me',me);
      w.claude={use:n=>Promise.resolve(n==='db'?{collection:coll,doc}:n==='user'?user:null)};w.HTMLElement.prototype.scrollIntoView=()=>{}}});
  const w=dom.window;w.addEventListener('error',e=>errors.push(e.message));
  return {w,d:w.document,store,writes,errors,notify,key:k=>w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:k,bubbles:true})),pick:id=>w.document.querySelector('#meSel [data-me="'+id+'"]').click()};
}
const fakeUser=(id,write)=>({id:async()=>id,can:async n=>n==='data.write'?write:false,isOwner:async()=>false,canEdit:async()=>false});
const tick=()=>new Promise(r=>setTimeout(r,25));const heal=()=>new Promise(r=>setTimeout(r,600));
let failed=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)failed++};
const note=d=>{const n=d.getElementById('meNote');return n.hidden?'':n.textContent};
const meLane=d=>{const t=d.querySelector('.lane .head .me');return t&&t.parentNode.querySelector('strong').textContent};
(async()=>{
  console.log('# no viewer identity (user capability absent)');
  let b=boot();const {d,store,key,w}=b;
  await tick();await heal();
  ok(d.getElementById('hTitle').textContent==='Test Board','title comes from meta/config');
  ok(d.querySelectorAll('.lane').length===3,'one lane per person');
  ok(d.querySelectorAll('tr.item').length===4,'item table lists every task');
  ok(d.querySelectorAll('.rule').length===3,'rules render as cards');
  ok(JSON.stringify(store['tasks/M1-3'].waitingOn)==='["M1-2"]','page repairs a missing waitingOn');
  ok(!note(d)&&!!d.getElementById('noticeText'),'picker works as before, with no identity note');
  d.querySelector('.pick .btn.primary').click();await tick();await tick();
  ok(store['tasks/M1-1'].owner==='ana'&&store['tasks/M1-1'].status==='doing','claim button claims for the selected person');
  key('3');await tick();
  ok(d.querySelectorAll('.node').length===4&&d.querySelectorAll('path.e').length===2,'graph draws every task and dependency');
  ok(/3 steps/.test(d.getElementById('crit').textContent),'longest remaining chain is found');
  key('2');await tick();
  ok(d.querySelectorAll('.card').length===4,'kanban shows every task');
  key('j');key('Enter');await tick();
  ok(!!d.querySelector('.sheet'),'keyboard opens the detail sheet');
  key('Escape');await tick();
  store['tasks/M1-1']={...store['tasks/M1-1'],status:'done',updatedAt:new Date(Date.now()+60000).toISOString()};b.notify();await tick();await heal();
  ok(JSON.stringify(store['tasks/M1-2'].waitingOn)==='[]','finishing a task unblocks its dependents');
  ok(/New/.test(d.getElementById('newBtn').textContent),'outside changes raise a new marker');
  store['meta/config']={...store['meta/config'],lang:'ko',title:'바뀜'};b.notify();await tick();
  ok(d.querySelector('#tabs button').textContent==='문서','language switches live from meta/config');
  store['meta/config']={...store['meta/config'],strings:{hint:'<kbd>j</kbd> move <img src=x onerror="window.pwned=1">'}};b.notify();await tick();
  ok(!d.querySelector('#hint img')&&d.querySelectorAll('#hint kbd').length===1&&!w.pwned,'config strings cannot inject markup');
  const all=[b];

  console.log('# linked viewer');
  b=boot({user:fakeUser('u_ben',true),docs:{'people/ben':{uid:'u_ben',at:T0}},me:'ana'});all.push(b);await tick();await tick();
  ok(meLane(b.d)==='Ben'&&!note(b.d),'a linked account defaults to its person over the remembered pick');
  ok(/Claim as Ben/.test(b.d.querySelector('.pick .btn.primary').textContent),'claims go to the linked person');
  b.pick('ana');await tick();
  ok(/linked to Ben/.test(note(b.d))&&b.d.getElementById('meNote').className==='err','posting as another person shows a warning');
  ok(!b.store['people/ana'],'an already linked account does not link a second person');
  b.d.querySelector('tr.item').click();await tick();
  ok(!!b.d.querySelector('.composer .err'),'the thread composer repeats the warning');
  b.key('Escape');b.store['meta/config']={...b.store['meta/config'],people:[{id:'ana',uid:'u_ana'},{id:'ben',name:'Ben'},{id:'cy'}]};b.notify();await tick();
  ok(/ana is linked to another account/.test(note(b.d))&&!!b.d.querySelector('#feed .form .err'),'meta/config uid marks a person as someone else');

  console.log('# first pick links the account');
  b=boot({user:fakeUser('u_cy',true)});all.push(b);await tick();await tick();
  ok(/Pick yourself/.test(note(b.d)),'an unlinked account is asked to pick itself');
  b.pick('cy');await tick();await tick();
  ok(b.store['people/cy']&&b.store['people/cy'].uid==='u_cy','picking a person links it to the account');
  ok(!note(b.d)&&meLane(b.d)==='cy','the note clears once linked');
  b.pick('ben');await tick();
  ok(!b.store['people/ben']&&/linked to cy/.test(note(b.d)),'switching away after linking warns and links nothing');

  console.log('# view-only viewer');
  b=boot({user:fakeUser('u_ana',false)});all.push(b);await tick();await heal();
  ok(/View only/.test(note(b.d)),'header says the board is view only');
  ok(!b.d.querySelector('.pick .btn.primary')&&!b.d.getElementById('noticeText'),'no claim buttons and no notice form');
  b.pick('ben');b.d.querySelector('tr.item').click();await tick();
  ok(!b.d.querySelector('.composer')&&b.d.getElementById('fStatus').disabled&&b.d.getElementById('fOwner').disabled,'detail sheet has no composer and locked fields');
  ok(![...b.d.querySelectorAll('.sheet .linkbtn')].some(x=>/Write|Edit/.test(x.textContent)),'summary cannot be edited');
  ok(b.writes.length===0,'the page writes nothing, not even waitingOn repairs or a link');

  console.log('# viewer the platform said nothing about');
  b=boot({user:fakeUser(null,null),deny:true});all.push(b);await tick();await heal();
  ok(!note(b.d)&&!!b.d.querySelector('.pick .btn.primary'),'controls stay while write access is unknown');
  b.d.querySelector('.pick .btn.primary').click();await tick();await tick();
  ok(!b.d.querySelector('.pick .btn.primary')&&/View only/.test(note(b.d)),'a refused write turns the page read-only');

  const errs=all.flatMap(x=>x.errors);
  ok(errs.length===0,'no script errors '+(errs.join('; ')||''));
  process.exit(failed?1:0);
})();
