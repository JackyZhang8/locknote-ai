/* Offline Mermaid rendering with isolated diagram output. */
(function () {
  'use strict';
  var library, sequence = 0;
  function en() { return window.LNI18N && window.LNI18N.lang === 'en-US'; }
  function load() {
    if (!library) library = import('/vendor/mermaid/mermaid.min.js').then(function (module) {
      module.default.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme: 'neutral', fontFamily: 'system-ui, sans-serif', flowchart: { htmlLabels: false, useMaxWidth: false } });
      return module.default;
    });
    return library;
  }
  function display(output, svg) {
    var frame = document.createElement('iframe');
    frame.setAttribute('sandbox', '');
    frame.setAttribute('title', en() ? 'Diagram preview' : '图形预览');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.className = 'diagram-frame';
    var policy = "default-src 'none'; style-src 'unsafe-inline'; img-src data:;";
    frame.srcdoc = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="' + policy + '"><style>body{margin:0;padding:12px}svg{display:block;margin:auto;max-width:none}a{pointer-events:none}</style></head><body>' + svg + '</body></html>';
    output.replaceChildren(frame);
  }
  function render(block) {
    if (block.dataset.rendering) return;
    block.dataset.rendering = 'true';
    var source = block.querySelector('.diagram-source code').textContent;
    var output = block.querySelector('.diagram-output');
    if (block.dataset.diagram === 'svg') {
      var safe = window.LNSVG.sanitize(source);
      if (safe) display(output, safe);
      else output.textContent = en() ? 'Invalid SVG. Check the source.' : 'SVG 无效，请检查源码。';
      return;
    }
    if (source.length > 50000) { output.textContent = en() ? 'Diagram is too large.' : '图形源码过长。'; return; }
    if (block.dataset.diagram === 'flowchart' && !/^\s*(flowchart|graph)\b/.test(source)) source = 'flowchart ' + (block.dataset.direction || 'TD').toUpperCase() + String.fromCharCode(10) + source;
    load().then(function (mermaid) {
      if (!block.isConnected) return;
      var container = document.createElement('div');
      container.style.cssText = 'position:fixed;left:-100000px;top:0;opacity:0;pointer-events:none';
      document.body.appendChild(container);
      return mermaid.render('locknote-diagram-' + (++sequence), source, container).then(function (result) {
        if (block.isConnected) display(output, result.svg);
      }).finally(function () { container.remove(); });
    }).catch(function () {
      if (block.isConnected) output.textContent = en() ? 'Unable to render. Check the diagram source.' : '绘制失败，请切换到源码检查流程图语法。';
    });
  }
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-diagram-mode]');
    if (!button) return;
    var block = button.closest('[data-diagram]');
    if (!block) return;
    var source = button.dataset.diagramMode === 'source';
    block.querySelector('.diagram-output').classList.toggle('hidden', source);
    block.querySelector('.diagram-source').classList.toggle('hidden', !source);
    Array.prototype.forEach.call(block.querySelectorAll('[data-diagram-mode]'), function (tab) { tab.setAttribute('aria-pressed', String(tab === button)); });
  });
  window.LNDiagrams = { render: function (root) { Array.prototype.forEach.call(root.querySelectorAll('[data-diagram]'), render); } };
})();
