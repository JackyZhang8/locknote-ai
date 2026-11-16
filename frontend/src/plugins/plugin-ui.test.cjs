const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const Module = require('node:module');
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
  });
  module._compile(outputText, filename);
};
require.extensions['.css'] = () => {};
const snapshot = {
  available: false, loading: false, directory: '', records: [], active: [], commands: [], views: [], openViews: [],
  toolbar: [], status: [], menus: [], settings: [], logs: [], errors: {}, safeMode: false,
};
const runtimeMock = { getSnapshot: () => snapshot, subscribe: () => () => {} };
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === '../history/diff.js') return originalLoad.call(this, '../history/diff.ts', parent, isMain);
  if (request === './runtime') return { pluginRuntime: runtimeMock };
  if (request === './note-changes.js') return originalLoad.call(this, './note-changes.ts', parent, isMain);
  if (request === './ui-text.js') return originalLoad.call(this, './ui-text.ts', parent, isMain);
  return originalLoad.call(this, request, parent, isMain);
};
const { PluginSettings, PluginConfiguration, PluginInstallDetails, installActionText, installPluginWithFeedback, PluginInstallSuccess, installSuccessText } = require('./PluginSettings.tsx');
const { PluginWorkspace, ViewDock, matchesPluginHotkey } = require('./PluginWorkspace.tsx');
Module._load = originalLoad;

test('browser settings explain desktop-only plugins and cannot execute or install code', () => {
  const html = renderToStaticMarkup(React.createElement(PluginSettings));
  assert.match(html, /浏览器界面不会加载第三方插件/);
  assert.match(html, /disabled=""/);
  assert.equal(renderToStaticMarkup(React.createElement(PluginWorkspace)), '');
});

test('plugin card exposes lifecycle actions while warning same-page code requires trust', () => {
  snapshot.available = true;
  snapshot.records = [{ enabled: false, installedAt: '', manifest: { id: 'example.outline', name: 'Outline', version: '0.1.0', author: 'Example', capabilities: ['ui.sidebar'], description: 'Outline view' } }];
  const html = renderToStaticMarkup(React.createElement(PluginSettings));
  assert.match(html, /Outline/);
  assert.match(html, /仅安装可信来源/);
  for (const label of ['启用', '设置', '查看日志', '卸载', '禁用全部插件']) assert.ok(html.includes(label));
  assert.doesNotMatch(html, /checked=""/);
  assert.match(html, /role="switch"/);
  assert.match(html, /aria-checked="false"/);
  assert.match(html, /plugin-toggle-track/);
  snapshot.available = false; snapshot.records = [];
});

test('plugin commands live in the header without a fixed bottom toolbar', () => {
  const source = fs.readFileSync(require.resolve('./PluginWorkspace.tsx'), 'utf8');
  const css = fs.readFileSync(require.resolve('./plugins.css'), 'utf8');
  assert.ok(source.includes('.top-right'));
  assert.ok(source.includes('createPortal(<div className="plugin-toolbar"'));
  const toolbarRule = css.match(/\.plugin-toolbar\s*\{([^}]+)\}/)[1];
  assert.doesNotMatch(toolbarRule, /position:\s*fixed|bottom:/);
});

test('plugin hotkeys match all modifiers exactly to avoid stealing unrelated shortcuts', () => {
  const event = { key: 'K', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true };
  assert.equal(matchesPluginHotkey(event, 'Ctrl+Shift+K'), true);
  assert.equal(matchesPluginHotkey(event, 'Ctrl+K'), false);
  assert.equal(matchesPluginHotkey({ ...event, altKey: true }, 'Ctrl+Shift+K'), false);
});

test('history comparison blocks plugin palette and plugin commands', () => {
  const source = fs.readFileSync(require.resolve('./PluginWorkspace.tsx'), 'utf8');
  const body = source.match(/const keydown = \(event: KeyboardEvent\) => \{([\s\S]*?)\n    \}\n    window.addEventListener\('keydown'/)[1];
  let calls = 0;
  const handler = new Function('window', 'state', 'setPalette', 'setQuery', 'pluginRuntime', 'matchesPluginHotkey', 'event', body);
  const event = { key: 'p', ctrlKey: true, shiftKey: true, preventDefault() {}, stopPropagation() {} };
  const state = { available: true, commands: [{ id: 'test', hotkey: 'Ctrl+Shift+P' }] };
  const run = open => handler({ LNHistory: { isOpen: () => open } }, state, () => calls++, () => {}, { runCommand() { calls++; return Promise.resolve(); } }, matchesPluginHotkey, event);
  run(true); assert.equal(calls, 0);
  run(false); assert.equal(calls, 1);
});

test('plugin management initialization failures are visible with recovery guidance', () => {
  snapshot.available = true;
  snapshot.errors = { host: 'Plugin state could not be read' };
  try {
    const html = renderToStaticMarkup(React.createElement(PluginSettings));
    assert.match(html, /role="alert"/);
    assert.match(html, /Plugin state could not be read/);
    assert.match(html, /-safe-plugins/);
  } finally { snapshot.available = false; snapshot.errors = {}; }
});


test('installation review explains identity, version and trust changes', () => {
  const existing = { manifest: { id: 'example.one', name: 'Outline', version: '0.1.0', author: 'Original', capabilities: ['notes.read'] }, digest: 'old' };
  const preview = { action: 'upgrade', digest: 'new', replaces: existing, manifest: { ...existing.manifest, version: '0.2.0', author: 'New author', capabilities: ['notes.read', 'notes.write'] } };
  let html = renderToStaticMarkup(React.createElement(PluginInstallDetails, { preview }));
  for (const text of ['0.1.0', '0.2.0', 'example.one', 'notes.write', 'Original', 'New author']) assert.ok(html.includes(text));
  assert.match(html, /升级/);
  html = renderToStaticMarkup(React.createElement(PluginInstallDetails, { preview: { ...preview, action: 'downgrade' } }));
  assert.match(html, /降级/);
  assert.match(html, /配置/);
  html = renderToStaticMarkup(React.createElement(PluginInstallDetails, { preview: { ...preview, action: 'install', replaces: undefined, sameName: [existing] } }));
  assert.match(html, /ID 不同/);
  assert.match(html, /不会覆盖/);
  assert.match(installActionText('replace'), /替换/);
  assert.match(installActionText('identical'), /已安装/);
});

test('custom settings default to immediate mode without a stale JSON save action',()=>{
 snapshot.available=true;snapshot.settings=[{id:'example:preferences',pluginId:'example',title:'Preferences'}];
 try{
  const html=renderToStaticMarkup(React.createElement(PluginConfiguration,{id:'example',onClose(){}}));
  assert.match(html,/立即生效/);assert.match(html,/高级 JSON/);assert.doesNotMatch(html,/<textarea/);assert.doesNotMatch(html,/>保存</);
 }finally{snapshot.settings=[];snapshot.available=false}
});

test('plugin page header reuses general settings typography and section spacing', () => {
  const html = renderToStaticMarkup(React.createElement(PluginSettings));
  assert.match(html, /class="plugin-settings-head set-section"/);
  assert.ok(html.includes('<h3>插件</h3><p class="set-hint">'));
  const css = fs.readFileSync(require.resolve('./plugins.css'), 'utf8');
  assert.doesNotMatch(css, /\.plugin-settings h3\s*\{/);
  assert.doesNotMatch(css, /\.plugin-settings p\s*,/);
});

test('installation completion reports install and upgrade with plugin version and enable status',async()=>{
 const manifest={id:'example.test',name:'Example',version:'0.1.1'};
 runtimeMock.install=async()=>({manifest,enabled:false});
 runtimeMock.setEnabled=async()=>{};
 for(const action of ['install','upgrade','replace','downgrade']){
  const result=await installPluginWithFeedback({}, {manifest,action}, false);
  const html=renderToStaticMarkup(React.createElement(PluginInstallSuccess,{result,onClose(){}}));
  assert.match(html,/Example/);assert.match(html,/0.1.1/);assert.match(html,/尚未启用/);assert.match(html,/确定/);
  assert.match(installSuccessText(action),action==='upgrade'?/升级成功/:action==='replace'?/替换成功/:action==='downgrade'?/降级成功/:/安装成功/);
 }
 const result=await installPluginWithFeedback({}, {manifest,action:'upgrade'}, true);
 assert.equal(result.enabled,true);
 runtimeMock.setEnabled=async()=>{throw new Error('enable failed')};
 const partial=await installPluginWithFeedback({}, {manifest,action:'upgrade'}, true);
 assert.equal(partial.error,'enable failed');
 assert.equal(partial.enabled,false);
 runtimeMock.install=async()=>{throw new Error('install failed')};
 await assert.rejects(()=>installPluginWithFeedback({}, {manifest,action:'install'}, false),/install failed/);
});

test('navigation rail reserves room for four Chinese characters in every layout',()=>{
 const css=fs.readFileSync(require.resolve('../styles.css'),'utf8');
 const plugins=fs.readFileSync(require.resolve('./plugins.css'),'utf8');
 assert.match(css,/--rail-width:\s*76px/);
 for(const rule of css.matchAll(/grid-template-columns:\s*([^;]+);/g)){
  if(/^(54|58|64|72)px /.test(rule[1]))assert.fail('workspace rail still uses a narrow fixed width: '+rule[1]);
 }
 assert.match(css,/width:\s*62px;\s*min-height:\s*52px/);
 assert.match(plugins,/\.plugin-rail-launchers\s*\{[^}]*width:\s*100%/);
});


test('dock renders the runtime-selected existing tab and returns to the note tab', () => {
 const views = ['first','second'].map(id => ({ id, title: id, pluginId: 'p', location: 'main', open: true, mount() {} }))
 snapshot.activeViews = { main: 'second' }
 const render = () => renderToStaticMarkup(React.createElement(ViewDock, { location: 'main', views, size: 0, onResize() {} }))
 let html = render()
 assert.match(html, /aria-selected="true">second/)
 assert.match(html, /aria-selected="false">first/)
 snapshot.activeViews = { main: 'first' };html = render()
 assert.match(html, /aria-selected="true">first/)
 snapshot.activeViews = { main: '__note__' };html = render()
 assert.match(html, /aria-selected="true">笔记/)
 assert.match(html, /plugin-note-selected/)
 snapshot.activeViews = {}
})
