const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

// Run the real component and its layout effects without a browser. Geometry is
// deterministic so late measurements can be exercised independently of timing.
function mount(initial) {
  const hooks = [], effects = [];
  let cursor = 0, pending = false, tree, props = initial, naturalHeight = 28;
  const panes = [0, 1].map(() => ({ scrollTop: 0, scrollLeft: 0 }));
  const frames = new Map();
  let nextFrame = 0;
  function changed(before, after) { return !before || after.some((value, i) => value !== before[i]); }
  const React = {
    useRef(value) { const id = cursor++; return hooks[id] ||= { current: value }; },
    useState(value) { const id = cursor++; if (!(id in hooks)) hooks[id] = value; return [hooks[id], value => { const next = typeof value === 'function' ? value(hooks[id]) : value; if (!Object.is(next, hooks[id])) { hooks[id] = next; pending = true; } }]; },
    useMemo(fn, deps) { const id = cursor++; if (!hooks[id] || changed(hooks[id].deps, deps)) hooks[id] = { value: fn(), deps }; return hooks[id].value; },
    useEffect() { cursor++; },
    useLayoutEffect(fn, deps) { const id = cursor++; if (!hooks[id] || changed(hooks[id].deps, deps)) { const previous = hooks[id]; hooks[id] = { deps }; effects.push(() => { previous?.cleanup?.(); hooks[id].cleanup = fn(); }); } },
  };
  const walk = (node, visit) => { if (!node || typeof node !== 'object') return; visit(node); for (const child of [node.props?.children].flat(Infinity)) walk(child, visit); };
  const root = { querySelectorAll() { const nodes = []; walk(tree, node => { if (node.props?.['data-natural']) nodes.push({ dataset: { row: node.props['data-row'], side: node.props['data-side'] }, getBoundingClientRect: () => ({ height: naturalHeight }) }); }); return nodes; } };
  const modules = new Map();
  function load(filename) {
    const absolute = path.resolve(__dirname, filename);
    if (modules.has(absolute)) return modules.get(absolute).exports;
    const module = { exports: {} }; modules.set(absolute, module);
    const source = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(source, { module, exports: module.exports, require(name) {
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime') return require(name);
      if (name.includes('ui-text')) return { t: value => value };
      return load(name + '.ts');
    }, ResizeObserver: class { observe() {} disconnect() {} }, requestAnimationFrame(fn) { const id = ++nextFrame; frames.set(id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); } }, { filename: absolute });
    return module.exports;
  }
  const { ComparePanes } = load('ComparePanes.tsx');
  function render() {
    let count = 0;
    do {
      assert.ok(++count < 40, 'layout effects must converge');
      pending = false; cursor = 0; tree = ComparePanes(props);
      tree.ref.current = root;
      let index = 0;
      walk(tree, node => { if (node.props?.className === 'history-scroll') node.ref.current = panes[index++]; });
      for (const effect of effects.splice(0)) effect();
      const tasks = [...frames.values()]; frames.clear(); for (const task of tasks) task();
    } while (pending);
  }
  render();
  return { panes, update(value) { props = { ...props, ...value }; render(); }, measure(height) { naturalHeight = height; props = { ...props, wrap: !props.wrap }; render(); }, scroll(top) { panes[0].scrollTop = top; let scroll; walk(tree, node => { if (!scroll && node.props?.className === 'history-scroll') scroll = node.props.onScroll; }); scroll(); render(); }, selectedTop() { let top = null; walk(tree, node => { if (node.props?.['data-change']) { const natural = node.props.children; if (natural.props['data-side'] === 0) { const id = natural.props['data-row']; const offsets = hooks.find(item => item?.value?.length === props.rows.length + 1)?.value; top = offsets[props.rows.findIndex(row => row.id === id)]; } } }); return top; } };
}
const rows = Array.from({ length: 2000 }, (_, id) => ({ id, left: 'old ' + id, right: 'new ' + id, oldLine: id + 1, newLine: id + 1, kind: id === 900 ? 'change' : 'same' }));
const defaults = { rows, unified: false, sync: true, wrap: true, target: -1, navigationKey: 0, onExpand() {} };
test('repeated request for the same change navigates again after manual scrolling', () => {
  const view = mount(defaults);
  view.update({ target: 900, navigationKey: 1 });
  const destination = view.panes[0].scrollTop;
  assert.ok(destination > 0);
  view.scroll(destination + 1200);
  view.update({ target: 900, navigationKey: 2 });
  assert.equal(view.panes[0].scrollTop, destination);
});
test('late wrapped measurements keep navigation target within the viewport', () => {
  const view = mount(defaults);
  view.measure(268);
  view.update({ target: 900, navigationKey: 1 });
  const top = view.selectedTop();
  assert.ok(top !== null);
  assert.ok(top - view.panes[0].scrollTop >= 0 && top - view.panes[0].scrollTop < 600);
  assert.equal(view.panes[0].scrollTop, view.panes[1].scrollTop);
});
test('folding and expanding keep the visible logical row', () => {
  const view = mount(defaults);
  view.scroll(900 * 28 + 12);
  view.update({ rows: [{ ...rows[0], folded: 850 }, ...rows.slice(850)] });
  assert.equal(view.panes[0].scrollTop, 51 * 28 + 12);
  view.update({ rows });
  assert.equal(view.panes[0].scrollTop, 900 * 28 + 12);
});
test('manual reading position survives measured wrap and mode changes', () => {
  const view = mount(defaults);
  view.scroll(900 * 28 + 12);
  view.measure(148);
  view.measure(268);
  const position = view.panes[0].scrollTop;
  view.update({ unified: true });
  view.update({ unified: false });
  assert.equal(view.panes[0].scrollTop, position);
  assert.equal(view.panes[1].scrollTop, position);
});
