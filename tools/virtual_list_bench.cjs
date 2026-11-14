// Model/window benchmark; does not measure browser layout or database queries.
// Run: node tools/virtual_list_bench.cjs
const { performance } = require('node:perf_hooks');
const { createModel } = require('../tests/runtime-helper.cjs');
for (const count of [1000,10000,30000]) {
  const notes=Array.from({length:count},(_,i)=>({id:String(i),pinned:i<3}));
  const start=performance.now();
  const model=createModel(notes);
  const built=performance.now();
  let maxItems=0;
  for(let i=0;i<10000;i++) {
    const view=model.window((model.total-600)*i/9999,600);
    maxItems=Math.max(maxItems,view.items.length);
  }
  console.log(JSON.stringify({notes:count,modelMs:+(built-start).toFixed(2),
    windows:10000,windowMs:+(performance.now()-built).toFixed(2),maxRenderedItems:maxItems}));
}
