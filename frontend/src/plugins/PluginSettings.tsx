import { localizeManifest } from './i18n'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { pluginRuntime } from './runtime'
import type { PluginInstallPreview, RegisteredSetting } from './types'
import { t, errorMessage } from './ui-text'
import './plugins.css'
import { PluginMarket } from './PluginMarket'
import type { MarketPlugin, MarketRelease } from './market'

type DialogState = { kind: 'install'; file: File | { token: string }; preview: PluginInstallPreview; manifest: PluginInstallPreview['manifest'] } | { kind: 'uninstall' | 'logs' | 'settings'; id: string }
type InstallResult = { manifest: PluginInstallPreview['manifest']; action: PluginInstallPreview['action']; enabled: boolean; error?: string }

export function installSuccessText(action: PluginInstallPreview['action']) {
  switch (action) {
    case 'upgrade': return t('插件升级成功', 'Plugin upgraded successfully')
    case 'replace': return t('插件替换成功', 'Plugin replaced successfully')
    case 'downgrade': return t('插件降级成功', 'Plugin downgraded successfully')
    default: return t('插件安装成功', 'Plugin installed successfully')
  }
}

export async function installPluginWithFeedback(file: File | { token: string }, preview: PluginInstallPreview, enable: boolean): Promise<InstallResult> {
  const record = await pluginRuntime.install(file, preview)
  const result: InstallResult = { manifest: record.manifest, action: preview.action, enabled: record.enabled }
  if (enable) {
    try {
      await pluginRuntime.setEnabled(record.manifest.id, true)
      result.enabled = true
      result.error = pluginRuntime.getSnapshot().errors[record.manifest.id]
    } catch (reason) { result.error = errorMessage(reason) }
  }
  return result
}

export function PluginInstallSuccess({ result, onClose }: { result: InstallResult; onClose(): void }) {
  return <>
    <p role="status"><strong>{localizeManifest(result.manifest).name}</strong> · v{result.manifest.version}</p>
    {result.error ? <p role="alert" className="plugin-error">{t('插件文件已保存，但启用未完成，请查看日志或重试启用：', 'Plugin files were saved, but activation did not complete. Check logs or retry enabling: ')}{result.error}</p> : <p className="plugin-muted">{result.enabled ? t('插件已启用。', 'The plugin is enabled.') : t('插件尚未启用，可在插件列表中开启。', 'The plugin is not enabled yet. Enable it in the plugin list.')}</p>}
    <footer><button className="primary" onClick={onClose}>{t('确定', 'OK')}</button></footer>
  </>
}

export function installActionText(action: PluginInstallPreview['action']): string {
  switch (action) {
    case 'upgrade': return t('确认升级插件', 'Confirm plugin upgrade')
    case 'downgrade': return t('确认降级插件', 'Confirm plugin downgrade')
    case 'replace': return t('确认替换插件', 'Confirm plugin replacement')
    case 'identical': return t('此插件已安装', 'Plugin already installed')
    default: return t('确认安装插件', 'Confirm plugin installation')
  }
}

export function PluginInstallDetails({ preview }: { preview: PluginInstallPreview }) {
  const old = preview.replaces ? localizeManifest(preview.replaces.manifest) : undefined
  const added = preview.manifest.capabilities.filter(value => !old?.capabilities.includes(value))
  return <div className="plugin-install-details">
    <p><strong>{installActionText(preview.action)}</strong></p>
    <p className="plugin-muted">ID: <code>{preview.manifest.id}</code></p>
    {old && <p>{t('版本：', 'Version: ')}<strong>{old.version} → {preview.manifest.version}</strong></p>}
    {old && old.name !== preview.manifest.name && <p>{t('名称变更：', 'Name changed: ')}{old.name} → {preview.manifest.name}</p>}
    {old && old.author !== preview.manifest.author && <p className="plugin-warning">{t('作者信息变化，请核对来源：', 'Author changed. Verify the source: ')}{old.author || '—'} → {preview.manifest.author || '—'}</p>}
    {old && added.length > 0 && <p className="plugin-warning">{t('新增声明能力：', 'New declared capabilities: ')}{added.join(', ')}</p>}
    {preview.action === 'replace' && <p>{t('版本相同，但安装包内容不同。确认后替换现有代码。', 'Same version, different contents. Confirm to replace the installed code.')}</p>}
    {preview.action === 'identical' && <p>{t('安装包与已安装内容完全一致，无需重复安装；当前启用状态保持不变。', 'This exact package is already installed. Its enabled state stays unchanged.')}</p>}
    {old && preview.action !== 'identical' && <p className="plugin-muted">{t('保留插件配置和笔记，替换后默认禁用。可明确勾选安装后启用。', 'Notes and configuration are retained. The replacement is disabled unless explicitly enabled.')}</p>}
    {preview.action === 'downgrade' && <p className="plugin-warning">{t('降级可能无法读取新版配置。建议先备份插件配置，再确认继续。', 'Older versions may not understand newer configuration. Back up plugin configuration before continuing.')}</p>}
    {!!preview.sameName?.length && <div className="plugin-safe"><p>{t('发现同名插件，但 ID 不同：将独立安装，不会覆盖或继承其配置。请核对来源。', 'Same name, different IDs: installs separately without replacing existing files or configuration. Verify the source.')}</p>{preview.sameName.map(record => <p key={record.manifest.id}><code>{record.manifest.id}</code> · v{record.manifest.version} · {record.manifest.author || '—'}</p>)}</div>}
  </div>
}

export function PluginDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = ref.current
    dialog?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); return }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]'))
      if (!focusable.length) { event.preventDefault(); return }
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown, true)
    return () => { document.removeEventListener('keydown', keydown, true); previous?.focus() }
  }, [])
  return createPortal(<div className="plugin-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="plugin-dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
      <div className="plugin-settings-head"><h3>{title}</h3><button type="button" className="iconbtn" aria-label={t('关闭', 'Close')} onClick={onClose}>×</button></div>
      {children}
    </div>
  </div>, document.body)
}

function CustomSettings({ setting }: { setting: RegisteredSetting }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current ? pluginRuntime.mountSettings(setting.id, ref.current) : undefined, [setting.id])
  return <section><h4>{setting.title}</h4><div ref={ref} /></section>
}

export function PluginConfiguration({ id, onClose }: { id: string; onClose(): void }) {
  const snapshot = useSyncExternalStore(pluginRuntime.subscribe, pluginRuntime.getSnapshot, pluginRuntime.getSnapshot)
  const custom = snapshot.settings.filter(setting => setting.pluginId === id)
  const [mode, setMode] = useState<'custom' | 'json'>(custom.length ? 'custom' : 'json')
  const [value, setValue] = useState(''), [revision, setRevision] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    if (mode !== 'json') return
    let alive = true
    setLoading(true); setError(''); setRevision('')
    pluginRuntime.api<{ data: Record<string, unknown>; revision: string }>(`/${encodeURIComponent(id)}/data`).then(result => {
      if (alive) { setValue(JSON.stringify(result.data || {}, null, 2)); setRevision(result.revision) }
    }).catch(reason => { if (alive) setError(errorMessage(reason)) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [id, mode, reload])
  async function save() {
    if (!revision || loading || busy) return
    setBusy(true); setError('')
    try {
      const data: unknown = JSON.parse(value)
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(t('配置必须是 JSON 对象', 'Configuration must be a JSON object'))
      await pluginRuntime.api(`/${encodeURIComponent(id)}/data`, { method: 'PUT', body: JSON.stringify({ data, expectedRevision: revision }) })
      onClose()
    } catch (reason) { setError(errorMessage(reason)) } finally { setBusy(false) }
  }
  if (mode === 'custom') return <>
    <p className="plugin-muted">{t('这些设置修改后立即生效并保存。关闭窗口不会撤销已应用的修改。', 'Changes apply and save immediately. Closing this window does not undo applied changes.')}</p>
    {custom.map(setting => <CustomSettings key={setting.id} setting={setting} />)}
    <footer><button className="ghost-btn" onClick={() => setMode('json')}>{t('高级 JSON', 'Advanced JSON')}</button><button className="primary" onClick={onClose}>{t('完成', 'Done')}</button></footer>
  </>
  return <>
    <p className="plugin-muted">{t('高级配置仅在点击保存后写入。外部配置已变化时会阻止覆盖，请重新载入。保存后可重新启用插件以应用配置。', 'Advanced configuration is written only when saved. Concurrent changes prevent overwriting; reload before retrying. Re-enable the plugin to apply saved configuration.')}</p>
    <textarea className="plugin-config" disabled={loading || busy} aria-label={t('插件配置', 'Plugin configuration')} value={value} onChange={event => setValue(event.target.value)} spellCheck={false} />
    {error && <p role="alert" className="plugin-error">{error}</p>}
    <footer><button className="ghost-btn" disabled={busy || loading} onClick={() => setReload(value => value + 1)}>{t('重新载入', 'Reload')}</button><button className="ghost-btn" disabled={busy} onClick={onClose}>{t('取消', 'Cancel')}</button><button className="primary" disabled={busy || loading || !value || !revision} onClick={() => void save()}>{t('保存', 'Save')}</button></footer>
  </>
}

export function PluginSettings() {
  const state = useSyncExternalStore(pluginRuntime.subscribe, pluginRuntime.getSnapshot, pluginRuntime.getSnapshot)
  const fileInput = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<'installed' | 'market'>('installed')
  const [marketOpened, setMarketOpened] = useState(false)
  const pendingToken = useRef('')
  function discardPrepared() {
    const token = pendingToken.current;pendingToken.current = ''
    if (token) void pluginRuntime.api(`/market/prepared/${encodeURIComponent(token)}`, { method: 'DELETE' }).catch(() => {})
  }
  useEffect(() => () => { discardPrepared() }, [])
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [success, setSuccess] = useState<InstallResult | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [dragging, setDragging] = useState(false)
  const [acknowledgeDowngrade, setAcknowledgeDowngrade] = useState(false)
  const [enableAfterInstall, setEnableAfterInstall] = useState(false), [deleteData, setDeleteData] = useState(false)
  const [, rerender] = useState(0)
  useEffect(() => { const changed = () => rerender(value => value + 1); window.addEventListener('ln:language', changed); return () => window.removeEventListener('ln:language', changed) }, [])
  async function perform(action: () => Promise<unknown>) {
    setBusy(true); setError('')
    try { await action() } catch (reason) { setError(errorMessage(reason)) } finally { setBusy(false) }
  }
  async function prepareMarket(plugin: MarketPlugin, release: MarketRelease, signal: AbortSignal) {
    if (busy) return
    setBusy(true);setError('')
    try {
      const result = await pluginRuntime.api<{ token: string; preview: PluginInstallPreview }>('/market/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: plugin.id, version: release.version, sha256: release.sha256 }), signal })
      if (signal.aborted) { void pluginRuntime.api(`/market/prepared/${result.token}`, { method: 'DELETE' }).catch(() => {});return }
      discardPrepared();pendingToken.current = result.token
      setEnableAfterInstall(false);setAcknowledgeDowngrade(false)
      setDialog({ kind: 'install', file: { token: result.token }, preview: result.preview, manifest: result.preview.manifest })
    } finally { setBusy(false) }
  }
  async function preview(file: File) {
    setTab('installed')
    if (!file.name.toLowerCase().endsWith('.zip')) { setError(t('请选择插件 ZIP 安装包', 'Choose a plugin ZIP package')); return }
    await perform(async () => { const result = await pluginRuntime.previewInstall(file); setEnableAfterInstall(false); setAcknowledgeDowngrade(false); setDialog({ kind: 'install', file, preview: result, manifest: result.manifest }) })
  }
  function closeDialog() { if (!busy) { discardPrepared();setDialog(null) } }
  const selected = dialog && dialog.kind !== 'install' ? state.records.find(record => record.manifest.id === dialog.id) : undefined
  return <div className="plugin-settings" onDragEnter={event => { event.preventDefault(); event.stopPropagation(); document.body.classList.remove('file-drop-active'); setDragging(true) }} onDragOver={event => { event.preventDefault(); event.stopPropagation() }} onDragLeave={event => { event.stopPropagation(); if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }} onDrop={event => {
    event.preventDefault(); event.stopPropagation(); setDragging(false); document.body.classList.remove('file-drop-active')
    const files = event.dataTransfer.files
    if (!state.available || busy) return
    if (files.length !== 1) { setError(t('请每次安装一个插件 ZIP', 'Install one plugin ZIP at a time')); return }
    void preview(files[0])
  }}>
    <div className="plugin-settings-head set-section"><div><h3>{t('插件', 'Plugins')}</h3><p className="set-hint">{t('扩展侧栏、面板与笔记工作流。插件代码在本应用中运行，仅安装可信来源。', 'Extend sidebars, panels and note workflows. Plugins run inside this app; install only trusted code.')}</p></div>
    </div>
    {!state.available && <p className="plugin-safe" role="status">{t('插件管理仅在桌面应用中提供。浏览器界面不会加载第三方插件。', 'Plugin management is available in the desktop app. Browser sessions do not load third-party plugins.')}</p>}
    {state.errors.host && <div className="plugin-error" role="alert"><p>{t('插件管理初始化失败：', 'Plugin initialization failed: ')}{state.errors.host}</p><p>{t('请尝试刷新；如仍失败，退出后使用 -safe-plugins 参数启动，并检查插件目录。', 'Try Refresh. If the problem persists, quit and launch with -safe-plugins, then check the plugin directory.')}</p></div>}
    {state.safeMode && <div className="plugin-safe"><strong>{t('插件安全模式', 'Plugin safe mode')}</strong><p className="plugin-muted">{t('本次启动未执行第三方插件。可先禁用问题插件，再恢复加载。', 'Third-party plugins were not executed this session. Disable problematic plugins before resuming.')}</p><button className="ghost-btn" disabled={busy} onClick={() => void perform(() => pluginRuntime.exitSafeMode())}>{t('恢复插件加载', 'Resume plugin loading')}</button></div>}
    <input ref={fileInput} type="file" accept=".zip,application/zip" hidden onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void preview(file) }} />
    <div className="plugin-settings-tabs" role="tablist" aria-label={t('插件管理', 'Plugin management')}>
      <button id="plugin-installed-tab" type="button" role="tab" aria-selected={tab === 'installed'} aria-controls="plugin-installed-panel" disabled={busy} onClick={() => setTab('installed')}>{t('已安装', 'Installed')} · {state.records.length}</button>
      <button id="plugin-market-tab" type="button" role="tab" aria-selected={tab === 'market'} aria-controls="plugin-market-panel" disabled={busy} onClick={() => { setTab('market');setMarketOpened(true) }}>{t('插件市场', 'Plugin market')}</button>
    </div>
    {error && <p role="alert" className="plugin-error">{error}</p>}
    <div id="plugin-market-panel" role="tabpanel" aria-labelledby="plugin-market-tab" hidden={tab !== 'market'}>{marketOpened && <PluginMarket records={state.records} available={state.available} busy={busy} onPrepare={prepareMarket} />}</div>
    <div id="plugin-installed-panel" role="tabpanel" aria-labelledby="plugin-installed-tab" hidden={tab !== 'installed'}>
    <button className={`plugin-drop${dragging ? ' dragging' : ''}`} disabled={!state.available || busy} onClick={() => fileInput.current?.click()}><strong>{busy ? t('正在处理…', 'Processing…') : t('将插件 ZIP 拖到这里，或点击选择文件', 'Drop a plugin ZIP here, or choose a file')}</strong><span className="plugin-muted">{t('安装前会显示插件信息；默认保持禁用。', 'Review plugin details before installation. Installed plugins are disabled by default.')}</span></button>
    <div className="plugin-actions"><button className="ghost-btn" disabled={!state.available || busy} onClick={() => void perform(() => pluginRuntime.refresh())}>{t('刷新', 'Refresh')}</button><button className="ghost-btn" disabled={!state.available || busy || !state.records.some(record => record.enabled)} onClick={() => void perform(() => pluginRuntime.disableAll())}>{t('禁用全部插件', 'Disable all plugins')}</button><button className="ghost-btn" disabled={!state.available} onClick={() => void perform(async () => { await pluginRuntime.setSafeMode(true); window.location.reload() })}>{t('以安全模式重启界面', 'Reload in safe mode')}</button></div>
    {state.directory && <p className="plugin-directory"><span className="plugin-muted">{t('插件目录：', 'Plugin directory: ')}</span><code>{state.directory}</code> <button onClick={() => void perform(() => navigator.clipboard.writeText(state.directory))}>{t('复制路径', 'Copy path')}</button> <button onClick={() => void perform(async () => { const desktop = (window as unknown as { go?: { main?: { desktop?: { OpenPluginDirectory?(): Promise<void> } } } }).go?.main?.desktop; if (!desktop?.OpenPluginDirectory) throw new Error(t('当前环境无法打开目录', 'Cannot open the directory in this environment')); await desktop.OpenPluginDirectory() })}>{t('打开插件目录', 'Open plugin directory')}</button></p>}
    {state.loading && <p role="status" className="plugin-muted">{t('正在读取插件…', 'Loading plugins…')}</p>}
    {!state.loading && state.available && !state.records.length && <p className="plugin-muted">{t('尚未安装插件。可使用仓库中的开发示例开始。', 'No plugins installed. Try the development examples included in the repository.')}</p>}
    {state.records.map(record => { const manifest = localizeManifest(record.manifest), pluginError = state.errors[manifest.id]; return <article key={manifest.id} className="plugin-card">
      <div className="plugin-card-head"><div><h4>{manifest.name}</h4><div className="plugin-card-meta"><span>v{manifest.version}</span><span>{manifest.author || manifest.id}</span><span className={`plugin-state${pluginError ? ' error' : ''}`}>{pluginError ? t('运行异常', 'Error') : state.active.includes(manifest.id) ? t('运行中', 'Active') : record.enabled ? t('等待激活', 'Enabled') : t('已禁用', 'Disabled')}</span></div></div><label className="plugin-switch plugin-toggle"><input type="checkbox" role="switch" aria-label={manifest.name} aria-checked={record.enabled} checked={record.enabled} disabled={busy || !state.available} onChange={event => void perform(() => pluginRuntime.setEnabled(manifest.id, event.target.checked))} /><span className="plugin-toggle-track" aria-hidden="true" />{t('启用', 'Enable')}</label></div>
      {manifest.description && <p className="plugin-muted">{manifest.description}</p>}
      {manifest.capabilities.length > 0 && <p className="plugin-muted">{t('声明能力：', 'Declared capabilities: ')}{manifest.capabilities.join(', ')}</p>}
      {pluginError && <p className="plugin-error">{pluginError}</p>}
      <div className="plugin-actions"><button className="ghost-btn" onClick={() => setDialog({ kind: 'settings', id: manifest.id })}>{t('设置', 'Settings')}</button><button className="ghost-btn" onClick={() => setDialog({ kind: 'logs', id: manifest.id })}>{t('查看日志', 'View logs')}</button><button className="ghost-btn" disabled={busy} onClick={() => { setDeleteData(false); setDialog({ kind: 'uninstall', id: manifest.id }) }}>{t('卸载', 'Uninstall')}</button></div>
    </article> })}
    </div>
    {success && <PluginDialog title={installSuccessText(success.action)} onClose={() => setSuccess(null)}><PluginInstallSuccess result={success} onClose={() => setSuccess(null)} /></PluginDialog>}
    {dialog && <PluginDialog title={dialog.kind === 'install' ? installActionText(dialog.preview.action) : dialog.kind === 'uninstall' ? t('卸载插件', 'Uninstall plugin') : dialog.kind === 'settings' ? `${(selected ? localizeManifest(selected.manifest).name : dialog.id)} · ${t('设置', 'Settings')}` : `${(selected ? localizeManifest(selected.manifest).name : dialog.id)} · ${t('日志', 'Logs')}`} onClose={closeDialog}>
      {dialog.kind === 'install' && <><h4>{localizeManifest(dialog.manifest).name} · v{dialog.manifest.version}</h4><p className="plugin-muted">{dialog.manifest.author || dialog.manifest.id}</p><p>{localizeManifest(dialog.manifest).description}</p><PluginInstallDetails preview={dialog.preview} /><p className="plugin-muted">{t('声明能力：', 'Declared capabilities: ')}{dialog.manifest.capabilities.join(', ') || '—'}</p><p className="plugin-warning">{t('该插件将在应用中执行代码，可能读取笔记、访问网络或影响应用运行。能力声明不是安全沙箱，请仅安装你信任的插件。相同 ID 的插件将更新，原有配置保留。', 'This plugin executes code inside the app and may read notes, access the network, or affect the app. Capability declarations are not a security sandbox. Install only plugins you trust. An existing plugin with the same ID will be updated; its configuration is retained.')}</p>{dialog.preview.action === 'downgrade' && <label className="plugin-switch"><input type="checkbox" checked={acknowledgeDowngrade} onChange={event => setAcknowledgeDowngrade(event.target.checked)} />{t('我已了解降级可能造成配置不兼容', 'I understand the configuration compatibility risk')}</label>}<label className="plugin-switch"><input type="checkbox" disabled={busy || dialog.preview.action === 'identical'} checked={enableAfterInstall} onChange={event => setEnableAfterInstall(event.target.checked)} />{t('安装后启用', 'Enable after installation')}</label><footer><button className="ghost-btn" disabled={busy} onClick={closeDialog}>{t('取消', 'Cancel')}</button><button className="primary" disabled={busy || dialog.preview.action === 'identical' || (dialog.preview.action === 'downgrade' && !acknowledgeDowngrade)} onClick={() => void perform(async () => { const result = await installPluginWithFeedback(dialog.file, dialog.preview, enableAfterInstall); pendingToken.current = ''; setDialog(null); setSuccess(result) })}>{dialog.preview.action === 'upgrade' ? t('确认升级', 'Upgrade') : dialog.preview.action === 'downgrade' ? t('确认降级', 'Downgrade') : dialog.preview.action === 'replace' ? t('确认替换', 'Replace') : dialog.preview.action === 'identical' ? t('已安装', 'Installed') : t('信任并安装', 'Trust and install')}</button></footer></>}
      {dialog.kind === 'uninstall' && <><p>{t('确定卸载', 'Uninstall')} <strong>{(selected ? localizeManifest(selected.manifest).name : dialog.id)}</strong>？{t('插件文件将被移除，笔记内容保留。', 'Plugin files will be removed. Notes will be kept.')}</p><label className="plugin-switch"><input type="checkbox" checked={deleteData} onChange={event => setDeleteData(event.target.checked)} />{t('同时删除插件配置', 'Also delete plugin configuration')}</label><footer><button className="ghost-btn" disabled={busy} onClick={closeDialog}>{t('取消', 'Cancel')}</button><button className="primary" disabled={busy} onClick={() => void perform(async () => { await pluginRuntime.uninstall(dialog.id, deleteData); setDialog(null) })}>{t('卸载', 'Uninstall')}</button></footer></>}
      {dialog.kind === 'logs' && <><pre className="plugin-log">{state.logs.filter(log => log.pluginId === dialog.id).map(log => `${log.time} [${log.level}] ${log.message}`).join('\n') || t('本次会话暂无日志。', 'No logs in this session.')}</pre><footer><button className="ghost-btn" onClick={closeDialog}>{t('关闭', 'Close')}</button></footer></>}
      {dialog.kind === 'settings' && <PluginConfiguration id={dialog.id} onClose={closeDialog} />}
      {error && <p role="alert" className="plugin-error">{error}</p>}
    </PluginDialog>}
  </div>
}
