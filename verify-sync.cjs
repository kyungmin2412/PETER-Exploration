const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const crypto=require('node:crypto');
const model=require('./ipo-model.js');
class El {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.value='';this.hidden=false;this.dataset={};this.attrs={};this.classList={toggle(){},add(){},remove(){}};this.textContent='';}
  addEventListener(name,fn){this.listeners[name]=fn;}
  setAttribute(k,v){this.attrs[k]=v;}
  append(...items){this.children.push(...items);}
  appendChild(item){this.children.push(item);return item;}
  replaceChildren(...items){this.children=[...items];}
  querySelectorAll(){return [];}
  focus(){} scrollIntoView(){} showModal(){this.open=true;} close(){this.open=false;}
}
const clone=value=>JSON.parse(JSON.stringify(value));
const storage=new Map();
const originalVisits='{"events":{"2026-10-22":[{"company":"existing visit"}]},"earnings":{"2026-10-23":[{"company":"existing earnings"}]}}';
const remote={'events.json':{content:originalVisits},'events.ics':{content:'existing ICS'}};
let fail=false;
let rateLimitAnonymous=false;
let authPrompts=0;
let hold=null;
const writes=[];
function start(){
  const elements=new Map();
  const el=id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id);};
  el('ipoView').hidden=false;
  const fields=Object.fromEntries(model.fields.map(f=>[f,new El('input')]));
  el('ipoForm').elements={namedItem:name=>fields[name]};
  el('ipoForm').reset=()=>{Object.values(fields).forEach(field=>field.value='');};
  class FormData {get(name){return fields[name].value;}}
  const context={console,Date,URL,AbortSignal,crypto,Set,Map,FormData,
    window:{PeterIpoModel:model,addEventListener(){},confirm:()=>true},
    document:{getElementById:el,createElement:tag=>new El(tag),visibilityState:'visible'},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    makeDateKey:(y,m,d)=>y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0'),
    formatSelectedDate:key=>key,HOLIDAYS:{},POLL_INTERVAL_MS:20000,GIST_ID:'fixture',TOKEN_STORAGE_KEY:'fixture-token',gistToken:'fixture-only',
    ensureToken:()=> {authPrompts++;context.gistToken='fixture-only';return 'fixture-only';},showToast(){},setInterval(){},setActiveTab(){},
    fetch:async(url,options={})=>{
      if(rateLimitAnonymous && !options.headers.Authorization) return {ok:false,status:403,json:async()=>({message:'API rate limit exceeded'})};
      if(options.method==='PATCH'){
        if(fail)return {ok:false,status:503};
        if(hold){const barrier=hold;hold=null;await barrier.promise;}
        const payload=JSON.parse(options.body);
        assert.deepEqual(Object.keys(payload.files),['ipos.json'],'only the IPO file may be patched');
        Object.assign(remote,clone(payload.files));writes.push(payload);
      }
      return {ok:true,status:200,json:async()=>({files:clone(remote)})};
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(__dirname+'/ipo.js','utf8'),context);
  const submit=(name,extra={})=>{
    Object.values(fields).forEach(field=>field.value='');
    Object.entries({company:name,subscriptionStart:'2026-10-30',subscriptionEnd:'2026-11-02',...extra}).forEach(([key,value])=>fields[key].value=value);
    el('ipoForm').listeners.submit({preventDefault(){}});
  };
  return {context,el,submit};
}
const flush=async()=>{for(let i=0;i<15;i++)await new Promise(resolve=>setImmediate(resolve));};
const data=()=>JSON.parse(remote['ipos.json'].content).items;
(async()=>{
  let app=start();
  app.submit('첫 번째 기업');await flush();
  assert.equal(Object.keys(data()).length,1);
  assert.equal(remote['events.json'].content,originalVisits);
  assert.equal(remote['events.ics'].content,'existing ICS');
  fail=true;app.submit('오프라인 기업');await flush();
  assert.equal(Object.keys(JSON.parse(storage.get('peterExplorationIpos.pending.v1'))).length,1);
  assert.match(app.el('ipoSyncStatus').textContent,/공유 저장 대기/);
  fail=false;app=start();app.context.window.PeterIpo.refresh();await flush();
  assert.equal(Object.keys(data()).length,2,'reload must retry the durable queue');
  assert.equal(Object.keys(JSON.parse(storage.get('peterExplorationIpos.pending.v1'))).length,0);
  let release;
  hold={promise:new Promise(resolve=>release=resolve)};
  app.submit('저장 중인 기업');await flush();
  app.submit('뒤이어 추가한 기업');await flush();
  release();await flush();
  assert.equal(Object.keys(data()).length,4,'edits made during an in-flight save must also persist');
  assert.equal(Object.keys(JSON.parse(storage.get('peterExplorationIpos.pending.v1'))).length,0);
  assert.equal(remote['events.json'].content,originalVisits);
  rateLimitAnonymous=true;app.context.gistToken='';app.context.window.PeterIpo.refresh();
  await app.el('ipoSyncButton').listeners.click();await flush();
  assert.match(app.el('ipoSyncStatus').textContent,/조회 한도 초과/);
  app.submit('인증 후 저장 기업');await flush();
  assert.ok(authPrompts>0,'saving must request the access code before a rate-limited read');
  assert.equal(Object.keys(data()).length,5);
  console.log('PASS: IPO-only writes, visit/earnings preservation, offline queue, reload retry, in-flight edits and authenticated rate-limit recovery ('+writes.length+' mock writes)');
})().catch(error=>{console.error(error);process.exitCode=1;});
