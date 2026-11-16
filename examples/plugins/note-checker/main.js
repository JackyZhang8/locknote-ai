/** @param {import('../../../sdk/plugin-api').PluginContext} ctx */
async function activate(ctx) {
  const tr = (key, params) => ctx.i18n.t(key, params);
  async function check(content, signal) {
    // WebView worker support varies; keep a bounded fallback for small notes.
    if (content.length > 500000) throw new Error(tr('sizeLimit'));
    if (typeof Worker === 'undefined') return fallback(content);
    let worker;
    try { worker = new Worker(ctx.resources.assetURL('assets/checker-worker.js'), { type: 'module' }); }
    catch { return fallback(content); }
    return new Promise(resolve => {
      let done = false;
      const finish = result => { if (done) return; done = true; signal.removeEventListener('abort', cancel); clearTimeout(timer); worker.terminate(); dispose(); resolve(result); };
      const cancel = () => finish({ issues: [], cancelled: true });
      signal.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(() => finish(fallback(content)), 2000);
      const dispose = ctx.onDispose(() => finish({ issues: [], cancelled: true }));
      worker.onmessage = event => finish(event.data);
      worker.onerror = () => finish(fallback(content));
      worker.postMessage(content);
    });
  }
  function fallback(content) {
    const issues = [];
    content.split('\n').forEach((line, i) => {
      if (issues.length >= 200) return;
      if (/[\t ]+$/.test(line)) issues.push({ line: i + 1, key: 'trailingWhitespace' });
      if (issues.length < 200 && /\b(TODO|FIXME)\b/.test(line)) issues.push({ line: i + 1, key: 'todoMarker' });
    });
    return { issues };
  }
  function mount(container) {
    let alive = true, generation = 0, pending = null;
    container.classList.add('dev-note-checker');
    async function render() {
      const ticket = ++generation;
      if (pending) pending.abort();
      pending = new AbortController();
      const signal = pending.signal;
      const note = await ctx.notes.current();
      if (!alive || ticket !== generation) return;
      const heading = document.createElement('h3'); heading.textContent = note?.title || tr('selectNote');
      container.replaceChildren(heading);
      if (!note) return;
      const result = await check(note.content || '', signal);
      if (!alive || ticket !== generation || result.cancelled) return;
      const count = document.createElement('p'); count.textContent = tr('issues', { count: result.issues.length });
      const list = document.createElement('div');
      for (const issue of result.issues) {
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = `${issue.line}: ${tr(issue.key)}`;
        button.addEventListener('click', () => ctx.workspace.revealLine(issue.line)); list.append(button);
      }
      const rerun = document.createElement('button'); rerun.type = 'button'; rerun.textContent = tr('checkAgain');
      rerun.addEventListener('click', () => void render().catch(error => ctx.ui.notify(String(error))));
      container.replaceChildren(heading, count, list, rerun);
    }
    const refresh = () => render().catch(error => { if (alive) container.textContent = String(error); });
    // Refresh on selection/save, not every keystroke, to avoid spawning workers for typing.
    const stopSelect = ctx.events.on('note:selection', refresh);
    const stopChange = ctx.events.on('note:change', refresh);
    const stopLanguage = ctx.events.on('language:change', refresh);
    void refresh();
    return () => { alive = false; generation++; if (pending) pending.abort(); stopSelect(); stopChange(); stopLanguage(); container.replaceChildren(); };
  }
  async function trim() {
    const note = await ctx.notes.current();
    if (!note) return ctx.ui.notify(tr('selectNoteFirst'));
    if (note.unsaved) return ctx.ui.notify(tr('saveEditsFirst'));
    const content = (note.content || '').replace(/[\t ]+$/gm, '');
    if (content === note.content) return ctx.ui.notify(tr('nothingToChange'));
    if (!await ctx.ui.confirm(tr('confirmTrim'))) return;
    await ctx.notes.update(note.id, { content, expectedVersion: note.version });
    ctx.ui.notify(tr('trimmed'));
  }
  ctx.views.register({ id: 'checker', title: ctx.i18n.t('checkerTitle'), titleKey: 'checkerTitle', location: 'bottom', mount });
  ctx.views.register({ id: 'report', title: ctx.i18n.t('reportTitle'), titleKey: 'reportTitle', location: 'main', showInNavigation: false, mount });
  ctx.commands.register({ id: 'open', title: ctx.i18n.t('openChecker'), titleKey: 'openChecker', hotkey: 'Mod+Alt+L', run: () => ctx.workspace.openView('checker') });
  ctx.commands.register({ id: 'report', title: ctx.i18n.t('openReport'), titleKey: 'openReport', run: () => ctx.workspace.openView('report') });
  ctx.commands.register({ id: 'trim', title: ctx.i18n.t('trimCommand'), titleKey: 'trimCommand', run: trim });
  ctx.toolbar.register({ id: 'check', title: ctx.i18n.t('checkerTitle'), titleKey: 'checkerTitle', text: ctx.i18n.t('label.check'), textKey: 'label.check', run: () => ctx.workspace.toggleView('checker') });
  ctx.status.register({ id: 'ready', title: ctx.i18n.t('checkerStatus'), titleKey: 'checkerStatus', text: ctx.i18n.t('label.ready'), textKey: 'label.ready', run: () => ctx.workspace.openView('checker') });
  ctx.menus.register({ id: 'trim', title: ctx.i18n.t('trimMenu'), titleKey: 'trimMenu', context: 'note', run: trim });
}

export default { activate };
