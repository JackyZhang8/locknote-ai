/** @param {import('../../../sdk/plugin-api').PluginContext} ctx */
async function activate(ctx) {
  const tr = (key, params) => ctx.i18n.t(key, params);
  let snapshot = ctx.storage.snapshot ? await ctx.storage.snapshot() : null;
  let settings = snapshot ? snapshot.data : await ctx.storage.get();
  const refreshers = new Set();
  const refresh = () => { for (const render of refreshers) void render().catch(error => ctx.ui.notify(String(error))); };
  function mount(container) {
    let alive = true, generation = 0;
    container.classList.add('dev-outline');
    async function render() {
      const generationAtStart = ++generation;
      const note = await ctx.notes.current();
      if (!alive || generationAtStart !== generation) return;
      const title = document.createElement('h3');
      title.textContent = note?.title || tr('selectNote');
      const list = document.createElement('nav');
      list.setAttribute('aria-label', tr('headingsLabel'));
      let fence = null, count = 0;
      (note?.content || '').split('\n').forEach((line, index) => {
        const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
        if (marker) {
          if (!fence) fence = marker[1];
          else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
          return;
        }
        if (fence) return;
        const match = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
        if (!match || match[1].length > (Number(settings.maxLevel) || 6)) return;
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = match[2];
        button.style.paddingInlineStart = `${8 + (match[1].length - 1) * 12}px`;
        button.addEventListener('click', () => ctx.workspace.revealLine(index + 1));
        list.append(button); count++;
      });
      if (!count) list.textContent = tr('emptyOutline');
      container.replaceChildren(title, list);
    }
    refreshers.add(render);
    void render().catch(error => { if (alive) container.textContent = String(error); });
    return () => { alive = false; refreshers.delete(render); container.replaceChildren(); };
  }
  ctx.views.register({ id: 'outline-right', title: ctx.i18n.t('outlineTitle'), titleKey: 'outlineTitle', location: 'right', mount });
  ctx.commands.register({ id: 'open', title: ctx.i18n.t('openOutline'), titleKey: 'openOutline', hotkey: 'Mod+Alt+O', run: () => ctx.workspace.openView('outline-right') });
  ctx.toolbar.register({ id: 'outline', title: ctx.i18n.t('outlineButton'), titleKey: 'outlineButton', text: ctx.i18n.t('label.outline'), textKey: 'label.outline', run: () => ctx.workspace.toggleView('outline-right') });
  ctx.menus.register({ id: 'outline', title: ctx.i18n.t('outlineMenu'), titleKey: 'outlineMenu', context: 'editor', run: () => ctx.workspace.openView('outline-right') });
  ctx.settings.register({ id: 'preferences', title: ctx.i18n.t('outlineSettings'), titleKey: 'outlineSettings', mount(container) {
    const label = document.createElement('label');
    const caption = document.createElement('span');
    const renderCaption = () => { caption.textContent = tr('headingDepth'); };
    renderCaption(); label.append(caption);
    const stopLanguage = ctx.events.on('language:change', renderCaption);
    const select = document.createElement('select');
    for (let i = 1; i <= 6; i++) { const option = document.createElement('option'); option.value = String(i); option.textContent = String(i); select.append(option); }
    select.value = String(Number(settings.maxLevel) || 6);
    const changed = async () => {
      if (select.disabled) return;
      select.disabled = true;
      const candidate = { ...settings, maxLevel: Number(select.value) };
      try {
        if (snapshot) snapshot = await ctx.storage.compareAndSet(candidate, snapshot.revision);
        else await ctx.storage.set(candidate);
        settings = candidate;refresh();
      } catch (error) {
        ctx.ui.notify(String(error));
        if (ctx.storage.snapshot) { try { snapshot = await ctx.storage.snapshot();settings = snapshot.data; } catch {} }
        select.value = String(Number(settings.maxLevel) || 6);
      } finally { select.disabled = false; }
    };
    select.addEventListener('change', changed); label.append(select); container.append(label);
    return () => { stopLanguage(); select.removeEventListener('change', changed); container.replaceChildren(); };
  } });
  for (const event of ['note:selection', 'note:change', 'editor:change', 'language:change']) ctx.events.on(event, refresh);
}

export default { activate };
