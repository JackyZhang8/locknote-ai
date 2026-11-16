const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const fs=require('node:fs');
function context(name="note-checker",locale="zh-CN") {
 const manifest=JSON.parse(fs.readFileSync(path.resolve('examples/plugins',name,'manifest.json'),'utf8'));
 const dictionary=()=>manifest.locales[locale.split('-')[0]]||manifest.locales[manifest.defaultLocale];
 const commands=new Map(),views=new Map(),events=[];const writes=[];
 const note={id:'n1',title:'Example',content:'# Example  \nTODO next\n',version:4,unsaved:false};
 return {commands,views,writes,note,setLocale(value){locale=value;for(const [name,callback] of [...events])if(name==='language:change')callback({locale})},ctx:{
  i18n:{get locale(){return locale},t(key,params={},fallback=key){return (dictionary()[key]||fallback).replace(/[{]([a-zA-Z0-9_]+)[}]/g,(match,key)=>Object.hasOwn(params,key)?String(params[key]):match)}},
  storage:{get:async()=>({}),set:async()=>{}},
  commands:{register(c){commands.set(c.id,c)}},views:{register(v){views.set(v.id,v)}},
  settings:{register(){}},toolbar:{register(){}},status:{register(){}},menus:{register(){}},
  events:{on(name,fn){const listener=[name,fn];events.push(listener);return()=>{const index=events.indexOf(listener);if(index>=0)events.splice(index,1)}}},
  notes:{current:async()=>note,update:async(id,patch)=>{writes.push({id,patch});return {...note,...patch}}},
  workspace:{openView:async()=>{},revealLine(){}},ui:{notify(){},confirm:async()=>true},onDispose(){return()=>{}},
 }};
}
for(const name of ['outline','note-checker'])test(`${name} example registers manifest commands and complete view cleanup`,async()=>{
 const file=path.resolve('examples/plugins',name);
 const manifest=JSON.parse(fs.readFileSync(path.join(file,'manifest.json'),'utf8'));
 const module=await import(pathToFileURL(path.join(file,'main.js')).href);
 const fixture=context(name);await module.default.activate(fixture.ctx);
 for(const c of manifest.commands)assert.ok(fixture.commands.has(c.id),`missing ${c.id}`);
 assert.ok(fixture.views.size>0);
 for(const view of fixture.views.values())assert.equal(typeof view.mount,'function');
});
test('checker transformation uses expectedVersion and never writes an unsaved buffer',async()=>{
 const module=await import(pathToFileURL(path.resolve('examples/plugins/note-checker/main.js')).href);
 const fixture=context();await module.default.activate(fixture.ctx);
 await fixture.commands.get('trim').run();
 assert.equal(fixture.writes.length,1);assert.equal(fixture.writes[0].patch.expectedVersion,4);assert.equal(fixture.writes[0].patch.content,'# Example\nTODO next\n');
 fixture.note.unsaved=true;await fixture.commands.get('trim').run();assert.equal(fixture.writes.length,1);
});

test('outline exposes one navigation view and opens it on the right',async()=>{
 const module=await import(pathToFileURL(path.resolve('examples/plugins/outline/main.js')).href);
 const fixture=context('outline'),opened=[];
 fixture.ctx.workspace.openView=async id=>{opened.push(id)};
 await module.default.activate(fixture.ctx);
 assert.equal(fixture.views.size,1,'outline should have exactly one sidebar launcher');
 const [view]=fixture.views.values();
 assert.equal(view.location,'right');
 assert.equal(view.id,'outline-right');
 await fixture.commands.get('open').run();
 assert.deepEqual(opened,['outline-right']);
 assert.equal(fixture.commands.has('open-left'),false);
 const manifest=JSON.parse(fs.readFileSync('examples/plugins/outline/manifest.json','utf8'));
 assert.equal(manifest.commands.some(command=>command.id==='open-left'),false);
});

test('checker exposes one sidebar launcher while retaining its report command',async()=>{
 const module=await import(pathToFileURL(path.resolve('examples/plugins/note-checker/main.js')).href);
 const fixture=context();await module.default.activate(fixture.ctx);
 assert.equal([...fixture.views.values()].filter(view=>view.showInNavigation!==false).length,1);
 assert.equal(fixture.views.get('checker').location,'bottom');
 assert.equal(fixture.views.get('report').showInNavigation,false);
 assert.ok(fixture.commands.has('report'));
});

for(const name of ['outline','note-checker'])test(name+' uses the selected language for views and commands',async()=>{
 const module=await import(pathToFileURL(path.resolve('examples/plugins',name,'main.js')).href);
 for(const locale of ['zh-CN','en-US']){
  const fixture=context(name,locale);await module.default.activate(fixture.ctx);
  const titles=[...fixture.views.values(),...fixture.commands.values()].map(item=>item.title);
  for(const title of titles){assert.doesNotMatch(title,/ \/ /);assert.equal(/[一-鿿]/.test(title),locale==='zh-CN');}
 }
});

for(const name of ['outline','note-checker'])test(name+' refreshes mounted panel text when application language changes',async()=>{
 const previous=global.document;
 function element(){return {children:[],style:{},classList:{add(){}},textContent:'',setAttribute(){},addEventListener(){},removeEventListener(){},append(...children){this.children.push(...children)},replaceChildren(...children){this.children=children}}}
 global.document={createElement:element};
 const collect=node=>[node.textContent,...node.children.map(collect)].join(' ');
 let cleanup;
 try{
  const module=await import(pathToFileURL(path.resolve('examples/plugins',name,'main.js')).href);
  const fixture=context(name,'zh-CN');fixture.note.content='TODO action  ';await module.default.activate(fixture.ctx);
  const container=element();cleanup=[...fixture.views.values()][0].mount(container);
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(collect(container),name==='outline'?/暂无 Markdown 标题/:/重新检查/);
  fixture.setLocale('en-US');await new Promise(resolve=>setImmediate(resolve));
  assert.match(collect(container),name==='outline'?/No Markdown headings/:/Check again/);
  assert.doesNotMatch(collect(container),/暂无|重新检查|行尾空格/);
 }finally{cleanup?.();global.document=previous}
});

for(const name of ['outline','note-checker'])test(name+' toolbar toggles its panel while open commands remain explicit',async()=>{
 const module=await import(pathToFileURL(path.resolve('examples/plugins',name,'main.js')).href);
 const fixture=context(name),buttons=[],opened=new Set();
 fixture.ctx.toolbar.register=button=>buttons.push(button);
 fixture.ctx.workspace.openView=async id=>opened.add(id);
 fixture.ctx.workspace.toggleView=async id=>{if(opened.has(id))opened.delete(id);else opened.add(id)};
 await module.default.activate(fixture.ctx);
 const id=name==='outline'?'outline-right':'checker';
 await buttons[0].run();assert.equal(opened.has(id),true);
 await buttons[0].run();assert.equal(opened.has(id),false);
 await fixture.commands.get('open').run();assert.equal(opened.has(id),true);
 await buttons[0].run();assert.equal(opened.has(id),false);
});

test('toggle-enabled examples have a distinct upgrade version from installed 0.1.0',()=>{
 for(const name of ['outline','note-checker']){
  const manifest=JSON.parse(fs.readFileSync(path.resolve('examples/plugins',name,'manifest.json'),'utf8'));
  assert.equal(manifest.version,'0.1.1');
 }
});
