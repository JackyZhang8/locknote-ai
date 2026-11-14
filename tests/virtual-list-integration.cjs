const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const performanceTools = require('./runtime-helper.cjs');

function appHarness() {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      innerHTML:'', textContent:'', value:'', scrollTop:0, clientHeight:600,
      classList:{toggle(){},contains(){return false}},
      querySelectorAll(){return []}
    });
    return elements.get(id);
  }
  const window = {LNListPerformance:performanceTools,LNI18N:{tr:s=>s},LNReactUI:{renderRegion(el,html){el.innerHTML=html;}}};
  let source = fs.readFileSync('frontend/src/controller.js','utf8');
  source=source.replace('  init();', '  window.testApp = {state:state, render:renderList, window:renderListWindow, model:function(){return virtualModel;}};');
  source = source.replace('export function startWorkspace()', 'function startWorkspace()') + '; startWorkspace();';
  vm.runInNewContext(source,{window, document:{getElementById:element,activeElement:null},setTimeout,clearTimeout,console});
  return {app:window.testApp,rows:element('rows')};
}
test('actual app renders bounded HTML, selected and checked notes after deep scrolling',()=>{
  const {app,rows}=appHarness();
  app.state.notes=Array.from({length:30000},(_,i)=>({
    id:String(i),title:'标题 '+i,pinned:i<2,source:'web',tags:['tag'],
    excerpt:'正文',updatedAt:new Date().toISOString()
  }));
  app.state.total=30000;
  app.render();
  assert.ok((rows.innerHTML.match(/data-id=/g)||[]).length<20);
  const target=20000;
  rows.scrollTop=app.model().noteTop(target);
  app.state.selectedId=String(target);app.state.multi=true;app.state.chosen.add(String(target));
  app.render();
  assert.match(rows.innerHTML,/class="note active"[^>]*data-id="20000"/);
  assert.match(rows.innerHTML,/type="checkbox" tabindex="-1" checked/);
  assert.ok((rows.innerHTML.match(/data-id=/g)||[]).length<20);
  rows.scrollTop=app.model().total-600;app.window();
  assert.match(rows.innerHTML,/data-id="29999"/);
  rows.scrollTop=0;app.window();
  assert.match(rows.innerHTML,/data-id="0"/);
  assert.doesNotMatch(rows.innerHTML,/data-id="20000"/);
  app.state.notes=[];app.render();
  assert.equal(app.model().notes.length,0);
});
test('growing the viewport fills new rows immediately and unchanged windows preserve DOM',()=>{
 const {app,rows}=appHarness();
 app.state.notes=Array.from({length:100},(_,i)=>({id:String(i),title:'note',source:'web',tags:[],updatedAt:new Date().toISOString()}));
 rows.clientHeight=300;app.render();
 const initialCount=(rows.innerHTML.match(/data-id=/g)||[]).length;
 let html=rows.innerHTML,writes=0;
 Object.defineProperty(rows,'innerHTML',{get(){return html},set(value){html=value;writes++}});
 app.window();assert.equal(writes,0);
 rows.clientHeight=1500;app.window();
 assert.equal(writes,1);
 assert.ok((rows.innerHTML.match(/data-id=/g)||[]).length>initialCount);
 rows.clientHeight=300;app.window();
 assert.equal((rows.innerHTML.match(/data-id=/g)||[]).length,initialCount);
});
