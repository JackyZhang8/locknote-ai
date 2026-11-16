const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function mount(overrides = {}) {
 const entry = { id:'draft',state:'pending',title:'Draft',pluginId:'ai',before:null,after:{title:'Draft',content:'Text'},busy:false,...overrides };
 let hooks=[],cursor=0,tree;const calls=[];
 const manager={close(){calls.push('close')},retain(id){calls.push('retain:'+id)},discard(id){calls.push('discard:'+id)},async apply(){calls.push('apply')},async applyAndClose(){calls.push('applyAndClose')},edit(){},...overrides.manager};
 const React={useState(initial){const id=cursor++;if(!(id in hooks))hooks[id]=initial;return [hooks[id],value=>{hooks[id]=typeof value==='function'?value(hooks[id]):value}]},useMemo(fn){return fn()},useEffect(){},useRef(value){return {current:value}},useSyncExternalStore(){}};
 const module={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(__dirname+'/NoteChangeReview.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,document:{body:{},documentElement:{lang:'zh'}},require(name){if(name==='react')return React;if(name==='react-dom')return {createPortal:node=>node};if(name==='react/jsx-runtime')return require(name);if(name.includes('note-changes'))return {noteChanges:manager,diffLines:()=>[]};if(name.includes('ui-text'))return {t:zh=>zh,errorMessage:e=>e.message};throw Error(name)}});
 const render=()=>{cursor=0;tree=module.exports.NoteChangeReviewContent({entry,warning:''})};
 const nodes=()=>{const result=[];function walk(node){if(!node||typeof node!=='object')return;result.push(node);for(const child of [node.props?.children].flat(Infinity))walk(child)}walk(tree);return result};
 render();
 return {calls,entry,render,nodes,has(text){return nodes().some(node=>node.type==='button'&&node.props.children===text)},async click(text){const button=nodes().find(node=>node.type==='button'&&node.props.children===text);assert.ok(button,'missing button '+text);assert.ok(!button.props.disabled,'button disabled');await button.props.onClick();await new Promise(resolve=>setImmediate(resolve));render()}};
}
test('pending minimize asks before closing and continuing leaves draft visible',async()=>{
 const view=mount();await view.click('收起');assert.deepEqual(view.calls,[]);
 for(const label of ['应用并收起','保留建议稿并收起','继续审阅'])assert.ok(view.has(label));
 assert.ok(view.nodes().some(node=>node.props?.role==='dialog'&&node.props['aria-modal']===true));
 await view.click('继续审阅');assert.ok(!view.has('应用并收起'));assert.deepEqual(view.calls,[]);
});
test('retaining explicitly delegates to durable storage and completed reviews minimize directly',async()=>{
 const view=mount();await view.click('收起');await view.click('保留建议稿并收起');assert.deepEqual(view.calls,['retain:draft']);
 const applied=mount({state:'applied'});await applied.click('收起');assert.deepEqual(applied.calls,['close']);
});
test('failed save or retention keeps confirmation open and shows the error',async()=>{
 const view=mount({manager:{async applyAndClose(){throw Error('version conflict')},retain(){throw Error('storage full')}}});
 await view.click('收起');await view.click('应用并收起');assert.ok(view.has('继续审阅'));assert.ok(view.nodes().some(node=>node.props?.role==='alert'&&node.props.children==='version conflict'));
 await view.click('保留建议稿并收起');assert.ok(view.has('继续审阅'));assert.ok(view.nodes().some(node=>node.props?.role==='alert'&&node.props.children==='storage full'));
});
test('discard requires confirmation and saving disables minimizing',async()=>{
 const view=mount();await view.click('丢弃');assert.deepEqual(view.calls,[]);await view.click('确认丢弃');assert.deepEqual(view.calls,['discard:draft']);
 const busy=mount({busy:true});const minimize=busy.nodes().find(node=>node.type==='button'&&node.props.children==='收起');assert.equal(minimize.props.disabled,true);
});

test('apply and minimize delegates saving and only applies after the explicit choice',async()=>{
 const view=mount();await view.click('收起');assert.deepEqual(view.calls,[])
 await view.click('应用并收起');assert.deepEqual(view.calls,['applyAndClose'])
});
