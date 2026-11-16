import { normalizeProvider } from './engine.js';
export function validateProvider(input, { requireModel = true } = {}) {
  if (!String(input.baseURL || '').trim()) throw new Error('请填写 Base URL / Provider URL is required');
  if (requireModel && !String(input.model || '').trim()) throw new Error('请填写模型 / Model is required');
  const provider = normalizeProvider(input);
  const url = new URL(provider.baseURL), local = url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname.startsWith('127.');
  if (!local && !provider.apiKey) throw new Error('请填写 API Key / API Key is required');
  return provider;
}
export function mountProviderForm(container, { ctx, config, tr, el, button, onSave }) {
  const root = el('form', undefined, 'ln-ai-provider');root.noValidate = true;
  let alive = true, busy = false, generation = 0, controller = null;
  const heading = el('h4', tr('Provider 配置', 'Provider configuration'));
  const preset = el('select');preset.setAttribute('aria-label', 'Provider');
  for (const [value, title] of [['deepseek', 'DeepSeek'], ['custom', tr('OpenAI 兼容 / 本地', 'OpenAI-compatible / local')]]) { const option = el('option', title);option.value = value;preset.append(option); }
  preset.value = config.baseURL === 'https://api.deepseek.com' ? 'deepseek' : 'custom';root.append(heading, preset);
  const inputs = [];
  function input(labelText, value, type = 'text') {
    const label = el('label'), caption = el('span', labelText), row = el('div', undefined, 'ln-ai-field-row'), field = el('input');field.type = type;field.value = value;field.autocomplete = 'off';field.spellcheck = false;field.setAttribute('aria-label', labelText);row.append(field);label.append(caption, row);root.append(label);inputs.push(field);return { field, row };
  }
  const { field: base } = input('Base URL', config.baseURL, 'url');
  const { field: model, row } = input(tr('模型', 'Model'), config.model);
  const get = button(tr('获取', 'Get'), () => run('models'));row.append(get);
  const picker = el('select');picker.hidden = true;picker.setAttribute('aria-label', tr('选择模型', 'Select a model'));root.append(picker);
  const { field: key } = input('API Key', config.apiKey, 'password');
  const hint = el('p', tr('Key 仅在本机明文保存。测试只发送简短问候，不含笔记，可能产生少量费用。', 'Key is stored locally in plaintext. Testing sends only a short greeting without notes and may incur a small charge.'), 'ln-ai-muted');
  const result = el('p', '', 'ln-ai-status');result.setAttribute('role', 'status');
  const actions = el('div', undefined, 'ln-ai-actions');
  const test = button(tr('测试', 'Test'), () => run('test')), save = el('button', tr('保存配置', 'Save configuration'));save.type = 'submit';actions.append(test, save);root.append(hint, result, actions);
  const values = () => ({ baseURL: base.value, model: model.value, apiKey: key.value });
  const identity = () => JSON.stringify(values());
  function lock(value) { busy = value;get.disabled = value;test.disabled = value;save.disabled = value; }
  function changed() { generation++;controller?.abort();lock(false);result.textContent = '';picker.hidden = true; }
  for (const field of inputs) field.addEventListener('input', changed);
  preset.addEventListener('change', () => { changed();if (preset.value === 'deepseek') { base.value = 'https://api.deepseek.com';model.value = 'deepseek-flash'; } });
  picker.addEventListener('change', () => { if (picker.value) { model.value = picker.value;generation++;controller?.abort();lock(false);result.textContent = tr('模型已选取，点击保存。', 'Model selected. Save to apply.'); } });
  async function run(kind) {
    if (busy) return;let provider;
    try { provider = validateProvider(values(), { requireModel: kind !== 'models' }); }
    catch (error) { result.textContent = String(error.message || error);return; }
    if (kind === 'models' && !ctx.ai?.listModels) { result.textContent = tr('请更新宿主应用以获取模型列表。', 'Update the host app to discover models.');return; }
    if (kind === 'test' && !ctx.ai?.chatCompletion) { result.textContent = tr('请更新宿主应用。', 'Update the host app.');return; }
    const ticket = ++generation, snapshot = identity();controller?.abort();controller = new AbortController();lock(true);
    result.textContent = kind === 'models' ? tr('正在获取模型…', 'Fetching models…') : tr('正在测试…', 'Testing…');
    try {
      if (kind === 'models') {
        const response = await ctx.ai.listModels({ baseURL: provider.baseURL, apiKey: provider.apiKey }, { signal: controller.signal });
        if (!alive || ticket !== generation || snapshot !== identity()) return;
        const models = [...new Set((response.models || []).filter(id => typeof id === 'string' && id.trim()))].sort();
        picker.replaceChildren();const placeholder = el('option', tr('点击选择模型', 'Select a model'));placeholder.value = '';picker.append(placeholder);
        for (const id of models) { const option = el('option', id);option.value = id;picker.append(option); }
        picker.value = '';picker.hidden = !models.length;
        result.textContent = models.length ? tr('已获取 ', 'Found ') + models.length + tr(' 个模型，请选择。', ' models. Choose one.') : tr('没有返回模型，可手动填写。', 'No models returned. Enter a model manually.');
      } else if (kind === 'test') {
        const response = await ctx.ai.chatCompletion({ ...provider, messages: [{ role: 'user', content: 'Reply OK.' }], maxTokens: 16 }, { signal: controller.signal });
        if (!alive || ticket !== generation || snapshot !== identity()) return;
        if (!response?.choices?.[0]?.message) throw new Error(tr('返回格式无效。', 'Invalid provider response.'));
        result.textContent = tr('连接成功，当前模型可访问。', 'Connected. The selected model is accessible.');
      } else {
        const configSnapshot = ctx.storage.snapshot ? await ctx.storage.snapshot() : null;
        const latest = configSnapshot ? configSnapshot.data : await ctx.storage.get();
        if (!alive || ticket !== generation || snapshot !== identity()) return;
        if (configSnapshot) await ctx.storage.compareAndSet({ ...latest, provider }, configSnapshot.revision);
        else await ctx.storage.set({ ...latest, provider });
        onSave(provider);
        if (alive && ticket === generation) result.textContent = tr('配置已保存，下次发送生效。', 'Saved. Applies to the next message.');
      }
    } catch (error) { if (alive && ticket === generation) result.textContent = String(error.message || error); }
    finally { if (alive && ticket === generation) lock(false); }
  }
  root.addEventListener('submit', event => { event.preventDefault();void run('save'); });
  container.append(root);
  return () => { alive = false;generation++;controller?.abort();container.replaceChildren(); };
}
