/* Desktop window gestures; browser pages keep their normal behavior. */
(function () {
  'use strict';
  // ResizeObserver runs before paint. Running here avoids adding a second
  // requestAnimationFrame delay after the new viewport has already appeared.
  window.LNWindowControls = {
    observeViewport: function (element, sync) {
      window.addEventListener('resize', sync);
      if (window.ResizeObserver) {
        var observer = new window.ResizeObserver(sync);
        observer.observe(element);
      }
    }
  };

  document.addEventListener('dblclick', function (event) {
    if (!event.target.closest('.titlebar-strip')) return;
    if (event.target.closest('button, a, input, select, textarea, [contenteditable]')) return;
    if (!window.runtime || typeof window.runtime.WindowToggleMaximise !== 'function') return;
    event.preventDefault();
    window.runtime.WindowToggleMaximise();
  });
})();
