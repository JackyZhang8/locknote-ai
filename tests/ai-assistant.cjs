const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const engine=()=>import(pathToFileURL(path.resolve('examples/plugins/ai-assistant/engine.js')).href);
test('assistant delegates changes to host review and never writes twice',async()=>{
 const {createAssistant}=await engine();const f=fixture();let reviews=0;
 f.ctx.changes={review:async input=>{reviews++;assert.equal(input.before.version,3);assert.equal(input.after.content,'Proposed');return {saved:true,changeId:'change1',id:'n1',title:'Manually edited',version:4}}};
 const assistant=createAssistant(f.ctx,{confirmChange:async()=>{throw new Error('legacy confirmation must not open')}});
 await assistant.executeTool('read_note',{id:'n1'});
 const result=await assistant.executeTool('update_note',{id:'n1',content:'Proposed',expectedVersion:3});
 assert.equal(reviews,1);assert.equal(f.writes.length,0);assert.equal(result.changeId,'change1');assert.equal(result.title,'Manually edited');
});
test('session compaction retains confirmed tool write receipts',async()=>{
 const {createSession}=await import(pathToFileURL(path.resolve('examples/plugins/ai-assistant/session.js')).href);
 const session=createSession({budget:500}),ctx={notes:{current:async()=>null}},provider={baseURL:'https://example.com',model:'test',apiKey:''};
 await session.begin('Save this',provider,ctx);
 session.append({role:'tool',tool_call_id:'saved',content:JSON.stringify({saved:true,id:'saved-note',version:4,title:'Saved'})});
 session.append({role:'assistant',content:'Done'});
 for(let i=0;i<4;i++){await session.begin('Next '+i+'x'.repeat(200),provider,ctx);session.append({role:'assistant',content:'OK'});}
 assert.match(session.messages('System')[1].content,/saved-note/);
});
function fixture(){
 const writes=[],requests=[],confirmations=[];let note={id:'n1',title:'Note',content:'# Hello',version:3,tags:['old']};
 const ctx={notes:{current:async()=>({...note,unsaved:false}),list:async query=>({notes:[{...note,content:undefined}],total:1,query}),get:async()=>({...note}),update:async(id,patch)=>{writes.push({id,patch});note={...note,...patch,version:4};return note},create:async data=>{writes.push(data);return {id:'new',...data,version:1}}},ai:{chatCompletion:async request=>{requests.push(structuredClone(request));return {choices:[{message:{role:'assistant',content:'Done'}}]}}}};
 return {ctx,writes,requests,confirmations,confirm:async change=>{confirmations.push(change);return true},setNote:value=>{note={...note,...value}}};
}
test('assistant provider defaults preserve requested model and validate URL',async()=>{
 const {normalizeProvider}=await engine();
 assert.deepEqual(normalizeProvider({}),{baseURL:'https://api.deepseek.com',model:'deepseek-flash',apiKey:''});
 assert.equal(normalizeProvider({baseURL:'http://127.0.0.1:11434/v1/',model:'local'}).baseURL,'http://127.0.0.1:11434/v1');
 assert.throws(()=>normalizeProvider({baseURL:'http://example.com'}));
 assert.throws(()=>normalizeProvider({baseURL:'https://user:pw@example.com'}));
});
test('assistant reads pages and chunks before confirming version-safe changes',async()=>{
 const {createAssistant}=await engine();const f=fixture();const assistant=createAssistant(f.ctx,{confirmChange:f.confirm});
 await assert.rejects(()=>assistant.executeTool('update_note',{id:'n1',content:'New',expectedVersion:3}),/read|读取/i);
 const page=await assistant.executeTool('search_notes',{query:'Hello',offset:0});assert.equal(page.total,1);
 const read=await assistant.executeTool('read_note',{id:'n1'});assert.equal(read.content,'# Hello');
 await assistant.executeTool('update_note',{id:'n1',content:'New',expectedVersion:3});
 assert.equal(f.writes[0].patch.expectedVersion,3);assert.equal(f.confirmations[0].before.content,'# Hello');assert.equal(f.confirmations[0].after.content,'New');
 await assert.rejects(()=>assistant.executeTool('update_note',{id:'n1',content:'Again',expectedVersion:3}),/read|读取/i);
});
test('assistant rejected confirmation cancelled tasks and unsaved buffers never write',async()=>{
 const {createAssistant}=await engine();const f=fixture();
 const assistant=createAssistant(f.ctx,{confirmChange:async()=>false});
 await assistant.executeTool('read_note',{id:'n1'});
 const result=await assistant.executeTool('update_note',{id:'n1',content:'No',expectedVersion:3});assert.equal(result.cancelled,true);assert.equal(f.writes.length,0);
 const controller=new AbortController();controller.abort();
 await assert.rejects(()=>assistant.executeTool('create_note',{title:'No',content:'No'},controller.signal),/cancel|取消/i);
 f.ctx.notes.current=async()=>({id:'n1',unsaved:true});
 await assert.rejects(()=>assistant.executeTool('update_note',{id:'n1',content:'No',expectedVersion:3}),/unsaved|未保存/i);
});
test('assistant tool loop returns tool results to provider then final response',async()=>{
 const {createAssistant}=await engine();const f=fixture();let count=0;
 f.ctx.ai.chatCompletion=async request=>{f.requests.push(structuredClone(request));return ++count===1?{choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'call1',type:'function',function:{name:'read_note',arguments:'{"id":"n1"}'}}]}}]}:{choices:[{message:{role:'assistant',content:'Summary'}}]}};
 const assistant=createAssistant(f.ctx,{confirmChange:f.confirm});
 assert.equal(await assistant.chat('Summarize',{apiKey:'secret'}),'Summary');
 assert.equal(f.requests[0].model,'deepseek-flash');
 assert.equal(f.requests[1].messages.at(-1).role,'tool');
 assert.equal(f.requests[1].messages.at(-1).tool_call_id,'call1');
 assert.match(f.requests[1].messages.at(-1).content,/# Hello/);
});
test('assistant requires every chunk before replacing a long note and preserves conflicts',async()=>{
 const {createAssistant}=await engine();const f=fixture();f.setNote({content:'x'.repeat(18000)});
 const assistant=createAssistant(f.ctx,{confirmChange:f.confirm});
 const first=await assistant.executeTool('read_note',{id:'n1'});assert.equal(first.content.length,12000);assert.equal(first.nextOffset,12000);
 await assert.rejects(()=>assistant.executeTool('update_note',{id:'n1',content:'new',expectedVersion:3}),/complete|完整/i);
 await assistant.executeTool('read_note',{id:'n1',offset:12000});
 f.ctx.notes.update=async()=>{throw new Error('409 conflict')};
 await assert.rejects(()=>assistant.executeTool('update_note',{id:'n1',content:'new',expectedVersion:3}),/409/);
});

test('assistant plugin exposes one right-side view provider settings and toggle toolbar',async()=>{
 const plugin=await import(pathToFileURL(path.resolve('examples/plugins/ai-assistant/main.js')).href);
 const views=[],settings=[],buttons=[],commands=[],opened=[];
 const ctx={i18n:{locale:'zh-CN'},storage:{get:async()=>({}),set:async()=>{}},views:{register:item=>views.push(item)},settings:{register:item=>settings.push(item)},toolbar:{register:item=>buttons.push(item)},commands:{register:item=>commands.push(item)},workspace:{toggleView:async id=>opened.push(id),openView:async()=>{}},events:{on(){return()=>{}}},onDispose(){}};
 await plugin.default.activate(ctx);
 assert.equal(views.length,1);assert.equal(views[0].location,'right');assert.equal(settings.length,1);
 await buttons[0].run();await buttons[0].run();assert.deepEqual(opened,['assistant','assistant']);
 assert.equal(commands[0].id,'open');
 const previous=global.document;
 function element(tag){return {tagName:tag,children:[],style:{},dataset:{},classList:{add(){}},textContent:'',value:'',setAttribute(){},addEventListener(){},append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items}}}
 global.document={createElement:element};
 try{
  const container=element('div');const dispose=settings[0].mount(container);
  const fields=[];function visit(node){if(node.tagName==='input')fields.push(node);for(const child of node.children)visit(child)}visit(container);
  assert.ok(fields.some(field=>field.value==='deepseek-flash'));
  assert.ok(fields.some(field=>field.type==='password'));
  dispose();assert.equal(container.children.length,0);
 }finally{global.document=previous}
});

test('assistant checks cancellation again after approval and never writes',async()=>{
 const {createAssistant}=await engine();const f=fixture(),controller=new AbortController();
 const assistant=createAssistant(f.ctx,{confirmChange:async()=>{controller.abort();return true}});
 await assistant.executeTool('read_note',{id:'n1'});
 await assert.rejects(()=>assistant.executeTool('update_note',{id:'n1',content:'No',expectedVersion:3},controller.signal),/cancel|取消/i);
 assert.equal(f.writes.length,0);
});
test('assistant recovers from interrupted tool conversations without orphan tool calls',async()=>{
 const {createAssistant}=await engine();const f=fixture();let count=0;
 f.ctx.ai.chatCompletion=async request=>{f.requests.push(structuredClone(request));if(++count===1)throw new Error('network');return {choices:[{message:{role:'assistant',content:'Recovered'}}]}};
 const assistant=createAssistant(f.ctx,{confirmChange:f.confirm});
 await assert.rejects(()=>assistant.chat('First',{}),/network/);
 assert.equal(await assistant.chat('Second',{}),'Recovered');
 assert.equal(f.requests[1].messages.filter(message=>message.role==='user').length,1);
});

test('assistant rendered chat sends messages and rejects proposed changes without writing',async()=>{
 const plugin=await import(pathToFileURL(path.resolve('examples/plugins/ai-assistant/main.js')).href);
 const previous=global.document,views=[];let writes=0,calls=0;
 function node(tag){return {tagName:tag,children:[],listeners:{},style:{},dataset:{},classList:{add(){}},textContent:'',value:'',setAttribute(){},addEventListener(name,fn){this.listeners[name]=fn},append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items},requestSubmit(){return this.listeners.submit({preventDefault(){}})}}}
 const all=root=>[root,...root.children.flatMap(all)];
 global.document={createElement:node,createElementNS:(_,tag)=>node(tag)};
 let cleanup;
 try{
  const current={id:'n1',title:'Note',content:'Original',version:1};
  const ctx={i18n:{locale:'zh-CN'},storage:{get:async()=>({provider:{apiKey:'secret'}}),set:async()=>{}},views:{register:view=>views.push(view)},settings:{register(){}},toolbar:{register(){}},commands:{register(){}},events:{on(){return()=>{}}},onDispose(){},workspace:{},notes:{current:async()=>({...current,unsaved:false}),get:async()=>current,update:async()=>{writes++}},ai:{chatCompletion:async()=>{
   calls++;const tool=calls===1?{name:'read_note',arguments:'{"id":"n1"}'}:calls===2?{name:'update_note',arguments:'{"id":"n1","content":"Changed","expectedVersion":1}'}:null;
   return {choices:[{message:tool?{role:'assistant',content:null,tool_calls:[{id:'call'+calls,type:'function',function:tool}]}:{role:'assistant',content:'No changes saved'}}]};
  }}};
  ctx.conversations={list:async()=>({items:[],activeId:'',next:-1}),create:async()=>({id:'chat',seq:1}),append:async(id,seq,events)=>({id,seq:seq+events.length})};
  await plugin.default.activate(ctx);const container=node('div');cleanup=views[0].mount(container);
  const input=all(container).find(item=>item.tagName==='textarea');input.value='Update my note';
  const form=all(container).find(item=>item.tagName==='form');
  const pending=form.requestSubmit();
  for(let i=0;i<10 && !all(container).some(item=>item.textContent==='拒绝');i++)await new Promise(resolve=>setImmediate(resolve));
  const reject=all(container).find(item=>item.textContent==='拒绝');assert.ok(reject,'must show explicit change confirmation');
  const root=all(container).find(item=>item.className==='ln-ai-root');
  assert.equal(root.dataset.review,'true','review replaces composer within the panel');
  const proposal=all(container).find(item=>item.className==='ln-ai-proposal');
  const preview=proposal.children.find(item=>item.className==='ln-ai-proposal-body');
  const footer=proposal.children.find(item=>item.className==='ln-ai-actions ln-ai-proposal-actions');
  assert.ok(preview,'long note previews have their own scroll area');
  assert.ok(footer,'confirmation actions are outside the scroll area');
  assert.ok(footer.children.some(item=>item.textContent==='确认保存'));
  assert.ok(!all(preview).includes(reject),'reject remains outside overflowing note content');
  assert.ok(all(container).some(item=>item.textContent.includes('Original')));
  reject.listeners.click();await pending;
  assert.equal(root.dataset.review,'false');
  assert.equal(writes,0);assert.equal(calls,3);assert.ok(all(container).some(item=>item.textContent==='No changes saved'));
 }finally{cleanup?.();global.document=previous}
});

test('micro agent captures current buffer once and preserves the prior request prefix',async()=>{
 const {createAssistant}=await engine();const f=fixture(),usage=[];
 f.ctx.notes.current=async()=>({id:'n1',title:'Draft',content:'Unsaved working text',version:3,unsaved:true});
 f.ctx.ai.chatCompletion=async req=>{f.requests.push(structuredClone(req));return {choices:[{message:{role:'assistant',content:'OK'}}],usage:{prompt_tokens:80,completion_tokens:10,prompt_cache_hit_tokens:64,prompt_cache_miss_tokens:16}}};
 const assistant=createAssistant(f.ctx,{confirmChange:f.confirm,onUsage:value=>usage.push(value)});
 await assistant.chat('Explain',{});await assistant.chat('More detail',{});
 const first=f.requests[0],second=f.requests[1];
 assert.match(JSON.stringify(first.messages),/Unsaved working text/);
 assert.deepEqual(second.messages.slice(0,first.messages.length),first.messages);
 assert.equal(JSON.stringify(second.messages).split('Unsaved working text').length-1,1);
 assert.equal(usage.at(-1).cachedTokens,128);assert.equal(usage.at(-1).promptTokens,160);
});
test('micro agent tracks note changes opt out and provider changes',async()=>{
 const {createAssistant}=await engine();const f=fixture();const assistant=createAssistant(f.ctx,{confirmChange:f.confirm});
 await assistant.chat('First',{});f.setNote({id:'n2',title:'Second',content:'Changed context'});
 await assistant.chat('Second',{});assert.match(JSON.stringify(f.requests.at(-1).messages.at(-1)),/Changed context/);
 await assistant.chat('No context',{},undefined,{includeCurrentNote:false});
 assert.match(JSON.stringify(f.requests.at(-1).messages.at(-1)),/disabled/);
 await assistant.chat('Other model',{model:'another'},undefined,{includeCurrentNote:false});
 assert.doesNotMatch(JSON.stringify(f.requests.at(-1).messages),/Changed context/);
});
test('micro agent does not repeat denied write approval within a run',async()=>{
 const {createAssistant}=await engine();const f=fixture();let approvals=0;
 const assistant=createAssistant(f.ctx,{confirmChange:async()=>{approvals++;return false}});
 await assistant.executeTool('read_note',{id:'n1'});
 const one=await assistant.executeTool('update_note',{id:'n1',content:'No',expectedVersion:3});
 const two=await assistant.executeTool('update_note',{id:'n1',content:'Different',expectedVersion:3});
 assert.equal(one.cancelled,true);assert.equal(two.cancelled,true);assert.equal(approvals,1);
});
test('micro agent compacts complete turns and serializes active runs',async()=>{
 const {createAssistant}=await engine();const f=fixture(),events=[];
 const assistant=createAssistant(f.ctx,{confirmChange:f.confirm,contextBudget:6000,onStatus:value=>events.push(value)});
 for(let i=0;i<10;i++)await assistant.chat('Question '+i+' '+ 'x'.repeat(700),{},undefined,{includeCurrentNote:false});
 assert.ok(events.some(value=>value.type==='compacted'));
 assert.ok(JSON.stringify(f.requests.at(-1).messages).length<15000);
 let finish;f.ctx.ai.chatCompletion=()=>new Promise(resolve=>{finish=resolve});
 const pending=assistant.chat('Slow',{});await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(()=>assistant.chat('Concurrent',{}),/running|进行/i);
 finish({choices:[{message:{role:'assistant',content:'OK'}}]});await pending;
});

test('provider validation requires explicit fields and cloud key but allows local no-key',async()=>{
 const {validateProvider}=await import(pathToFileURL(path.resolve('examples/plugins/ai-assistant/provider.js')).href);
 assert.throws(()=>validateProvider({baseURL:'',model:'',apiKey:''}),/URL|地址/i);
 assert.throws(()=>validateProvider({baseURL:'https://api.deepseek.com',model:'',apiKey:'x'}),/model|模型/i);
 assert.throws(()=>validateProvider({baseURL:'https://api.deepseek.com',model:'deepseek-flash',apiKey:''}),/key/i);
 assert.equal(validateProvider({baseURL:'http://localhost:11434/v1',model:'local',apiKey:''}).apiKey,'');
});
test('chat CSS uses nonshrinking auto-height bubbles and compact top-right actions',()=>{
 const css=require('node:fs').readFileSync('examples/plugins/ai-assistant/styles.css','utf8');
 assert.match(css,/flex-shrink:\s*0/);assert.match(css,/height:\s*auto/);
 assert.match(css,/align-self:\s*flex-end/);assert.match(css,/ln-ai-header/);
 assert.match(css,/padding:\s*6px/);
});

function providerDOM(){
 const el=(tag,text,className)=>({tagName:tag,children:[],listeners:{},dataset:{},className:className||'',textContent:text||'',value:'',setAttribute(name,value){this[name]=value},addEventListener(name,fn){this.listeners[name]=fn},append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items}});
 const button=(text,run)=>{const item=el('button',text);item.listeners.click=run;return item};
 const all=root=>[root,...root.children.flatMap(all)];return {el,button,all};
}
test('chat serializes storage preparation and cancels safely on plugin disposal',async()=>{
 const plugin=await import(pathToFileURL(path.resolve('examples/plugins/ai-assistant/main.js')).href);
 const previous=global.document,views=[];let disposePlugin,release,gets=0,calls=0;
 const {el,all}=providerDOM();global.document={createElement:tag=>{const item=el(tag);item.classList={add(){}};item.requestSubmit=()=>item.listeners.submit({preventDefault(){}});return item}};
 try{
  const ctx={i18n:{locale:'zh'},storage:{get:()=>++gets===1?Promise.resolve({provider:{apiKey:'secret'}}):new Promise(resolve=>{release=resolve})},views:{register:view=>views.push(view)},settings:{register(){}},toolbar:{register(){}},commands:{register(){}},events:{on(){return()=>{}}},onDispose:fn=>{disposePlugin=fn},notes:{current:async()=>null},ai:{chatCompletion:async()=>{calls++;return {choices:[{message:{role:'assistant',content:'OK'}}]}}}};
  await plugin.default.activate(ctx);const root=el('div');root.classList={add(){}};const cleanup=views[0].mount(root);
  const input=all(root).find(item=>item.tagName==='textarea');input.value='Hello';const form=all(root).find(item=>item.tagName==='form');
  const first=form.requestSubmit();await form.requestSubmit();assert.equal(gets,2);
  assert.doesNotThrow(()=>disposePlugin());cleanup();release({provider:{apiKey:'secret'}});await first;assert.equal(calls,0);
 }finally{global.document=previous}
});
test('disposing a running micro agent prevents reuse',async()=>{
 const {createAssistant}=await engine();const f=fixture();let finish;const controller=new AbortController();
 f.ctx.ai.chatCompletion=()=>new Promise(resolve=>{finish=resolve});const assistant=createAssistant(f.ctx);
 const pending=assistant.chat('Slow',{},controller.signal);await new Promise(resolve=>setImmediate(resolve));controller.abort();
 assert.doesNotThrow(()=>assistant.dispose());finish({choices:[{message:{role:'assistant',content:'Late'}}]});
 await assert.rejects(()=>pending,/cancel|取消/i);await assert.rejects(()=>assistant.chat('Again',{}),/disposed|卸载/i);
});
test('provider form discovers and selects models tests unsaved values and validates key',async()=>{
 const {mountProviderForm}=await import(pathToFileURL(path.resolve('examples/plugins/ai-assistant/provider.js')).href);
 const {el,button,all}=providerDOM(),root=el('div'),calls=[],saved=[];
 const ctx={ai:{listModels:async req=>{calls.push(req);return {models:['model-b','model-a']}},chatCompletion:async req=>{calls.push(req);return {choices:[{message:{role:'assistant',content:'OK'}}]}}},storage:{get:async()=>({other:'kept'}),set:async value=>saved.push(value)}};
 const dispose=mountProviderForm(root,{ctx,config:{baseURL:'https://api.deepseek.com',model:'deepseek-flash',apiKey:''},tr:(zh)=>zh,el,button,onSave(){}});
 const get=all(root).find(item=>item.textContent==='获取'),test=all(root).find(item=>item.textContent==='测试');
 const key=all(root).find(item=>item.type==='password'),model=all(root).find(item=>item['aria-label']==='模型');
 await get.listeners.click();assert.equal(calls.length,0);assert.ok(all(root).some(item=>item.textContent.includes('API Key is required')));
 key.value='secret';key.listeners.input();await get.listeners.click();
 const picker=all(root).find(item=>item['aria-label']==='选择模型');assert.equal(picker.hidden,false);
 picker.value='model-b';picker.listeners.change();assert.equal(model.value,'model-b');
 await test.listeners.click();assert.equal(calls.at(-1).model,'model-b');assert.equal(calls.at(-1).maxTokens,16);assert.equal(calls.at(-1).messages.length,1);assert.doesNotMatch(JSON.stringify(calls.at(-1)),/# Hello/);
 await root.children[0].listeners.submit({preventDefault(){}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(saved[0].provider.model,'model-b');assert.equal(saved[0].other,'kept');
 dispose();assert.equal(root.children.length,0);
});
test('provider form ignores stale discovered models and aborts on unmount',async()=>{
 const {mountProviderForm}=await import(pathToFileURL(path.resolve('examples/plugins/ai-assistant/provider.js')).href);
 const {el,button,all}=providerDOM(),root=el('div');let finish,signal;
 const ctx={ai:{listModels:async(_req,options)=>{signal=options.signal;return new Promise(resolve=>{finish=resolve})}},storage:{}};
 const dispose=mountProviderForm(root,{ctx,config:{baseURL:'https://api.deepseek.com',model:'deepseek-flash',apiKey:'secret'},tr:zh=>zh,el,button,onSave(){}});
 const pending=all(root).find(item=>item.textContent==='获取').listeners.click();
 const base=all(root).find(item=>item['aria-label']==='Base URL');base.value='https://other.example';base.listeners.input();
 assert.equal(signal.aborted,true);finish({models:['old-model']});await pending;
 assert.equal(all(root).find(item=>item['aria-label']==='选择模型').hidden,true);
 const next=all(root).find(item=>item.textContent==='获取').listeners.click();dispose();assert.equal(signal.aborted,true);finish({models:[]});await next;
});
test('micro agent retains confirmed write receipts after a later network failure',async()=>{
 const {createAssistant}=await engine();const f=fixture();let count=0;
 f.ctx.ai.chatCompletion=async req=>{f.requests.push(structuredClone(req));count++;
  if(count===1)return {choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'r',type:'function',function:{name:'read_note',arguments:'{"id":"n1"}'}}]}}]};
  if(count===2)return {choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'w',type:'function',function:{name:'update_note',arguments:'{"id":"n1","content":"Saved","expectedVersion":3}'}}]}}]};
  if(count===3)throw new Error('network after save');return {choices:[{message:{role:'assistant',content:'Already saved'}}]};
 };
 const assistant=createAssistant(f.ctx,{confirmChange:f.confirm});
 await assert.rejects(()=>assistant.chat('Update',{}),/network after save/);assert.equal(f.writes.length,1);
 await assistant.chat('Did it save?',{});
 assert.match(JSON.stringify(f.requests.at(-1).messages),/writes already completed/);assert.equal(f.writes.length,1);
});

test('assistant checkpoint restores multi-turn context after restart without credentials',async()=>{
 const {createAssistant}=await engine();const f=fixture();let checkpoint;
 const first=createAssistant(f.ctx,{onJournal:async event=>{if(event.type==='checkpoint')checkpoint=structuredClone(event)}});
 await first.chat('Remember the blue notebook',{apiKey:'never-store-this'});
 assert.ok(checkpoint?.state);assert.doesNotMatch(JSON.stringify(checkpoint),/never-store-this/);
 const second=createAssistant(f.ctx);second.restore(checkpoint.state,checkpoint.interrupted);
 await second.chat('What color was it?',{apiKey:'never-store-this'});
 const last=f.requests.at(-1).messages;assert.ok(last.some(item=>item.role==='user'&&item.content.includes('Remember the blue')));
 assert.ok(last.some(item=>item.role==='assistant'&&item.content==='Done'));
});
test('restored interrupted session keeps write receipts and never resumes tools',async()=>{
 const {createSession}=await import(pathToFileURL(path.resolve('examples/plugins/ai-assistant/session.js')).href);
 const session=createSession();await session.begin('save it',{baseURL:'https://example.com',model:'test',apiKey:'key'},{notes:{current:async()=>null}});
 session.append({role:'assistant',tool_calls:[{id:'pending',type:'function',function:{name:'create_note',arguments:'{}'}}]});
 session.receipt({saved:true,id:'saved-once',version:2},'create_note');
 const restored=createSession();restored.restore(session.snapshot(),true);
 const messages=restored.messages('system');assert.ok(!messages.some(item=>item.tool_calls));assert.match(messages.at(-1).content,/saved-once/);
 assert.throws(()=>restored.restore({history:[{role:'system',content:'invalid'}]},false));
});

test('conversation journal restores latest chat and serializes append failures',async()=>{
 const {createJournal}=await import(pathToFileURL(path.resolve('examples/plugins/ai-assistant/journal.js')).href);
 const records=[];let seq=1,activeId='chat',fail=false;
 const api={list:async()=>({items:[{id:'chat'}],activeId,next:-1}),read:async()=>({id:'chat',seq,before:0,events:records,checkpoint:records.findLast(e=>e.type==='checkpoint')}),activate:async id=>{activeId=id},create:async()=>({id:'new',seq:1}),append:async(id,expected,events)=>{if(fail)throw new Error('disk full');assert.equal(expected,seq);await new Promise(r=>setImmediate(r));for(const e of events)records.push({...e,seq:++seq});return {id,seq}},delete:async()=>{},rename:async()=>{}};
 const journal=createJournal(api);await journal.initialize();await Promise.all([journal.append({type:'message',role:'user',content:'Hi'}),journal.append({type:'message',role:'assistant',content:'Hello'})]);assert.equal(seq,3);
 await journal.append({type:'checkpoint',state:{v:1,history:[],receipts:[]},interrupted:false});
 const restarted=createJournal(api);const loaded=await restarted.initialize();assert.deepEqual(loaded.messages.map(m=>m.content),['Hi','Hello']);assert.equal(loaded.checkpoint.interrupted,false);
 fail=true;await assert.rejects(()=>restarted.append({type:'message',content:'No'}),/disk full/);fail=false;
 await assert.rejects(()=>restarted.append({type:'message',content:'Do not silently skip failed message'}),/重新打开|reopen/);
 await restarted.open('chat');await restarted.append({type:'message',role:'user',content:'Recovered'});
});

test('a new turn interrupted before its checkpoint keeps the prior completed turn',async()=>{
 const {createJournal}=await import(pathToFileURL(path.resolve('examples/plugins/ai-assistant/journal.js')).href);
 const {createAssistant}=await engine();const f=fixture();let checkpoint;
 const a=createAssistant(f.ctx,{onJournal:async e=>{if(e.type==='checkpoint')checkpoint=structuredClone({...e,seq:5})}});await a.chat('Remember this',{});
 const journal=createJournal({list:async()=>({activeId:'chat'}),activate:async()=>{},read:async()=>({id:'chat',seq:7,before:0,checkpoint,events:[{seq:6,type:'turn_start'},{seq:7,type:'message',role:'user',content:'Interrupted'}]})});
 const loaded=await journal.initialize();const b=createAssistant(f.ctx);b.restore(loaded.checkpoint.state,loaded.checkpoint.interrupted);await b.chat('Continue',{});
 assert.ok(f.requests.at(-1).messages.some(m=>m.role==='user'&&m.content.includes('Remember this')));
});

test('assistant panel restores chat after activation and continues with prior messages',async()=>{
 const plugin=await import(pathToFileURL(path.resolve('examples/plugins/ai-assistant/main.js')).href),previous=global.document;
 function node(tag){return {tagName:tag,children:[],listeners:{},style:{},dataset:{},classList:{add(){}},textContent:'',value:'',setAttribute(){},addEventListener(name,fn){this.listeners[name]=fn},append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items},requestSubmit(){return this.listeners.submit({preventDefault(){}})}}}
 const all=root=>[root,...root.children.flatMap(all)],events=[],requests=[];let activeId='',seq=1;
 const conversations={list:async()=>({items:activeId?[{id:activeId,title:'Chat'}]:[],activeId,next:-1}),create:async()=>{activeId='chat';return {id:'chat',seq:1}},activate:async id=>{activeId=id},read:async()=>({id:'chat',seq,before:0,events:structuredClone(events),checkpoint:structuredClone(events.findLast(e=>e.type==='checkpoint'))}),append:async(id,expected,list)=>{assert.equal(expected,seq);events.push(...list.map(e=>({...structuredClone(e),seq:++seq})));return {id,seq}}};
 global.document={createElement:node,createElementNS:(_,tag)=>node(tag)};
 const disposers=[];
 try{
  async function boot(){const views=[],f=fixture();f.ctx.ai.chatCompletion=async request=>{requests.push(structuredClone(request));return {choices:[{message:{role:'assistant',content:'Blue notebook'}}]}};
   Object.assign(f.ctx,{conversations,i18n:{locale:'zh'},storage:{get:async()=>({provider:{apiKey:'secret'}})},views:{register:v=>views.push(v)},settings:{register(){}},toolbar:{register(){}},commands:{register(){}},events:{on:()=>()=>{}},workspace:{},onDispose:fn=>disposers.push(fn)});
   await plugin.default.activate(f.ctx);const root=node('div');const unmount=views[0].mount(root);return {root,unmount,send:async value=>{all(root).find(n=>n.tagName==='textarea').value=value;await all(root).find(n=>n.tagName==='form').requestSubmit()}};
  }
  const first=await boot();await first.send('Remember the color blue');first.unmount();disposers.splice(0).forEach(fn=>fn());
  const second=await boot();assert.ok(all(second.root).some(n=>n.textContent==='Remember the color blue'));assert.ok(all(second.root).some(n=>n.textContent==='Blue notebook'));
  await second.send('Which color?');assert.ok(requests.at(-1).messages.some(m=>m.role==='user'&&m.content.includes('Remember the color blue')));second.unmount();
 }finally{disposers.forEach(fn=>fn());global.document=previous}
});

test('failed recovery cannot silently continue with an empty model history',async()=>{
 const plugin=await import(pathToFileURL(path.resolve('examples/plugins/ai-assistant/main.js')).href),previous=global.document;let calls=0;
 function node(tag){return {tagName:tag,children:[],listeners:{},style:{},dataset:{},classList:{add(){}},textContent:'',value:'',setAttribute(){},addEventListener(name,fn){this.listeners[name]=fn},append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items},requestSubmit(){return this.listeners.submit({preventDefault(){}})}}}
 const all=root=>[root,...root.children.flatMap(all)],views=[],f=fixture();global.document={createElement:node,createElementNS:(_,tag)=>node(tag)};
 try{
  Object.assign(f.ctx,{i18n:{locale:'zh'},storage:{get:async()=>({provider:{apiKey:'secret'}})},views:{register:v=>views.push(v)},settings:{register(){}},toolbar:{register(){}},commands:{register(){}},events:{on:()=>()=>{}},workspace:{},onDispose(){},conversations:{list:async()=>({activeId:'broken'}),read:async()=>({id:'broken',seq:2,events:[],checkpoint:{state:{invalid:true}}}),activate:async()=>{},append:async()=>({id:'broken',seq:3})}});
  f.ctx.ai.chatCompletion=async()=>{calls++;return {choices:[{message:{role:'assistant',content:'response'}}]}};
  await plugin.default.activate(f.ctx);const root=node('div'),cleanup=views[0].mount(root);all(root).find(n=>n.tagName==='textarea').value='Continue';await all(root).find(n=>n.tagName==='form').requestSubmit();assert.equal(calls,0);cleanup();
 }finally{global.document=previous}
});

test('change hints follow the active note and expire without refreshing their lifetime',async()=>{
 const {createChangeHints}=await import(pathToFileURL(path.resolve('examples/plugins/ai-assistant/change-hints.js')).href);
 let now=100000;const hints=createChangeHints(()=>now),base={id:'c1',noteId:'n1',title:'Edited',createdAt:new Date(now).toISOString(),state:'applied'};
 assert.equal(hints.select([base],'n1')?.id,'c1');assert.equal(hints.select([base],'n2'),null);
 now+=19000;assert.equal(hints.select([base],'n1')?.id,'c1');now+=1001;assert.equal(hints.select([base],'n1'),null);
 const pending={...base,state:'pending'};assert.equal(hints.select([pending],'n1')?.id,'c1');now+=60000;assert.equal(hints.select([pending],'n1')?.id,'c1');
 const applied={...pending,state:'applied'};assert.equal(hints.select([applied],'n1')?.id,'c1');now+=20001;assert.equal(hints.select([applied],'n1'),null);
 assert.equal(hints.select([{...base,id:'old',createdAt:new Date(0).toISOString()}],'n1'),null);
 assert.equal(hints.select([{...base,id:'missing',noteId:undefined,state:'pending'}],'n1'),null);
});

async function assistantPanelHarness(options={}){
 const previous=global.document,{el,all}=providerDOM(),views=[],listeners=new Map(),timers=new Set();let current={id:'n1',title:'First',content:'',version:1},changes=[];
 global.document={activeElement:null,createElement:tag=>{const item=el(tag);item.classList={add(){}};item.focus=()=>{global.document.activeElement=item};item.contains=target=>all(item).includes(target);item.querySelectorAll=()=>all(item).filter(n=>['button','input','select','textarea'].includes(n.tagName)&&!n.hidden&&!n.disabled);return item}};
 global.document.createElementNS=(_,tag)=>global.document.createElement(tag);
 const ctx={i18n:{locale:'zh'},storage:{get:async()=>({}),set:async()=>{}},views:{register:v=>views.push(v)},settings:{register(){}},toolbar:{register(){}},commands:{register(){}},workspace:{},onDispose(){},notes:{current:async()=>current},changes:{list:()=>changes,open(){}},events:{on(name,fn){const items=listeners.get(name)||new Set();items.add(fn);listeners.set(name,items);return()=>items.delete(fn)}},timers:{setTimeout(fn){timers.add(fn);return()=>timers.delete(fn)}},conversations:{list:options.list|| (async()=>({items:Array.from({length:70},(_,i)=>({id:'c'+i,title:'Chat '+i,updatedAt:new Date().toISOString()})),activeId:'',next:-1}))}};
 Object.assign(ctx, options.ctx || {});
 const plugin=await import(pathToFileURL(path.resolve('examples/plugins/ai-assistant/main.js')).href);await plugin.default.activate(ctx);const root=global.document.createElement('div'),cleanup=views[0].mount(root);
 const emit=(name,value)=>{for(const fn of listeners.get(name)||[])fn(value)};
 return {root,all,find:cls=>all(root).find(n=>n.className===cls),click:async text=>{const b=all(root).find(n=>n.tagName==='button'&&n.textContent===text);assert.ok(b,text);return b.listeners.click({target:b})},select(note){current=note;emit('note:selection',note)},changes(value){changes=value;emit('changes:change')},emit,timers,cleanup(){cleanup();global.document=previous}};
}
test('history and configuration overlay the chat and close with Escape or backdrop',async()=>{
 const h=await assistantPanelHarness();
 try{
  await h.click('历史');const overlay=h.find('ln-ai-overlay'),chat=h.find('ln-ai-chat');assert.ok(overlay,'must have an overlay');assert.equal(overlay.hidden,false);assert.equal(chat.inert,true);
  assert.equal(h.find('ln-ai-history').hidden,false);assert.equal(h.all(h.find('ln-ai-history')).filter(n=>n.className==='ln-ai-history-row').length,70);
  await h.click('配置');assert.equal(h.find('ln-ai-history').hidden,true);assert.equal(h.find('ln-ai-settings').hidden,false);
  overlay.listeners.keydown({key:'Escape',preventDefault(){},stopPropagation(){}});assert.equal(overlay.hidden,true);assert.equal(chat.inert,false);
  await h.click('历史');overlay.listeners.click({target:overlay});assert.equal(overlay.hidden,true);
 }finally{h.cleanup()}
});
test('change cards disappear immediately on note switch and timers are disposed',async()=>{
 const h=await assistantPanelHarness();
 try{
  await new Promise(r=>setImmediate(r));h.changes([{id:'change',noteId:'n1',state:'applied',title:'First',createdAt:new Date().toISOString()}]);
  assert.equal(h.find('ln-ai-changes').children.length,1);assert.ok(h.timers.size>0);
  h.select({id:'n2',title:'Second'});assert.equal(h.find('ln-ai-changes').children.length,0);
  h.select(null);assert.equal(h.find('ln-ai-changes').children.length,0);
 }finally{h.cleanup();assert.equal(h.timers.size,0)}
});

test('assistant overlay scrolls inside bounded panel while chat remains in place',()=>{
 const css=require('node:fs').readFileSync('examples/plugins/ai-assistant/styles.css','utf8');
 assert.match(css,/\.ln-ai-root > \.ln-ai-overlay\s*\{[^}]*position:\s*absolute/);
 assert.match(css,/\.ln-ai-panel-body\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/);
 assert.match(css,/\.ln-ai-history\s*\{[^}]*overflow-y:\s*auto/);
 assert.match(css,/\.ln-ai-chat\[inert\]/);
 assert.match(css,/\.ln-ai-root > \.ln-ai-overlay\[hidden\]\s*\{\s*display:\s*none/);
 assert.match(css,/\.ln-ai-root\[data-review="true"\] \.ln-ai-chat > \.ln-ai-proposal/);
});
test('closed history overlay ignores a late async list result',async()=>{
 let resolveList,calls=0;const h=await assistantPanelHarness({list:async()=>{if(++calls===1)return {items:[],activeId:'',next:-1};return new Promise(resolve=>{resolveList=resolve})}});
 try{
  const opening=h.click('历史');await new Promise(r=>setImmediate(r));const overlay=h.find('ln-ai-overlay');overlay.listeners.keydown({key:'Escape',preventDefault(){},stopPropagation(){}});
  resolveList({items:[{id:'late',title:'Late',updatedAt:new Date().toISOString()}],next:-1});await opening;
  assert.equal(overlay.hidden,true);assert.equal(h.find('ln-ai-history').hidden,true);assert.ok(!h.all(h.root).some(n=>n.textContent==='Late'));
 }finally{h.cleanup()}
});

test('a fresh chat remains available after recovery fails',async()=>{
 const {createJournal}=await import(pathToFileURL(path.resolve('examples/plugins/ai-assistant/journal.js')).href);
 let fail=true;const j=createJournal({list:async()=>{throw Error('read failed')},create:async()=>{if(fail)throw Error('disk full');return {id:'new',seq:1}},append:async(id,seq)=>({id,seq:seq+1})});
 await assert.rejects(()=>j.initialize());await assert.rejects(()=>j.create('New'),/disk full/);fail=false;
 await j.create('New');await j.append({type:'message',content:'Recovered'});assert.equal(j.current.id,'new');
});
test('history pagination consumes its cursor once and deduplicates rows',async()=>{
 let calls=0;const h=await assistantPanelHarness({list:async offset=>{if(!calls++)return {items:[],activeId:'',next:-1};return {items:offset?[{id:'first',title:'First'},{id:'second',title:'Second'}]:[{id:'first',title:'First'}],activeId:'',next:offset?-1:50}}});
 try{await h.click('历史');const more=h.all(h.root).find(n=>n.textContent==='更多会话');await more.listeners.click({target:more});await more.listeners.click({target:more});assert.equal(h.all(h.root).filter(n=>n.textContent==='Second').length,1);assert.equal(h.all(h.root).filter(n=>n.textContent==='First').length,1);assert.equal(h.all(h.root).filter(n=>n.textContent==='更多会话').length,0);}finally{h.cleanup()}
});
test('tool turns persist only start/end full checkpoints with durable tool receipts',async()=>{
 const {createAssistant}=await engine(),f=fixture();let rounds=0;const events=[];
 f.ctx.ai.chatCompletion=async()=>({choices:[{message:rounds++<4?{role:'assistant',content:null,tool_calls:[{id:'c'+rounds,type:'function',function:{name:'current_note',arguments:'{}'}}]}:{role:'assistant',content:'Done'}}]});
 const a=createAssistant(f.ctx,{onJournal:async e=>events.push(structuredClone(e))});await a.chat('Read',{});
 assert.equal(events.filter(e=>e.type==='checkpoint').length,2);assert.equal(events.filter(e=>e.type==='tool').length,4);assert.equal(events.at(-1).interrupted,false);
});

test('interrupted long tool turns recover receipts beyond the visible message page',async()=>{
 const {createJournal}=await import(pathToFileURL(path.resolve('examples/plugins/ai-assistant/journal.js')).href);
 const checkpoint={type:'checkpoint',seq:2,interrupted:true,state:{v:1,history:[{role:'user',content:'Make notes'}],receipts:[]}};
 const events=[{type:'session',seq:1},checkpoint,...Array.from({length:70},(_,i)=>({seq:i+3,type:'tool',name:'create_note',result:{saved:true,id:'n'+i}}))];let reads=0;
 const journal=createJournal({list:async()=>({activeId:'chat'}),activate:async()=>{},read:async(id,before=-1)=>{reads++;const items=events.filter(e=>before<0||e.seq<before).slice(-32);return {id,seq:72,checkpoint,events:items,before:items[0].seq>1?items[0].seq:0}}});
 const loaded=await journal.initialize();assert.equal(loaded.checkpoint.state.receipts.length,70);assert.ok(reads>=3);
});
test('prepending older messages restores the first visible message offset',async()=>{
 const {captureMessageAnchor,restoreMessageAnchor}=await import(pathToFileURL(path.resolve('examples/plugins/ai-assistant/scroll-anchor.js')).href);
 let scrollTop=80;const old=[{getBoundingClientRect:()=>({top:-30,bottom:-5})},{getBoundingClientRect:()=>({top:-5,bottom:45})}];
 const log={children:old,get scrollTop(){return scrollTop},set scrollTop(value){scrollTop=value},scrollHeight:500,getBoundingClientRect:()=>({top:0})};
 const anchor=captureMessageAnchor(log);log.children=[{},...old.map(n=>({getBoundingClientRect:()=>({top:n.getBoundingClientRect().top+120,bottom:200})}))];log.scrollTop=999;restoreMessageAnchor(log,anchor,1);assert.equal(scrollTop,1119);
});

test('retaining a proposal ends the turn without another model request or tool write', async()=>{
 const {createAssistant}=await engine();const f=fixture();let requests=0,reviews=0;
 f.ctx.changes={review:async()=>{reviews++;return {saved:false,deferred:true,changeId:'retained'}}};
 f.ctx.ai.chatCompletion=async()=>{requests++;return {choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'new1',type:'function',function:{name:'create_note',arguments:JSON.stringify({title:'Draft',content:'Content'})}},{id:'new2',type:'function',function:{name:'create_note',arguments:JSON.stringify({title:'Other',content:'Not allowed'})}}]}}]}};
 const messages=[],events=[];
 const assistant=createAssistant(f.ctx,{onMessage:value=>messages.push(value),onJournal:async event=>events.push(event)});
 await assistant.chat('Write a note',{apiKey:'secret'});
 assert.equal(requests,1);assert.equal(reviews,1);assert.equal(f.writes.length,0);
 assert.match(messages.at(-1),/建议稿.*尚未|draft.*not.*saved/i);
 assert.equal(events.at(-1).type,'checkpoint');assert.equal(events.at(-1).interrupted,false);
 const checkpoint=events.at(-1).state.history;
 const tools=checkpoint.filter(message=>message.role==='tool');assert.deepEqual(tools.map(message=>message.tool_call_id),['new1','new2']);
 assert.equal(JSON.parse(tools[0].content).deferred,true);assert.equal(JSON.parse(tools[1].content).cancelled,true);
});

test('provider settings use explicit revision and keep configuration unchanged on conflict',async()=>{
 const {mountProviderForm}=await import(pathToFileURL(path.resolve('examples/plugins/ai-assistant/provider.js')).href)
 const {el,button,all}=providerDOM(),root=el('div');let revision='',applied=0,legacyWrites=0
 const ctx={storage:{snapshot:async()=>({data:{other:'keep'},revision:'original'}),compareAndSet:async(data,expected)=>{revision=expected;assert.equal(data.other,'keep');throw Object.assign(Error('配置已变化，请重新载入'),{code:'CONFIG_CONFLICT'})},get:async()=>({}),set:async()=>{legacyWrites++}}}
 const dispose=mountProviderForm(root,{ctx,config:{baseURL:'https://api.deepseek.com',model:'deepseek-flash',apiKey:'secret'},tr:zh=>zh,el,button,onSave(){applied++}})
 await root.children[0].listeners.submit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve))
 assert.equal(revision,'original');assert.equal(applied,0);assert.equal(legacyWrites,0)
 assert.ok(all(root).some(item=>item.textContent.includes('配置已变化')));dispose()
})

test('history rows show a title and visible timestamp with only an accessible trash icon',async()=>{
 const h=await assistantPanelHarness();
 try{
  await h.click('历史');const row=h.all(h.root).find(n=>n.className==='ln-ai-history-row');
  assert.ok(!h.all(row).some(n=>['重命名','保存','删除'].includes(n.textContent)));
  assert.ok(h.all(row).some(n=>n.tagName==='time'&&n.textContent));
  assert.ok(h.all(row).some(n=>n.className==='ln-ai-history-title'&&n.textContent==='Chat 0'));
  const remove=h.all(row).find(n=>n.className==='ln-ai-history-delete');assert.equal(remove['aria-label'],'删除会话');
 }finally{h.cleanup()}
});

test('a completed chat defers a persisted title, updates an open list and reuses it after reopen',async()=>{
 const calls=[],records=[];let title='',seq=0,exists=false;
 const conversations={
  list:async()=>({items:exists?[{id:'new',title,updatedAt:'2026-11-17T09:00:00Z'}]:[],activeId:'',next:-1}),
  create:async value=>{exists=true;title=value;return {id:'new',seq:++seq,title}},
  append:async(id,expected,events)=>{assert.equal(expected,seq);for(const event of events)records.push({...event,seq:++seq});return {id,seq,title}},
  read:async()=>({id:'new',title,seq,before:0,events:records,checkpoint:records.findLast(event=>event.type==='checkpoint')}),
  activate:async()=>{},
  rename:async(id,value)=>{assert.equal(id,'new');title=value;seq++},
 };
 const h=await assistantPanelHarness({ctx:{conversations,storage:{get:async()=>({provider:{apiKey:'test-key'}})},ai:{chatCompletion:async request=>{calls.push(request);return {choices:[{message:{role:'assistant',content:request.maxTokens===64?'知识库分类整理':'可以按照项目和主题整理笔记。'}}]}}}}});
 try{
  const form=h.find('ln-ai-compose'),input=h.all(h.root).find(n=>n.tagName==='textarea');input.value='帮我整理知识库';await form.listeners.submit({preventDefault(){}});
  assert.equal(calls.length,1);assert.equal(title,'帮我整理知识库');assert.equal(h.timers.size,1);
  await h.click('历史');const timer=[...h.timers][0];await timer();
  assert.equal(calls.length,2);assert.equal(title,'知识库分类整理');assert.equal(h.find('ln-ai-history-title').textContent,title);assert.equal(h.timers.size,0);
  await h.find('ln-ai-history-open').listeners.click();
  input.value='继续';await form.listeners.submit({preventDefault(){}});assert.equal(calls.length,3);assert.equal(h.timers.size,0);
 }finally{h.cleanup()}
});
