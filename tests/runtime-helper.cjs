const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/src/runtime/list-performance.js'),'utf8'), {
 window, setTimeout, clearTimeout
});
module.exports=window.LNListPerformance;
