/* Remembered pane widths and accessible pointer/keyboard resizing. */
export function startWorkspaceControls() {
  'use strict';
  function start() {
    var workspace = document.getElementById('workspace');
    var widths = { library: 206, list: 320 };
    try { var saved = JSON.parse(localStorage.getItem('locknote-pane-widths') || '{}'); Object.keys(widths).forEach(function (key) { if (Number.isFinite(saved[key])) widths[key] = saved[key]; }); } catch (err) {}
    function apply() {
      widths.library = Math.max(150, Math.min(360, widths.library));
      widths.list = Math.max(220, Math.min(520, widths.list));
      workspace.style.setProperty('--library-width', widths.library + 'px');
      workspace.style.setProperty('--list-width', widths.list + 'px');
    }
    function save() { try { localStorage.setItem('locknote-pane-widths', JSON.stringify(widths)); } catch (err) {} }
    ['library', 'list'].forEach(function (key) {
      var pane = workspace.querySelector('.' + key);
      var handle = document.createElement('div'); handle.className = 'pane-resizer'; handle.tabIndex = 0;
      handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', 'vertical'); handle.setAttribute('aria-label', key === 'library' ? '调整分类栏宽度' : '调整笔记列表宽度');
      handle.addEventListener('pointerdown', function (event) {
        event.preventDefault(); handle.setPointerCapture(event.pointerId);
        var x = event.clientX, width = widths[key];
        function move(e) { widths[key] = width + e.clientX - x; apply(); }
        function end() { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); save(); }
        handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
      });
      handle.addEventListener('keydown', function (event) { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); widths[key] += event.key === 'ArrowRight' ? 10 : -10; apply(); save(); } });
      pane.appendChild(handle);
    });
    apply();
  }
  start();
}
