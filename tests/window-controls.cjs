const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
test('double-click titlebar toggles native maximize only on blank titlebar',()=>{
 let listener, calls=0;
 const window={runtime:{WindowToggleMaximise(){calls++}}};
 vm.runInNewContext(fs.readFileSync('web/window-controls.js','utf8'),{window,document:{addEventListener(name,fn){assert.equal(name,'dblclick');listener=fn}}});
 const target=(strip,interactive)=>({closest(selector){return selector==='.titlebar-strip'?strip:interactive}});
 listener({target:target(true,false),preventDefault(){}}); assert.equal(calls,1);
 listener({target:target(false,false),preventDefault(){}}); assert.equal(calls,1);
 listener({target:target(true,true),preventDefault(){}}); assert.equal(calls,1);
 delete window.runtime;
 listener({target:target(true,false),preventDefault(){}}); assert.equal(calls,1);
});
test('viewport resize updates visible content synchronously without an extra animation frame',()=>{
 const handlers={};let observe,updates=0;
 const window={
  addEventListener(name,fn){handlers[name]=fn},
  ResizeObserver:class {constructor(fn){observe=fn} observe(node){assert.equal(node.id,'rows')}},
  requestAnimationFrame(){assert.fail('resize must not wait for another frame')}
 };
 const context={window,document:{addEventListener(){}}};
 vm.runInNewContext(fs.readFileSync('web/window-controls.js','utf8'),context);
 assert.equal(typeof window.LNWindowControls?.observeViewport,'function');
 window.LNWindowControls.observeViewport({id:'rows'},()=>updates++);
 handlers.resize();assert.equal(updates,1);
 observe();assert.equal(updates,2);
});
