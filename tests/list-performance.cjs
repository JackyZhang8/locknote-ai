const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createModel, createQueue} = require('./runtime-helper.cjs');

test('30000 notes keep the rendered window bounded at top, middle and end', () => {
  const model = createModel(Array.from({length:30000},(_,i)=>({id:String(i),pinned:i<2})));
  for (const top of [0,2000000,model.total-600]) {
    const view = model.window(top,600);
    assert.ok(view.items.length < 20);
    assert.equal(view.before + view.items.reduce((n,item)=>n+item.height,0) + view.after, model.total);
  }
  assert.equal(model.window(0,600).items[0].kind,'group');
  assert.equal(model.window(model.total-600,600).items.at(-1).note.id,'29999');
});
test('keyboard positions account for both pinned and normal group headers', () => {
  const model = createModel([{id:'a',pinned:true},{id:'b',pinned:false}]);
  assert.equal(model.noteTop(0),32);
  assert.equal(model.noteTop(1),32+146+32);
  assert.equal(model.notes[1].id,'b');
  assert.equal(createModel([]).total,0);
});
test('event bursts merge and changes during refresh cause exactly one trailing pass', async () => {
  const tasks=[]; let calls=0, active=0, maxActive=0, finish;
  const queue=createQueue(()=>{calls++;active++;maxActive=Math.max(maxActive,active);return new Promise(r=>{finish=()=>{active--;r();};});},
    fn=>{tasks.push(fn);return tasks.length;},()=>{});
  for(let i=0;i<100;i++) queue();
  assert.equal(tasks.length,1);
  tasks.shift()(); assert.equal(calls,1);
  for(let i=0;i<100;i++) queue();
  finish(); await new Promise(setImmediate);
  assert.equal(tasks.length,1);
  tasks.shift()();assert.equal(calls,2);assert.equal(maxActive,1);
  finish();await new Promise(setImmediate);assert.equal(tasks.length,0);
});
