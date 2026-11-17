const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const titles=()=>import(pathToFileURL(path.resolve('examples/plugins/ai-assistant/conversation-title.js')).href);
async function fixture(){
 const {createConversationTitles}=await titles();
 let callback,current='one';const calls=[],saved=[],updated=[];
 const service=createConversationTitles({
  defer(fn,delay){assert.equal(delay,3000);callback=fn;return()=>{callback=null}},
  isCurrent:id=>id===current,
  request:async(input,options)=>{calls.push({input,options});return {choices:[{message:{content:'“笔记整理与知识管理”'}}]}},
  save:async(id,title)=>saved.push({id,title}),
  onSaved:(id,title)=>updated.push({id,title}),
 });
 return {service,calls,saved,updated,fire:()=>callback?.(),switchTo:id=>{current=id},get callback(){return callback}};
}
test('titles wait until idle and send only bounded opening text without tools or note context',async()=>{
 const f=await fixture();f.service.track('one');
 f.service.schedule({id:'one',provider:{baseURL:'https://example.com',model:'model',apiKey:'secret'},locale:'zh',messages:[{role:'user',content:'整理笔记'.repeat(1000)},{role:'assistant',content:'好的'.repeat(1000)},{role:'user',content:'NEVER_SEND_LATER_TURN'}]});
 assert.equal(f.calls.length,0);await f.fire();
 assert.equal(f.calls.length,1);const request=f.calls[0].input;
 assert.ok(request.maxTokens<=64);assert.equal(request.tools,undefined);
 assert.ok(request.messages[1].content.length<=1000);assert.ok(!JSON.stringify(request.messages).includes('NEVER_SEND_LATER_TURN'));
 assert.match(request.messages[0].content,/6.{0,3}12/);
 assert.deepEqual(f.saved,[{id:'one',title:'笔记整理与知识管理'}]);
 f.service.schedule({id:'one',provider:{},messages:[{role:'user',content:'Again'},{role:'assistant',content:'OK'}]});
 assert.equal(f.callback,null);f.service.dispose();
});
test('cancelled and late title responses never rename another or deleted conversation',async()=>{
 const {createConversationTitles}=await titles();let fire,resolve,signal;const saved=[];
 const service=createConversationTitles({defer:fn=>{fire=fn;return()=>{}},isCurrent:()=>true,request:(_,options)=>{signal=options.signal;return new Promise(r=>{resolve=r})},save:async(...args)=>saved.push(args)});
 service.track('one');service.schedule({id:'one',provider:{},messages:[{role:'user',content:'Hi'},{role:'assistant',content:'Hello'}]});
 const pending=fire();service.cancel();assert.equal(signal.aborted,true);resolve({choices:[{message:{content:'Late title'}}]});await pending;assert.equal(saved.length,0);
 service.schedule({id:'one',provider:{},messages:[{role:'user',content:'Hi'},{role:'assistant',content:'Hello'}]});service.forget('one');await fire();assert.equal(saved.length,0);service.dispose();
});
test('title failures retain fallback and retry only after a later successful turn',async()=>{
 const {createConversationTitles}=await titles();let fire,attempts=0;const saved=[];
 const service=createConversationTitles({defer:fn=>{fire=fn;return()=>{}},isCurrent:()=>true,request:async()=>{attempts++;throw Error('offline')},save:async(...args)=>saved.push(args)});
 service.track('one');const input={id:'one',provider:{},locale:'en',messages:[{role:'user',content:'Hi'},{role:'assistant',content:'Hello'}]};
 service.schedule(input);await assert.doesNotReject(()=>fire());assert.equal(attempts,1);assert.equal(saved.length,0);
 service.schedule(input);await fire();assert.equal(attempts,2);service.dispose();
});
test('title normalization rejects empty and multiline prose and bounds Unicode titles',async()=>{
 const {normalizeConversationTitle}=await titles();
 assert.equal(normalizeConversationTitle('  “整理本地笔记”  ','zh'),'整理本地笔记');
 assert.equal(normalizeConversationTitle('First line\nExplanation','en'),'');
 assert.equal(normalizeConversationTitle('   ','zh'),'');
 assert.ok(Array.from(normalizeConversationTitle('😀'.repeat(50),'zh')).length<=16);
 assert.equal(normalizeConversationTitle('One two three four five six seven eight','en'),'One two three four five six');
});
test('journal serializes a background rename before the next append',async()=>{
 const {createJournal}=await import(pathToFileURL(path.resolve('examples/plugins/ai-assistant/journal.js')).href);
 let seq=1,title='Fallback',release,started;const began=new Promise(r=>{started=r});
 const journal=createJournal({list:async()=>({activeId:'one'}),activate:async()=>{},read:async()=>({id:'one',seq,title,before:0,events:[]}),rename:async(id,value)=>{started();await new Promise(r=>{release=r});title=value;seq++},append:async(id,expected)=>{assert.equal(expected,seq);return {id,seq:++seq,title}}});
 await journal.initialize();const rename=journal.rename('one','Generated');await began;
 const append=journal.append({type:'turn_start'});release();await Promise.all([rename,append]);assert.equal(journal.current.seq,3);assert.equal(journal.current.title,'Generated');
});
