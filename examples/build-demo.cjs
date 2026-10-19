// Builds examples/demo.html: the real board page running on an in-page sample database.
// No artifact capabilities are needed, so the demo can be shared publicly.
// Run: node examples/build-demo.cjs
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
let page=fs.readFileSync(path.join(root,'skills/artiboard/assets/board.html'),'utf8');
const data=fs.readFileSync(path.join(__dirname,'demo-data.json'),'utf8');
const shim=`<script>
// Demo database: same calls as the artifact db, kept in memory. "@-90" means 90 minutes ago.
(function(RAW){
  var now=Date.now();
  try{Object.keys(localStorage).forEach(function(k){if(k.indexOf('ab-')===0)localStorage.removeItem(k)})}catch(e){}
  function fix(v){if(typeof v==='string'&&v.charAt(0)==='@')return new Date(now+Number(v.slice(1))*60000).toISOString();
    if(Array.isArray(v))return v.map(fix);if(v&&typeof v==='object'){var o={};for(var k in v)o[k]=fix(v[k]);return o}return v}
  var store={};for(var p in RAW.docs)store[p]=fix(RAW.docs[p]);
  var subs=[];
  function notify(){setTimeout(function(){subs.slice().forEach(function(s){s()})},0)}
  function snap(p,o){var pre=p+'/';var docs=Object.keys(store).filter(function(k){return k.indexOf(pre)===0&&k.slice(pre.length).indexOf('/')<0})
    .map(function(k){return {id:k.slice(pre.length),data:function(){return store[k]}}});
    if(o.order)docs.sort(function(a,b){var x=a.data()[o.order],y=b.data()[o.order];return (x>y?1:x<y?-1:0)*(o.dir==='desc'?-1:1)});
    return {docs:o.limit?docs.slice(0,o.limit):docs}}
  function sub(run){subs.push(run);run();return function(){var i=subs.indexOf(run);if(i>=0)subs.splice(i,1)}}
  function coll(p,o){o=o||{};return {
    orderBy:function(f,d){return coll(p,{order:f,dir:d,limit:o.limit})},
    limit:function(n){return coll(p,{order:o.order,dir:o.dir,limit:n})},
    onSnapshot:function(cb){return sub(function(){cb(snap(p,o))})}}}
  function doc(p){return {
    get:function(){return Promise.resolve({exists:!!store[p],data:function(){return store[p]}})},
    onSnapshot:function(cb){return sub(function(){cb({exists:!!store[p],data:function(){return store[p]}})})},
    update:function(o){store[p]=Object.assign({},store[p]||{},o);notify();return Promise.resolve()},
    set:function(o){store[p]=o;notify();return Promise.resolve()}}}
  // Demo viewer: no claude.ai identity and write access not stated, so the page keeps its "I am" picker and every control.
  var user={id:function(){return Promise.resolve(null)},can:function(){return Promise.resolve(null)},
    isOwner:function(){return Promise.resolve(false)},canEdit:function(){return Promise.resolve(false)}};
  window.DEMO={use:function(n){return Promise.resolve(n==='db'?{collection:coll,doc:doc}:n==='user'?user:null)}};
  (RAW.events||[]).forEach(function(ev){setTimeout(function(){ev.writes.forEach(function(w){var d=fix(w.data);
    store[w.path]=w.op==='update'?Object.assign({},store[w.path],d):d});notify()},ev.after*1000)});
})(${data.trim()});
</script>
`;
function swap(a,b){if(!page.includes(a))throw new Error('board.html changed; update build-demo.cjs: '+a);page=page.replace(a,b)}
swap('<title>Project Board</title>','<meta charset="utf-8">\n<title>artiboard demo</title>');
swap("claude.use('db')","DEMO.use('db')");
swap("claude.use('user')","DEMO.use('user')");
swap('if(window.claude&&window.claude.use)start();','if(window.DEMO)start();');
const i=page.lastIndexOf('<script>');
page=page.slice(0,i)+shim+page.slice(i);
fs.writeFileSync(path.join(__dirname,'demo.html'),page);
console.log('wrote examples/demo.html',page.length,'bytes');
