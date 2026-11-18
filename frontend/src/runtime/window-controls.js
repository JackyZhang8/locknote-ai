/* Desktop window gestures; browser pages keep their normal behavior. */
(function () {
  'use strict';
  // ResizeObserver runs before paint. Running here avoids adding a second
  // requestAnimationFrame delay after the new viewport has already appeared.
  window.LNWindowControls = {
    syncDesktopLayout: function () {
      var desktop = !!window.runtime;
      var navigator = window.navigator || {};
      var platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
      document.documentElement.classList.toggle('desktop', desktop);
      document.documentElement.classList.toggle('desktop-macos', desktop && /^Mac/i.test(platform));
    },
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
