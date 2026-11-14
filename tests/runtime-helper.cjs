const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const moduleObject = {exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/src/runtime/list-performance.js'),'utf8'), {
 module: moduleObject, setTimeout, clearTimeout
});
module.exports=moduleObject.exports;
