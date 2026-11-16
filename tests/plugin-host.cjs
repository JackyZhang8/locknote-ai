const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function harness() {
 const els=new Map();
 const element=id=>{ if(!els.has(id))els.set(id,{value:'',classList:{contains(){return false}}});return els.get(id); };
 const window={LNListPerformance:require('./runtime-helper.cjs'),LNI18N:{tr:x=>x}};
 let src=fs.readFileSync('frontend/src/controller.js','utf8').replace('export function startWorkspace()','function startWorkspace()').replace('  init();','  window.testState = state;');
 vm.runInNewContext(src+';startWorkspace();',{window,document:{getElementById:element},setTimeout,clearTimeout,console,URLSearchParams});
 window.testState.note={id:'n1',title:'Saved',content:'Saved body',version:3};window.testState.selectedId='n1';
 element('docTitle').value='Saved';element('docBody').value='Unsaved body';
 return {window,host:window.LNPluginHost,element};
}
test('plugin current note reads the editor buffer without losing revision identity',async()=>{
 const {host}=harness();assert.ok(host,'workspace must expose plugin host');
 const note=await host.notes.current('test.plugin');assert.equal(note.content,'Unsaved body');assert.equal(note.version,3);assert.equal(note.unsaved,true);
});
test('plugin update refuses unsaved editor and missing expectedVersion before requesting backend',async()=>{
 const {host,element}=harness();assert.ok(host,'workspace must expose plugin host');
 await assert.rejects(()=>host.notes.update('n1',{content:'Replacement',expectedVersion:3},'test.plugin'),/未保存|unsaved/);
 element('docBody').value='Saved body';
 await assert.rejects(()=>host.notes.update('n1',{content:'Replacement'},'test.plugin'),/expectedVersion/);
});

test('plugin save retries keep their original version and never fall back to ordinary writes',async()=>{
 const els=new Map();const element=id=>{if(!els.has(id))els.set(id,{value:'',textContent:'',classList:{contains(){return false},add(){},remove(){}}});return els.get(id)};
 const requests=[];
 const window={LNReactUI:{renderRegion(){}},LNListPerformance:require('./runtime-helper.cjs'),LNI18N:{tr:x=>x},LNPluginTransport:{request:async(id,path,method,body)=>{requests.push({kind:'plugin',id,body});throw new Error('409 conflict')}}};
 let src=fs.readFileSync('frontend/src/controller.js','utf8').replace('export function startWorkspace()','function startWorkspace()').replace('  init();','  window.review={state,flushSave,setSource(id){pendingPluginSource={pluginId:id,noteId:state.note.id,expectedVersion:state.note.version}}};');
 vm.runInNewContext(src+';startWorkspace();',{window,document:{getElementById:element},setTimeout:()=>0,clearTimeout,console,URLSearchParams,fetch:async()=>{requests.push({kind:'normal'});throw new Error('unexpected normal write')}});
 window.review.state.note={id:'n1',title:'Saved',content:'Old',version:3};window.review.state.selectedId='n1';element('docTitle').value='Saved';element('docBody').value='Plugin edit';window.review.setSource('test.plugin');
 await assert.rejects(()=>window.review.flushSave(),/409/);
 window.review.state.note.version=4;
 await assert.rejects(()=>window.review.flushSave(),/409/);
 assert.deepEqual(requests.map(request=>request.kind),['plugin','plugin']);
 assert.deepEqual(requests.map(request=>request.body.expectedVersion),[3,3]);
 assert.deepEqual(requests.map(request=>request.id),['test.plugin','test.plugin']);
});

test('local and desktop note notifications are delivered once in either order',()=>{
 const events=[];
 const window={LNListPerformance:require('./runtime-helper.cjs'),LNI18N:{tr:x=>x},dispatchEvent:event=>events.push(event.detail)};
 let src=fs.readFileSync('frontend/src/controller.js','utf8').replace('export function startWorkspace()','function startWorkspace()').replace('  init();','  window.review={pluginEvent};');
 vm.runInNewContext(src+';startWorkspace();',{window,document:{getElementById:()=>({})},setTimeout:()=>0,clearTimeout,console,URLSearchParams,CustomEvent:class{constructor(type,options){this.detail=options.detail}}});
 const emit=payload=>window.review.pluginEvent('note:change',payload);
 for(const first of ['local','desktop']){
   const id=first;
   const local={type:'note.updated',note:{id,version:2},source:'plugin:test.plugin',pluginId:'test.plugin'};
   const desktop={type:'note.updated',noteId:id,version:2,source:'plugin:test.plugin'};
   emit(first==='local'?local:desktop);emit(first==='local'?desktop:local);
   emit({...desktop,version:3});
   emit({...desktop,type:'note.deleted',version:3});
 }
 assert.equal(events.length,6);
});

test('desktop change reaches plugins after the selected note buffer refreshes',async()=>{
 let runRefresh;const versions=[];
 const window={LNListPerformance:{...require('./runtime-helper.cjs'),createQueue(run){runRefresh=run;return ()=>{}}},LNI18N:{tr:x=>x},dispatchEvent(){versions.push(window.review.state.note.version)}};
 let src=fs.readFileSync('frontend/src/controller.js','utf8').replace('export function startWorkspace()','function startWorkspace()').replace('  init();',"  window.review={state,handleChange}; refreshAll=async function(){}; api=async function(){return {id:'n1',title:'Note',content:'Body',version:2}}; renderEditor=function(){};");
 const el={value:'Body',classList:{contains(){return false}}};
 vm.runInNewContext(src+';startWorkspace();',{window,document:{getElementById:id=>id==='docTitle'?{value:'Note'}:el},setTimeout:()=>0,clearTimeout,console,URLSearchParams,CustomEvent:class{constructor(type,options){this.detail=options.detail}}});
 window.review.state.note={id:'n1',title:'Note',content:'Body',version:1};window.review.state.selectedId='n1';
 window.review.handleChange({type:'note.updated',noteId:'n1',version:2,source:'web'});
 await runRefresh();
 assert.deepEqual(versions,[2]);
});

test('deleted note notifications survive a missing selected note during refresh',async()=>{
 let runRefresh;const versions=[];
 const window={LNListPerformance:{...require('./runtime-helper.cjs'),createQueue(run){runRefresh=run;return ()=>{}}},LNI18N:{tr:x=>x},dispatchEvent(){versions.push(window.review.state.note.version)}};
 let src=fs.readFileSync('frontend/src/controller.js','utf8').replace('export function startWorkspace()','function startWorkspace()').replace('  init();',"  window.review={state,handleChange}; refreshAll=async function(){}; api=async function(){throw new Error('404 note removed')}; toast=function(){}; renderEditor=function(){};");
 const el={value:'Body',classList:{contains(){return false}}};
 vm.runInNewContext(src+';startWorkspace();',{window,document:{getElementById:id=>id==='docTitle'?{value:'Note'}:el},setTimeout:()=>0,clearTimeout,console,URLSearchParams,CustomEvent:class{constructor(type,options){this.detail=options.detail}}});
 window.review.state.note={id:'n1',title:'Note',content:'Body',version:1};window.review.state.selectedId='n1';
 window.review.handleChange({type:'note.deleted',noteId:'n1',version:1,source:'web'});
 await runRefresh();
 assert.deepEqual(versions,[1]);
});

test('search navigation stays selected through rerenders and switches back on note navigation',()=>{
 const elements=new Map();
 const element=id=>{if(!elements.has(id)){const classes=new Set(id==='settingsPage'?['hidden']:[]);elements.set(id,{value:'',classList:{contains:c=>classes.has(c),add:c=>classes.add(c),remove:c=>classes.delete(c),toggle(c,on){if(on)classes.add(c);else classes.delete(c)}},focus(){}})}return elements.get(id)};
 const window={LNListPerformance:require('./runtime-helper.cjs'),LNI18N:{tr:x=>x},LNReactUI:{renderRegion(){}}};
 let src=fs.readFileSync('frontend/src/controller.js','utf8').replace('export function startWorkspace()','function startWorkspace()').replace('  init();','  window.review={state,navigate,renderLibrary}; loadNotes=function(){}; discardSessionDraft=function(){};');
 vm.runInNewContext(src+';startWorkspace();',{window,document:{getElementById:element,querySelector(){return null}},setTimeout,clearTimeout,console,URLSearchParams});
 window.review.navigate('all',true);
 for(let i=0;i<3;i++)window.review.renderLibrary();
 assert.equal(element('searchNav').classList.contains('active'),true);
 assert.equal(element('notesNav').classList.contains('active'),false);
 window.review.navigate('recent');
 assert.equal(element('searchNav').classList.contains('active'),false);
 assert.equal(element('recentNav').classList.contains('active'),true);
 window.review.navigate('all');
 assert.equal(element('notesNav').classList.contains('active'),true);
});

test('history restore preserves edits entered while response is pending',async()=>{
 const els=new Map(),element=id=>{if(!els.has(id))els.set(id,{value:'',textContent:'',classList:{contains(){return false},add(){},remove(){}}});return els.get(id)};
 let bridge,resolveRequest;
 const window={LNListPerformance:require('./runtime-helper.cjs'),LNI18N:{tr:x=>x},LNHistory:{open:value=>{bridge=value}}};
 let src=fs.readFileSync('frontend/src/controller.js','utf8').replace('export function startWorkspace()','function startWorkspace()').replace('  init();', '  window.review={state,showHistory}; savedThen=fn=>fn(); refreshAll=()=>Promise.resolve(); renderEditor=()=>{document.getElementById("docTitle").value=state.note.title;document.getElementById("docBody").value=state.note.content;}; scheduleSave=()=>{};');
 vm.runInNewContext(src+';startWorkspace();',{window,document:{getElementById:element},setTimeout,clearTimeout,console,URLSearchParams,fetch:()=>new Promise(resolve=>{resolveRequest=resolve})});
 window.review.state.note={id:'n1',title:'Title',content:'Original',version:3};window.review.state.selectedId='n1';element('docTitle').value='Title';element('docBody').value='Original';window.review.showHistory();
 const pending=bridge.restore('r1',3);element('docBody').value='New input while waiting';resolveRequest({status:200,ok:true,json:async()=>({id:'n1',title:'Old title',content:'Restored',version:4})});await pending;
 assert.equal(element('docBody').value,'New input while waiting');assert.equal(element('docTitle').value,'Old title');assert.equal(window.review.state.note.version,4);
});

test('autosave waits for history writes before saving a newer editor buffer',async()=>{
 const els=new Map(),element=id=>{if(!els.has(id))els.set(id,{value:'',classList:{contains(){return false}}});return els.get(id)};
 let bridge,resolveRequest,saves=0;
 const window={LNListPerformance:require('./runtime-helper.cjs'),LNI18N:{tr:x=>x},LNHistory:{open:value=>{bridge=value}},save(){saves++;return Promise.resolve()}};
 let src=fs.readFileSync('frontend/src/controller.js','utf8').replace('export function startWorkspace()','function startWorkspace()').replace('  init();','  window.review={state,showHistory,flushSave}; savedThen=fn=>fn(); refreshAll=()=>Promise.resolve(); renderEditor=()=>{}; scheduleSave=()=>{}; performSave=()=>window.save();');
 vm.runInNewContext(src+';startWorkspace();',{window,document:{getElementById:element},setTimeout,clearTimeout,console,URLSearchParams,fetch:()=>new Promise(resolve=>{resolveRequest=resolve})});
 for(const operation of ['restore','undo','failed-restore']){
  window.review.state.note={id:'n1',title:'Title',content:'Original',version:3};window.review.state.selectedId='n1';element('docTitle').value='Title';element('docBody').value='Original';window.review.showHistory();
  const pending=operation==='undo'?bridge.undo({title:'Before',content:'Before body'},3):bridge.restore('r1',3);
  element('docBody').value='New edit';
  const before=saves,queued=window.review.flushSave();await Promise.resolve();
  assert.equal(saves,before,'autosave must not run against the version being restored');
  if(operation==='failed-restore'){
   const rejected=assert.rejects(pending);
   resolveRequest({status:409,ok:false,json:async()=>({error:'Version conflict'})});
   await rejected;
  }else{
   resolveRequest({status:200,ok:true,json:async()=>({id:'n1',title:'Old title',content:'Restored',version:4})});
   await pending;
  }
  await queued;assert.equal(saves,before+1);
 }
});

test('placeholder cleanup protects notes referenced by pending AI drafts',async()=>{
 let protectedNote=true;const removed=[];
 const window={LNListPerformance:require('./runtime-helper.cjs'),LNI18N:{tr:x=>x},LNHasPendingNoteChange:id=>protectedNote && id==='blank'};
 let src=fs.readFileSync('frontend/src/controller.js','utf8').replace('export function startWorkspace()','function startWorkspace()').replace('  init();',"  window.review={state,sessionDrafts,discardSessionDraft}; hasUnsaved=function(){return false}; api=async function(path){removed.push(path)}; renderList=function(){};loadMeta=function(){};loadStats=function(){};");
 vm.runInNewContext(src+';startWorkspace();',{window,document:{getElementById:()=>({})},removed,setTimeout,clearTimeout,console});
 const {state,sessionDrafts,discardSessionDraft}=window.review;
 state.note={id:'blank',title:'未命名笔记',content:'',tags:[],version:1};sessionDrafts.add('blank');
 await discardSessionDraft();assert.equal(removed.length,0);assert.equal(sessionDrafts.has('blank'),true);
 protectedNote=false;await discardSessionDraft();assert.equal(removed.length,1);
});

test('committed plugin create still returns its receipt if refreshing the list fails',async()=>{
 const notices=[],events=[];
 const window={LNListPerformance:require('./runtime-helper.cjs'),LNI18N:{tr:x=>x},LNPluginTransport:{request:async()=>({id:'created',title:'N',content:'Body',version:1})},dispatchEvent:e=>events.push(e.detail)};
 let src=fs.readFileSync('frontend/src/controller.js','utf8').replace('export function startWorkspace()','function startWorkspace()').replace('  init();',"  refreshAll=async function(){throw Error('refresh failed')};toast=function(message){notices.push(message)};")
 vm.runInNewContext(src+';startWorkspace();',{window,notices,document:{getElementById:()=>({})},setTimeout,clearTimeout,console,CustomEvent:class{constructor(_type,options){this.detail=options.detail}}})
 const saved=await window.LNPluginHost.notes.create({content:'Body'},'p')
 assert.equal(saved.id,'created');assert.equal(events[0].payload.note.id,'created');assert.ok(notices.length>0)
})
