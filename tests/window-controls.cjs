const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
test('only the macOS desktop reserves space above the logo',()=>{
 for (const [platform,desktop,mac] of [['MacIntel',true,true],['Win32',true,false],['Linux x86_64',true,false],['MacIntel',false,false]]) {
  const classes=new Set();
  const window={navigator:{platform},runtime:desktop?{}:undefined};
  const document={documentElement:{classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name)}}},addEventListener(){}};
  vm.runInNewContext(fs.readFileSync('frontend/src/runtime/window-controls.js','utf8'),{window,document});
  window.LNWindowControls.syncDesktopLayout();
  assert.equal(classes.has('desktop'),desktop,platform);
  assert.equal(classes.has('desktop-macos'),mac,platform);
 }
 const css=fs.readFileSync('frontend/src/styles.css','utf8');
 assert.ok(css.includes('html.desktop.desktop-macos .titlebar-strip'));
 assert.ok(!css.includes('html.desktop .titlebar-strip'));
 const controller=fs.readFileSync('frontend/src/controller.js','utf8');
 assert.ok(controller.includes('window.LNWindowControls.syncDesktopLayout()'));
});
test('double-click titlebar toggles native maximize only on blank titlebar',()=>{
 let listener, calls=0;
 const window={runtime:{WindowToggleMaximise(){calls++}}};
 vm.runInNewContext(fs.readFileSync('frontend/src/runtime/window-controls.js','utf8'),{window,document:{addEventListener(name,fn){assert.equal(name,'dblclick');listener=fn}}});
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
 vm.runInNewContext(fs.readFileSync('frontend/src/runtime/window-controls.js','utf8'),context);
 assert.equal(typeof window.LNWindowControls?.observeViewport,'function');
 window.LNWindowControls.observeViewport({id:'rows'},()=>updates++);
 handlers.resize();assert.equal(updates,1);
 observe();assert.equal(updates,2);
});
