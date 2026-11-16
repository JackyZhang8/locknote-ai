const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Load the actual TSX components without introducing another test framework.
require.extensions['.tsx'] = function (module, filename) {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  module._compile(outputText, filename);
};

// The plugin extension roots have their own lifecycle tests. Keep this contract
// focused on the unchanged native workspace and explicitly allow only its new
// settings entry/container. No original element or attribute may disappear.
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request.endsWith('/history/HistoryWindow')) return { HistoryWindow: () => null };
  if (request.endsWith('/plugins/PluginSettings')) return { PluginSettings: () => null };
  if (request.endsWith('/plugins/PluginWorkspace')) return { PluginWorkspace: () => null };
  return originalLoad.call(this, request, parent, isMain);
};
const App = require('../App.tsx').default;
Module._load = originalLoad;
const contract = require('./shell-manifest.json');
const manifest = contract.filter(node => node.tag !== 'body');

function decode(text) {
  return text.replace(/&(amp|quot|lt|gt|#x27|#39|#xA|#10);/gi, (_, value) => ({
    amp: '&', quot: '"', lt: '<', gt: '>', '#x27': "'", '#39': "'",
    '#xa': '\n', '#10': '\n',
  })[value.toLowerCase()]);
}

function normalize(key, value) {
  return key === 'style' ? value.replace(/:\s+/g, ':') : value;
}

function elements(html) {
  return Array.from(html.matchAll(/<([a-zA-Z][\w-]*)(\s[^>]*?)?\s*\/?\s*>/g), match => {
    const attrs = {};
    for (const attr of (match[2] || '').matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) {
      attrs[attr[1].toLowerCase()] = normalize(attr[1].toLowerCase(), decode(attr[2] || ''));
    }
    return { tag: match[1].toLowerCase(), attrs };
  });
}

test('React shell preserves every original element, identifier, class and attribute', () => {
  let started = false;
  const rendered = renderToStaticMarkup(React.createElement(App, { onReady() { started = true; } }));
  assert.match(rendered, /data-plugin-shell="settings-tab" data-settings-tab="plugins"/);
  assert.match(rendered, /data-panel="plugins" data-plugin-shell="settings-panel"/);
  const originalShell = rendered
    .replace(/<button data-plugin-shell="settings-tab" data-settings-tab="plugins">[\s\S]*?<\/button>/, '')
    .replace(/<div class="settings-panel hidden" data-panel="plugins" data-plugin-shell="settings-panel"><\/div>/, '');
  const actual = elements(originalShell);
  const expected = manifest.map(node => ({
    tag: node.tag,
    attrs: Object.fromEntries(Object.entries(node.attrs).map(([key, value]) => [
      key.toLowerCase(), normalize(key.toLowerCase(), value == null ? '' : value),
    ])),
  }));
  assert.deepEqual(actual, expected);
  assert.equal(decode(originalShell.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim(), contract[0].text);
  assert.equal(started, false, 'controllers must wait for a client-side DOM commit');
  assert.equal(new Set(actual.filter(node => node.attrs.id).map(node => node.attrs.id)).size, 171);
});
