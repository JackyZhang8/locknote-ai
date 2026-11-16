import { createAssistant, normalizeProvider } from './engine.js';
import { captureMessageAnchor, restoreMessageAnchor } from './scroll-anchor.js';
import { createChangeHints } from './change-hints.js';
import { createJournal } from './journal.js';
import { validateProvider, mountProviderForm } from './provider.js';

/** @param {import('../../../sdk/plugin-api').PluginContext} ctx */
async function activate(ctx) {
  const tr = (zh, en) => ctx.i18n.locale.startsWith('zh') ? zh : en;
  let stored = await ctx.storage.get(), config = normalizeProvider(stored.provider || {});
  let messages = [], active = null, pendingChange = null, status = '', failure = '', notice = '', usage = null, includeCurrentNote = true, disposed = false;
  const journal = ctx.conversations ? createJournal(ctx.conversations) : null;
  let historyBusy = false, generation = 0, recoveryFailed = false;
  const changeHints = createChangeHints();
  const renders = new Set();
  const refresh = () => { for (const render of renders) render(); };
  const el = (tag, text, className) => { const node = document.createElement(tag);if (text !== undefined) node.textContent = text;if (className) node.className = className;return node; };
  function button(text, run, className = '') { const node = el('button', text, className);node.type = 'button';node.addEventListener('click', run);return node; }
  function settleChange(approved) { if (pendingChange) { const change = pendingChange;pendingChange = null;change.finish(approved);refresh(); } }
  const assistant = createAssistant(ctx, {
    onJournal: event => journal ? journal.append(event) : Promise.resolve(),
    onMessage(content) { messages.push({ role: 'assistant', content });refresh(); },
    onUsage(value) { usage = value;refresh(); },
    onStatus(value) { if (value.type === 'compacted') notice = tr('较早的对话已压缩为片段，最近多轮保留。', 'Older turns compacted to excerpts; recent turns retained.');if (value.type === 'provider-changed') notice = tr('Provider / 模型已变化，已开始新的模型会话。', 'Provider/model changed; model history reset.');status = value.type === 'review' ? tr('建议稿已生成，等待应用，尚未保存到笔记。', 'Draft generated; awaiting application, not yet saved to the note.') : value.type === 'tool' ? tr('正在处理笔记：', 'Working with notes: ') + value.name : value.type === 'request' ? tr('AI 正在思考…', 'Thinking…') : '';refresh(); },
    confirmChange(change, signal) {
      return new Promise(resolve => {
        const abort = () => settleChange(false);
        pendingChange = { ...change, finish(value) { signal?.removeEventListener('abort', abort);resolve(value); } };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) settleChange(false);
        refresh();
      });
    },
  });
  function applyHistory(loaded) {
    recoveryFailed = true;
    assistant.clear();if (loaded.checkpoint) assistant.restore(loaded.checkpoint.state, loaded.checkpoint.interrupted);
    recoveryFailed = false;
    messages = loaded.messages;generation++;usage = loaded.checkpoint?.state?.usage || null;
    notice = loaded.interrupted || loaded.recovered ? tr('上次会话中断，已恢复记录。未完成操作不会自动执行。', 'Previous session interrupted. History restored; unfinished actions will not run automatically.') : '';
  }
  if (journal) { try { applyHistory(await journal.initialize()); } catch (error) { recoveryFailed = true;failure = tr('聊天恢复失败：', 'Chat recovery failed: ') + String(error.message || error); } }
  function stop() { active?.abort();settleChange(false); }
  function mountProvider(container) {
    return mountProviderForm(container, { ctx, config, tr, el, button, onSave(provider) { config = provider; } });
  }
  function mount(container) {
    container.classList.add('ln-ai-assistant');
    const root = el('section', undefined, 'ln-ai-root'), header = el('div', undefined, 'ln-ai-actions ln-ai-header');
    const settings = el('div', undefined, 'ln-ai-settings'), log = el('div', undefined, 'ln-ai-messages'), info = el('p', '', 'ln-ai-status'), error = el('p', '', 'ln-ai-error'), proposal = el('div', undefined, 'ln-ai-proposal');
    log.setAttribute('role', 'log');log.setAttribute('aria-live', 'polite');
    error.setAttribute('role', 'alert');
    let providerCleanup = null, seen = 0, alive = true;
    let panel = '', panelGeneration = 0, selectedNoteId = null, stopHintTimer = null;
    const chat = el('div', undefined, 'ln-ai-chat'), overlay = el('div', undefined, 'ln-ai-overlay');overlay.hidden = true;
    const panelBox = el('section', undefined, 'ln-ai-panel'), panelHeader = el('div', undefined, 'ln-ai-panel-header'), panelTitle = el('strong'), panelBody = el('div', undefined, 'ln-ai-panel-body'), panelError = el('p', '', 'ln-ai-error');
    panelBox.setAttribute('role', 'dialog');panelBox.setAttribute('aria-label', tr('AI 助手面板', 'AI assistant panel'));panelBox.tabIndex = -1;
    panelError.setAttribute('role', 'alert');
    const closePanel = () => setPanel('');
    const close = button(tr('关闭', 'Close'), closePanel);
    panelHeader.append(panelTitle, close);
    panelBox.append(panelHeader, panelBody, panelError);overlay.append(panelBox);
    const configure = button(tr('配置', 'Configure'), () => { if (!active && !historyBusy) setPanel(panel === 'settings' ? '' : 'settings'); });
    function setPanel(next) {
      panelGeneration++;const previous = panel;panel = next;
      if (providerCleanup && next !== 'settings') { providerCleanup();providerCleanup = null; }
      overlay.hidden = !next;chat.inert = !!next;chat.setAttribute('aria-hidden', next ? 'true' : 'false');
      settings.hidden = next !== 'settings';history.hidden = next !== 'history';
      configure.setAttribute('aria-expanded', String(next === 'settings'));historyButton.setAttribute('aria-expanded', String(next === 'history'));
      panelTitle.textContent = next === 'settings' ? tr('Provider 配置', 'Provider configuration') : tr('历史会话', 'Conversation history');
      panelBox.setAttribute('aria-label', panelTitle.textContent);
      if (next === 'settings' && !providerCleanup) providerCleanup = mountProvider(settings);
      if (next) close.focus?.();else if (previous) (previous === 'settings' ? configure : historyButton).focus?.();
    }
    overlay.addEventListener('click', event => { if (event.target === overlay) closePanel(); });
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault();event.stopPropagation();closePanel();return; }
      if (event.key === 'Tab') {
        const items = [...(panelBox.querySelectorAll?.('button,input,select,textarea,[tabindex="0"]') || [])].filter(item => !item.disabled && !item.hidden && item.getClientRects?.().length !== 0);
        const first = items[0], last = items[items.length - 1], focused = document.activeElement;
        if (first && event.shiftKey && (focused === first || focused === panelBox)) { event.preventDefault();last.focus?.(); }
        else if (last && !event.shiftKey && focused === last) { event.preventDefault();first.focus?.(); }
      }
      event.stopPropagation();
    });
    const operateHistory = async run => { if (active || historyBusy || !alive || disposed) return;historyBusy = true;failure = '';refresh();try { await run(); } catch(error) { failure = String(error.message || error); } finally { historyBusy = false;refresh(); } };
    const reset = button(tr('新会话', 'New chat'), () => operateHistory(async () => { if (journal) await journal.create(tr('新会话', 'New chat'));assistant.clear();recoveryFailed = false;messages = [];generation++;failure = '';notice = '';usage = null;refresh(); }));
    const history = el('div', undefined, 'ln-ai-history');history.hidden = true;
    const historyRows = new Map();let moreHistory = null;
    async function showHistory(offset = 0) {
      if (!journal) throw new Error(tr('请更新宿主以保存聊天记录', 'Update the host for persistent chats'));
      const ticket = panelGeneration, list = await journal.list(offset);if (!alive || disposed || panel !== 'history' || ticket !== panelGeneration) return;if (offset === 0) { notice = (list.warnings || []).join(' · ');refresh();historyRows.clear();moreHistory = null; }else if (moreHistory) { moreHistory.consumed = true;moreHistory = null; }
      for (const item of list.items) {
        if (historyRows.has(item.id)) continue;
        const row = el('div', undefined, 'ln-ai-history-row');
        const open = button(item.title, () => operateHistory(async () => { applyHistory(await journal.open(item.id));setPanel(''); }));open.title = new Date(item.updatedAt).toLocaleString();
        const title = el('input');title.value = item.title;title.maxLength = 100;title.setAttribute('aria-label', tr('会话标题', 'Conversation title'));
        row.append(open, button(tr('重命名', 'Rename'), () => { title.hidden = false;save.hidden = false; }));
        const save = button(tr('保存', 'Save'), () => operateHistory(async () => { await journal.rename(item.id,title.value);await showHistory(); }));title.hidden = true;save.hidden = true;row.append(title,save);
        row.append(button(tr('删除', 'Delete'), () => operateHistory(async () => { if (!await ctx.ui.confirm(tr('确认永久删除这段聊天记录？', 'Permanently delete this conversation?'))) return;const wasCurrent = journal.current?.id === item.id;await journal.delete(item.id);if(wasCurrent){assistant.clear();recoveryFailed=false;messages=[];generation++;usage=null;}await showHistory(); })));
        historyRows.set(item.id,row);
      }
      if (list.next >= 0) { const next = list.next;const more = button(tr('更多会话', 'More conversations'), () => { if (more.consumed) return;return operateHistory(() => showHistory(next)); });moreHistory = more; }
      history.replaceChildren(...historyRows.values(), ...(moreHistory ? [moreHistory] : []));
      if (!list.items.length && offset === 0) history.append(el('p', tr('暂无历史会话', 'No conversations yet')));
    }
    const historyButton = button(tr('历史', 'History'), () => operateHistory(async () => { if(panel === 'history') setPanel('');else { setPanel('history');history.replaceChildren(el('p', tr('正在加载…', 'Loading…')));await showHistory(); } }));
    const older = button(tr('加载更早消息', 'Load older messages'), () => operateHistory(async () => { const previous = await journal.older();prependMessages(previous); }));

    header.append(historyButton, configure, reset);settings.hidden = true;panelBody.append(history, settings);
    const privacy = el('p', tr('可检索全部笔记并按需读取全文；修改前会请你确认。内容会发送至所选 AI 服务。', 'Search all notes and read full contents on demand. Changes require confirmation. Content is sent to your selected AI provider.'), 'ln-ai-muted');
    const form = el('form', undefined, 'ln-ai-compose'), input = el('textarea');input.rows = 2;input.maxLength = 20000;input.placeholder = tr('提问，或让 AI 整理笔记…', 'Ask a question or organize your notes…');input.setAttribute('aria-label', tr('聊天消息', 'Chat message'));
    const actions = el('div', undefined, 'ln-ai-actions'), send = el('button', tr('发送', 'Send')), cancel = button(tr('停止', 'Stop'), stop);send.type = 'submit';actions.append(send, cancel);form.append(input, actions);
    const context = el('label', undefined, 'ln-ai-context'), contextToggle = el('input'), contextLabel = el('span');
    contextToggle.type = 'checkbox';contextToggle.checked = includeCurrentNote;contextToggle.setAttribute('aria-label', tr('使用当前笔记上下文', 'Use current note context'));context.append(contextToggle, contextLabel);
    contextToggle.addEventListener('change', () => { includeCurrentNote = contextToggle.checked;renderContext(); });
    const usageLine = el('p', '', 'ln-ai-usage'), noticeLine = el('p', '', 'ln-ai-status'), changeCards = el('div', undefined, 'ln-ai-changes');
    let contextGeneration = 0;
    async function renderContext() {
      const ticket = ++contextGeneration;
      try { const note = await ctx.notes.current();if (!alive || ticket !== contextGeneration) return;selectedNoteId = note?.id || null;renderChanges();contextLabel.textContent = !includeCurrentNote ? tr('当前笔记上下文已关闭（历史内容仍保留）', 'Current context off (previous context remains in history)') : note ? tr('上下文：', 'Context: ') + note.title + (note.unsaved ? tr(' · 未保存', ' · unsaved') : '') : tr('未打开笔记', 'No note open');contextLabel.title = contextLabel.textContent; }
      catch { if (alive && ticket === contextGeneration) { selectedNoteId = null;renderChanges();contextLabel.textContent = tr('无法读取当前笔记', 'Unable to read current note'); } }
    }
    chat.append(context, privacy, older, log, changeCards, noticeLine, info, error, proposal, usageLine, form);root.append(header, chat, overlay);container.append(root);
    function renderChanges() {
      stopHintTimer?.();stopHintTimer = null;
      changeCards.replaceChildren();if (!alive) return;
      const change = changeHints.select(ctx.changes?.list?.() || [], selectedNoteId);if (!change) return;
      const card = el('div', undefined, 'ln-ai-change-card');
      const state = { pending: tr('待审阅', 'Pending'), applied: tr('已应用', 'Applied'), undone: tr('已撤回', 'Undone') }[change.state];
      card.append(el('span', change.title + ' · ' + state), button(tr('查看改动', 'Review'), () => { ctx.changes.open(change.id); }));changeCards.append(card);
      if (Number.isFinite(change.expiresAt)) {
        const delay = Math.max(1, change.expiresAt - Date.now());
        if (ctx.timers) stopHintTimer = ctx.timers.setTimeout(renderChanges, delay);
        else { const timer = setTimeout(renderChanges, delay);timer.unref?.();stopHintTimer = () => clearTimeout(timer); }
      }
    }
    function renderProposal() {
      root.dataset.review = pendingChange ? 'true' : 'false';
      proposal.replaceChildren();if (!pendingChange) { proposal.hidden = true;return; }
      proposal.hidden = false;const change = pendingChange;
      proposal.append(el('strong', change.type === 'create' ? tr('确认新建笔记', 'Confirm new note') : tr('确认修改笔记', 'Confirm note changes')));
      const preview = el('div', undefined, 'ln-ai-proposal-body');
      for (const [label, note] of [[tr('修改前', 'Before'), change.before], [tr('修改后', 'After'), change.after]]) {
        if (!note) continue;
        const details = el('details');details.open = true;details.append(el('summary', label + ' · ' + note.title));
        details.append(el('pre', tr('标签：', 'Tags: ') + (note.tags || []).join(', ') + String.fromCharCode(10, 10) + (note.content || '')));preview.append(details);
      }
      const buttons = el('div', undefined, 'ln-ai-actions ln-ai-proposal-actions');buttons.append(button(tr('拒绝', 'Reject'), () => settleChange(false)), button(tr('确认保存', 'Confirm save'), () => settleChange(true), 'ln-ai-save'));proposal.append(preview, buttons);
    }
    function prependMessages(previous) {
      if (!previous.length) return;
      const anchor = captureMessageAnchor(log);
      messages = [...previous,...messages];generation++;render();
      restoreMessageAnchor(log,anchor,previous.length);
    }
    let renderedGeneration = -1;
    function render() {
      if (!alive) return;
      if (renderedGeneration !== generation) { log.replaceChildren();seen = 0;renderedGeneration = generation; }
      older.hidden = !journal?.before;
      const follow = !seen || log.scrollHeight - log.scrollTop - log.clientHeight < 48;
      if (seen > messages.length) { log.replaceChildren();seen = 0; }
      for (; seen < messages.length; seen++) {
        const message = messages[seen], article = el('article', undefined, 'ln-ai-message ln-ai-' + message.role);
        article.append(el('strong', message.role === 'user' ? tr('我', 'Me') : 'AI'), el('div', message.content));log.append(article);
      }
      if (follow) log.scrollTop = log.scrollHeight;info.textContent = status;error.textContent = failure;panelError.textContent = failure;noticeLine.textContent = notice;
      usageLine.textContent = usage?.requests ? tr('输入 ', 'In ') + usage.promptTokens + tr(' · 输出 ', ' · out ') + usage.completionTokens + (usage.cacheReported ? tr(' · 缓存命中 ', ' · cached ') + usage.cachedTokens : tr(' · 缓存未报告', ' · cache not reported')) : '';
      renderChanges();contextToggle.disabled = !!active || historyBusy;
      send.disabled = !!active || historyBusy;reset.disabled = !!active || historyBusy;historyButton.disabled = !!active || historyBusy;cancel.disabled = !active;configure.disabled = !!active || historyBusy;older.disabled = !!active || historyBusy;renderProposal();
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();const value = input.value.trim();if (!value || active || historyBusy || panel || !alive || disposed) return;
      if (!ctx.ai?.chatCompletion) { failure = tr('请更新宿主应用，当前版本未提供 AI 接口。', 'Update the host application to use the AI API.');render();return; }
      const controller = new AbortController();active = controller;failure = '';render();
      try {
        if (recoveryFailed) throw new Error(tr('聊天恢复失败，请从历史重新打开，或新建会话。', 'Recovery failed. Reopen from history or create a new conversation.'));
        stored = await ctx.storage.get();
        if (!alive || disposed || controller.signal.aborted) return;
        let provider;
        try { provider = validateProvider(normalizeProvider(stored.provider || {})); }
        catch (reason) { setPanel('settings');throw reason; }
        if (!journal) throw new Error(tr('请更新宿主，当前版本不支持聊天持久化。', 'Update the host to enable persistent chats.'));
        if (!journal.current) await journal.create(value.slice(0, 40));
        if (!alive || disposed || controller.signal.aborted) return;
        await journal.append({ type: 'turn_start' });
        await journal.append({ type: 'message', role: 'user', content: value });
        if (!alive || disposed || controller.signal.aborted) return;
        config = provider;messages.push({ role: 'user', content: value });input.value = '';log.scrollTop = log.scrollHeight;render();
        await assistant.chat(value, config, controller.signal, { includeCurrentNote });
      }
      catch (reason) { failure = controller.signal.aborted ? tr('已停止。已确认并保存的笔记修改会保留。', 'Stopped. Confirmed and saved note changes are retained.') : String(reason.message || reason); }
      finally { active = null;status = '';settleChange(false);refresh(); }
    });
    input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault();form.requestSubmit(); } });
    renders.add(render);render();void renderContext();
    const contextStops = ['note:selection', 'editor:change', 'note:change'].map(name => ctx.events.on(name, payload => { if (name === 'note:selection') { contextGeneration++;selectedNoteId = payload?.id || null;renderChanges(); }void renderContext(); }));
    contextStops.push(ctx.events.on('changes:change', renderChanges));
    const stopLanguage = ctx.events.on('language:change', () => { close.textContent = tr('关闭', 'Close');if (panel) panelTitle.textContent = panel === 'settings' ? tr('Provider 配置', 'Provider configuration') : tr('历史会话', 'Conversation history');historyButton.textContent = tr('历史', 'History');older.textContent = tr('加载更早消息', 'Load older messages');configure.textContent = tr('配置', 'Configure');reset.textContent = tr('新会话', 'New chat');send.textContent = tr('发送', 'Send');cancel.textContent = tr('停止', 'Stop');render(); });
    return () => { alive = false;panelGeneration++;contextGeneration++;stopHintTimer?.();stopHintTimer = null;stop();stopLanguage();for (const dispose of contextStops) dispose();renders.delete(render);providerCleanup?.();container.replaceChildren(); };
  }
  ctx.views.register({ id: 'assistant', title: tr('AI 助手', 'AI Assistant'), titleKey: 'panel', location: 'right', mount });
  ctx.commands.register({ id: 'open', title: tr('打开 AI 助手', 'Open AI assistant'), titleKey: 'open', run: () => ctx.workspace.openView('assistant') });
  ctx.toolbar.register({ id: 'assistant', title: tr('AI 助手', 'AI Assistant'), titleKey: 'panel', text: 'AI', run: () => ctx.workspace.toggleView('assistant') });
  ctx.settings.register({ id: 'provider', title: tr('Provider 配置', 'Provider configuration'), titleKey: 'provider', mount: mountProvider });
  ctx.onDispose(() => { disposed = true;stop();renders.clear();assistant.dispose();messages = [];config.apiKey = ''; });
}
export default { activate };
