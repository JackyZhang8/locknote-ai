const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const fs = require('node:fs');

test('production bundle exposes the virtual list model to the workspace', async () => {
  const { build } = await import('vite');
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [{
      name: 'runtime-test-entry',
      resolveId(id) { if (id === 'virtual:runtime-test') return id; },
      load(id) { if (id === 'virtual:runtime-test') return `import React from ${JSON.stringify(require.resolve('react'))}; window.TestReact = React; import ${JSON.stringify(path.join(__dirname, 'runtime/list-performance.js'))};`; },
    }],
    build: {
      write: false,
      rollupOptions: { input: 'virtual:runtime-test', output: { format: 'iife' } },
    },
  });
  const window = {};
  vm.runInNewContext((Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk').code, { window, setTimeout });
  assert.equal(typeof window.LNListPerformance?.createModel, 'function');
  assert.equal(window.LNListPerformance.createModel([]).total, 0);
  assert.equal(typeof window.LNListPerformance.createQueue, 'function');
});

// Vite can wrap the combined entry in a CommonJS shim when legacy code assigns
// module.exports. Browser globals must still be installed inside that wrapper.
test('browser runtime registers even when a bundler provides module.exports', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'runtime/list-performance.js'), 'utf8'), {
    window, module: { exports: {} }, setTimeout,
  });
  assert.equal(typeof window.LNListPerformance?.createModel, 'function');
});
