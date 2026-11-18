(function () {
  const seen = new Set(), pending = [];
  function flush() {
    const desktop = window.go?.main?.desktop;
    if (!desktop?.StartupMark) return;
    while (pending.length) { const item = pending.shift();Promise.resolve(desktop.StartupMark(item.name, item.ms)).catch(function () {}); }
  }
  window.LNStartup = { mark: function (name) {
    if (seen.has(name)) return;seen.add(name);
    const ms = performance.now();performance.mark(name);
    if (name !== 'frontend.entry') { try { performance.measure(name + '.elapsed', 'frontend.entry', name); } catch {} }
    pending.push({ name, ms });flush();
  } };
  window.LNStartup.mark('frontend.entry');
})();
