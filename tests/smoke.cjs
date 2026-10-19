// Smoke test for the board page: runs it in jsdom against an in-memory fake of the artifact db.
// Run: npm install --no-save jsdom@24.1.1 && node tests/smoke.cjs
const {JSDOM}=require('jsdom');const fs=require('fs');const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','skills','artiboard','assets','board.html'),'utf8');
const T0='2026-01-05T09:00:00.000Z';
const store={
  'meta/config':{title:'Test Board',lang:'en',milestone:'M1',people:[{id:'ana'},{id:'ben',name:'Ben'},{id:'cy'}]},
  'meta/protocol':{text:'Intro line\n0. Collections\n- tasks\n1. Reading\n- query'},
  'notices/n-1':{at:T0,author:'ana',kind:'agent',type:'note',text:'Board is up'},
  'tasks/M1-1':{key:'M1-1',title:'Schema',feature:'Data',status:'todo',owner:null,deps:[],waitingOn:[],claimedBy:null,updatedAt:T0},
  'tasks/M1-2':{key:'M1-2',title:'API',feature:'Data',status:'todo',owner:null,deps:['M1-1'],waitingOn:['M1-1'],claimedBy:null,updatedAt:T0},
  'tasks/M1-3':{key:'M1-3',title:'Screen',feature:'UI',status:'todo',owner:null,deps:['M1-2'],claimedBy:null,updatedAt:T0},
  'tasks/M1-4':{key:'M1-4',title:'Docs',feature:'UI',status:'done',owner:'cy',deps:[],waitingOn:[],claimedBy:null,updatedAt:T0},
  'details/M1-1':{spec:'docs/db.md',acceptance:'Migrations run',summary:''}
};
const subs=[];
function snapColl(p,o){let docs=Object.keys(store).filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')).map(k=>({id:k.slice(p.length+1),data:()=>store[k]}));
  if(o.order)docs.sort((a,b)=>(a.data()[o.order]>b.data()[o.order]?1:-1)*(o.dir==='desc'?-1:1));return {docs:o.limit?docs.slice(0,o.limit):docs}}
const notify=()=>subs.slice().forEach(s=>s());
function coll(p,o={}){return {orderBy:(f,d)=>coll(p,{...o,order:f,dir:d}),limit:n=>coll(p,{...o,limit:n}),onSnapshot(cb){const run=()=>cb(snapColl(p,o));subs.push(run);run();return()=>subs.splice(subs.indexOf(run),1)}}}
function doc(p){return {get:async()=>({exists:!!store[p],data:()=>store[p]}),onSnapshot(cb){const run=()=>cb({exists:!!store[p],data:()=>store[p]});subs.push(run);run();return()=>subs.splice(subs.indexOf(run),1)},
  update:async o=>{store[p]={...store[p],...o};setTimeout(notify,0)},set:async o=>{store[p]=o;setTimeout(notify,0)}}}
const dom=new JSDOM('<!doctype html><body>'+html+'</body>',{runScripts:'dangerously',url:'https://board.test/',pretendToBeVisual:true,
  beforeParse(w){w.Math.random=()=>0;w.claude={use:()=>Promise.resolve({collection:coll,doc})};w.HTMLElement.prototype.scrollIntoView=()=>{}}});
const w=dom.window,d=w.document,errors=[];w.addEventListener('error',e=>errors.push(e.message));
const tick=()=>new Promise(r=>setTimeout(r,25));const heal=()=>new Promise(r=>setTimeout(r,600));const key=k=>d.dispatchEvent(new w.KeyboardEvent('keydown',{key:k,bubbles:true}));
let failed=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)failed++};
(async()=>{
  await tick();await heal();
  ok(d.getElementById('hTitle').textContent==='Test Board','title comes from meta/config');
  ok(d.querySelectorAll('.lane').length===3,'one lane per person');
  ok(d.querySelectorAll('tr.item').length===4,'item table lists every task');
  ok(d.querySelectorAll('.rule').length===3,'rules render as cards');
  ok(JSON.stringify(store['tasks/M1-3'].waitingOn)==='["M1-2"]','page repairs a missing waitingOn');
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
  store['tasks/M1-1']={...store['tasks/M1-1'],status:'done',updatedAt:new Date(Date.now()+60000).toISOString()};notify();await tick();await heal();
  ok(JSON.stringify(store['tasks/M1-2'].waitingOn)==='[]','finishing a task unblocks its dependents');
  ok(/New/.test(d.getElementById('newBtn').textContent),'outside changes raise a new marker');
  store['meta/config']={...store['meta/config'],lang:'ko',title:'바뀜'};notify();await tick();
  ok(d.querySelector('#tabs button').textContent==='문서','language switches live from meta/config');
  store['meta/config']={...store['meta/config'],strings:{hint:'<kbd>j</kbd> move <img src=x onerror="window.pwned=1">'}};notify();await tick();
  ok(!d.querySelector('#hint img')&&d.querySelectorAll('#hint kbd').length===1&&!w.pwned,'config strings cannot inject markup');
  ok(errors.length===0,'no script errors '+(errors.join('; ')||''));
  process.exit(failed?1:0);
})();
