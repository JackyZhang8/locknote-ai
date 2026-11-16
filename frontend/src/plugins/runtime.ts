import { pluginError, responseError } from './errors.js'
import { currentLocale, translate } from './i18n.js'
import { noteChanges } from './note-changes.js'
import type {
  Disposable, PluginContext, PluginHost, PluginManifest, PluginModule, PluginRecord, PluginInstallPreview,
  PluginSnapshot, RegisteredCommand, ViewLocation, AIChatResponse, PluginData, PluginDataSnapshot,
} from './types.js'

interface RuntimeOptions {
  fetch?: typeof fetch
  loadModule?: (url: string) => Promise<PluginModule>
  activationTimeout?: number
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
}
interface Scope {
  id: string
  generation: number
  alive: boolean
  disposables: Set<Disposable>
  module?: PluginModule['default']
  writes: number[]
}
const features = Object.freeze(['notes.query', 'notes.versionedWrites', 'notes.review.metadata', 'notes.review.deferred', 'writes.commitReceipts', 'storage.cas', 'workspace.activeViews', 'events.typed', 'ai.chat', 'ai.models', 'conversations.journal'])
const reservedHotkeys = new Set(['mod+k', 'mod+s', 'mod+n', 'mod+shift+p'])
function normalizeHotkey(value: string): string {
  const parts = value.toLowerCase().split('+').map(part => part.trim())
  const key = parts.pop()
  const allowed = new Set(['mod', 'ctrl', 'control', 'meta', 'cmd', 'alt', 'shift'])
  if (!key || parts.some(part => !allowed.has(part)) || (!parts.some(part => part !== 'shift') && !/^f\d{1,2}$/.test(key))) throw new Error('快捷键需要 Ctrl、Cmd、Mod 或 Alt 修饰键')
  const modifiers = new Set(parts.map(part => ['ctrl', 'control', 'meta', 'cmd'].includes(part) ? 'mod' : part))
  return [...['mod', 'alt', 'shift'].filter(part => modifiers.has(part)), key].join('+')
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const emptySnapshot = (): PluginSnapshot => ({
  available: false, loading: false, directory: '', records: [], active: [], commands: [], views: [], openViews: [], activeViews: {},
  toolbar: [], status: [], menus: [], settings: [], logs: [], errors: {}, safeMode: false,
})

/** Trusted, same-realm runtime. Capability checks are API contracts, not a sandbox. */
export class PluginRuntime {
  private state = emptySnapshot()
  private locale = currentLocale()
  private readonly contributionText = new Map<string, { manifest: PluginManifest; title?: string; titleKey?: string; text?: string; textKey?: string }>()
  private session = ''
  private host?: PluginHost
  private readonly fetcher: typeof fetch
  private readonly loader: (url: string) => Promise<PluginModule>
  private readonly timeout: number
  private readonly subscribers = new Set<() => void>()
  private readonly scopes = new Map<string, Scope>()
  private readonly activations = new Map<string, Promise<void>>()
  private readonly mounts = new Map<string, Set<Disposable>>()
  private readonly listeners = new Map<string, Set<{ scope: Scope; callback: (payload: unknown) => void | Promise<void> }>>()
  private generation = 0
  private readonly recoveryStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  private removePagehide?: Disposable
  private removeChanges?: Disposable

  constructor(options: RuntimeOptions = {}) {
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init))
    this.loader = options.loadModule ?? (url => import(/* @vite-ignore */ url))
    this.timeout = options.activationTimeout ?? 10000
    this.recoveryStorage = options.storage
  }

  setLocale(locale: string) {
    const next = locale.trim().replace(/_/g, '-') || 'en'
    if (next === this.locale) return
    this.locale = next
    const patch: Partial<PluginSnapshot> = {}
    for (const key of ['commands', 'views', 'menus', 'toolbar', 'status', 'settings'] as const) {
      Object.assign(patch, { [key]: this.state[key].map(item => this.localizeContribution(key, item)) })
    }
    this.publish(patch)
    this.emit('language:change', { locale: next })
  }
  private localizeContribution<T extends { id: string; pluginId: string }>(kind: string, item: T): T {
    const source = this.contributionText.get(kind + ':' + item.id)
    if (!source) return item
    const translated = { ...item } as T & { title?: string; text?: string }
    translated.title = source.titleKey ? translate(source.manifest, this.locale, source.titleKey, {}, source.title) : source.title
    if (source.textKey) translated.text = translate(source.manifest, this.locale, source.textKey, {}, source.text)
    return translated
  }
  setHost(host: PluginHost) { this.host = host }
  getSnapshot = () => this.state
  isScopeActive = (pluginId: string) => this.scopes.get(pluginId)?.alive === true
  subscribe = (callback: () => void): Disposable => {
    this.subscribers.add(callback)
    return () => { this.subscribers.delete(callback) }
  }
  private publish(patch: Partial<PluginSnapshot> = {}) {
    this.state = { ...this.state, ...patch }
    this.state.openViews = this.state.views.filter(view => view.open)
    const activeViews = { ...this.state.activeViews }
    for (const location of ['left', 'right', 'main', 'bottom'] as const) {
      if (!this.state.openViews.some(view => view.id === activeViews[location] && view.location === location)) {
        const fallback = this.state.openViews.find(view => view.location === location)
        if (location === 'main' && activeViews.main === '__note__') continue
        if (fallback) activeViews[location] = fallback.id
        else delete activeViews[location]
      }
    }
    this.state.activeViews = activeViews
    for (const callback of this.subscribers) callback()
  }
  private log(pluginId: string, level: 'info' | 'error', text: string) {
    this.publish({ logs: [...this.state.logs, { pluginId, level, message: text.slice(0, 2000), time: new Date().toISOString() }].slice(-200) })
  }
  recordError = (pluginId: string, error: unknown) => {
    const text = message(error)
    this.publish({ errors: { ...this.state.errors, [pluginId]: text } })
    this.log(pluginId, 'error', text)
  }

  async api<T = unknown>(path = '', init: RequestInit = {}): Promise<T> {
    if (!this.session) throw new Error('插件管理仅在桌面应用中可用')
    const headers = new Headers(init.headers)
    headers.set('X-Locknote-Plugin-Session', this.session)
    const result = await this.fetcher(`/api/plugins${path}`, { ...init, headers })
    if (!result.ok) {
      const data = await result.json().catch(() => ({}))
      throw responseError(result.status, data)
    }
    if (result.status === 204) return undefined as T
    return result.json() as Promise<T>
  }

  private storage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined {
    try { return this.recoveryStorage ?? (typeof window !== 'undefined' ? window.localStorage : undefined) }
    catch { return undefined }
  }
  private markRunning(running: boolean) {
    try {
      if (running) this.storage()?.setItem('locknote-plugin-session-active', '1')
      else this.storage()?.removeItem('locknote-plugin-session-active')
    } catch { /* Read-only webview storage must not break plugin management. */ }
  }
  private recoveryNeeded() {
    try {
      return this.storage()?.getItem('locknote-plugin-session-active') === '1' ||
        this.storage()?.getItem('locknote-plugins-safe') === '1' ||
        (typeof location !== 'undefined' && new URLSearchParams(location.search).get('safePlugins') === '1')
    } catch { return false }
  }
  async initialize(session: string, options: { safeMode?: boolean } = {}) {
    const sameSession = !!session && session === this.session
    if (this.session && session !== this.session) await this.stopAll()
    const safeMode = !!options.safeMode || (sameSession ? this.state.safeMode : this.recoveryNeeded())
    this.session = session
    this.publish({ available: !!session, safeMode })
    if (!session) return
    if (!this.removeChanges) this.removeChanges = noteChanges.subscribe(() => this.emit('changes:change', {}))
    if (typeof window !== 'undefined') {
      this.removePagehide?.()
      const clean = () => this.prepareToClose()
      window.addEventListener('pagehide', clean)
      this.removePagehide = () => window.removeEventListener('pagehide', clean)
    }
    await this.refresh()
    if (this.state.safeMode) return
    if (this.state.records.some(record => record.enabled)) this.markRunning(true)
    await Promise.all(this.state.records.filter(record => record.enabled && this.autoStart(record.manifest)).map(record => this.activate(record.manifest.id)))
  }
  private autoStart(manifest: PluginManifest) {
    // UI entries are registered by activate(); restore them even when all panels were closed.
    const contributesUI = manifest.capabilities.some(capability => capability === 'ui.sidebar' || capability === 'ui.panel')
    return contributesUI || !manifest.activationEvents?.length || manifest.activationEvents.includes('onStartup') || manifest.activationEvents.includes('onWorkspaceReady') || [...this.savedViews()].some(id => id.startsWith(`${manifest.id}:`))
  }
  async refresh() {
    this.publish({ loading: true })
    try {
      const response = await this.api<{ plugins: PluginRecord[]; directory: string }>()
      for (const [id, scope] of this.scopes) {
        const record = response.plugins.find(item => item.manifest.id === id)
        const previous = this.state.records.find(item => item.manifest.id === id)
        if (!record?.enabled || record.manifest.version !== previous?.manifest.version || record.digest !== previous?.digest) this.disposeScope(scope)
      }
      const errors = { ...this.state.errors }
      delete errors.host
      this.publish({ records: response.plugins, directory: response.directory, errors })
      this.updateLazyCommands()
    } finally { this.publish({ loading: false }) }
  }
  private assertHotkey(hotkey: string | undefined, id: string, commands = this.state.commands) {
    if (!hotkey) return
    const normalized = normalizeHotkey(hotkey)
    if (reservedHotkeys.has(normalized)) throw new Error(`快捷键已由应用保留：${hotkey}`)
    if (commands.some(command => command.id !== id && command.hotkey && normalizeHotkey(command.hotkey) === normalized)) throw new Error(`快捷键冲突：${hotkey}`)
  }
  private updateLazyCommands() {
    const commands = this.state.commands.filter(command => !command.lazy)
    for (const record of this.state.records) {
      if (!record.enabled || this.scopes.has(record.manifest.id) || this.state.safeMode) continue
      for (const command of record.manifest.commands ?? []) {
        const id = `${record.manifest.id}:${command.id}`
        if (!commands.some(existing => existing.id === id)) {
          try {
            this.assertHotkey(command.hotkey, id, commands)
            this.contributionText.set('commands:' + id, { manifest: record.manifest, title: command.title, titleKey: command.titleKey ?? 'commands.' + command.id })
            commands.push(this.localizeContribution('commands', { ...command, id, pluginId: record.manifest.id, lazy: true, run: () => this.runCommand(id) }))
          } catch (error) { this.recordError(record.manifest.id, error) }
        }
      }
    }
    this.publish({ commands })
  }

  private async uploadPackage<T>(path: string, file: Blob, expectedDigest?: string): Promise<T> {
    if (file.size > 16 * 1024 * 1024) throw new Error('插件 ZIP 不能超过 16 MiB')
    // WKWebView custom-scheme requests may lose file-backed Blob bodies.
    // Send ASCII text so binary ZIP bytes survive the desktop request bridge.
    const bytes = new Uint8Array(await file.arrayBuffer())
    const chunks: string[] = []
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)))
    }
    return this.api<T>(path, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'X-Locknote-Plugin-Encoding': 'base64', ...(expectedDigest === undefined ? {} : { 'X-Locknote-Plugin-Expected-Digest': expectedDigest }) }, body: btoa(chunks.join('')) })
  }
  async previewInstall(file: Blob): Promise<PluginInstallPreview> {
    return this.uploadPackage('/preview', file)
  }
  async install(file: Blob | { token: string }, preview?: PluginInstallPreview) {
    if (preview && noteChanges.getSnapshot().entries.some(entry => entry.pluginId === preview.manifest.id && (entry.busy || (entry.state === 'pending' && !entry.retained)))) throw new Error('请先处理此插件的待审阅改动 / Resolve this plugin’s pending review first')
    const record = 'token' in file
      ? await this.api<PluginRecord>('/market/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: file.token, expectedDigest: preview?.replaces?.digest ?? '' }) })
      : await this.uploadPackage<PluginRecord>('/install', file, preview?.replaces?.digest ?? '')
    const previous = this.state.records.find(item => item.manifest.id === record?.manifest?.id)
    if (record?.manifest?.id && (!record.enabled || record.digest !== previous?.digest)) await this.deactivate(record.manifest.id)
    try { await this.refresh() } catch (error) { this.recordError('host', error) }
    return record
  }
  async setEnabled(id: string, enabled: boolean) {
    await this.api(`/${encodeURIComponent(id)}/enabled`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) })
    if (!enabled) await this.deactivate(id)
    await this.refresh()
    // An explicit user action may activate a package even after safe startup.
    if (enabled) await this.activate(id, true)
  }
  async uninstall(id: string, deleteData = false) {
    await this.api(`/${encodeURIComponent(id)}${deleteData ? '?deleteData=1' : ''}`, { method: 'DELETE' })
    await this.deactivate(id)
    for (const view of this.savedViews()) if (view.startsWith(`${id}:`)) this.rememberView(view, false)
    await this.refresh()
  }
  async disableAll() {
    await this.api('/disable-all', { method: 'POST' })
    await this.stopAll()
    await this.refresh()
  }
  async setSafeMode(enabled: boolean) {
    if (!enabled) return this.exitSafeMode()
    this.publish({ safeMode: true })
    try { this.storage()?.setItem('locknote-plugins-safe', '1') } catch { /* optional preference */ }
    await this.stopAll()
    this.updateLazyCommands()
  }
  async exitSafeMode() {
    try { this.storage()?.removeItem('locknote-plugins-safe') } catch { /* optional preference */ }
    this.publish({ safeMode: false })
    this.updateLazyCommands()
    if (this.state.records.some(record => record.enabled)) this.markRunning(true)
    await Promise.all(this.state.records.filter(record => record.enabled && this.autoStart(record.manifest)).map(record => this.activate(record.manifest.id)))
  }
  async stopAll() {
    await Promise.all([...this.scopes.keys()].map(id => this.deactivate(id)))
    this.markRunning(false)
  }
  prepareToClose() {
    // Closing must never invoke plugin code: a cleanup callback may hang.
    for (const scope of this.scopes.values()) scope.alive = false
    this.removePagehide?.()
    this.removePagehide = undefined
    this.removeChanges?.();this.removeChanges = undefined
    this.markRunning(false)
  }
  shutdown() {
    // Clean up synchronously and never wait for arbitrary third-party promises.
    this.removeChanges?.();this.removeChanges = undefined
    for (const scope of [...this.scopes.values()]) this.disposeScope(scope)
    this.removePagehide?.()
    this.removePagehide = undefined
    this.markRunning(false)
  }

  private assertScope(scope: Scope) {
    if (!scope.alive || this.scopes.get(scope.id) !== scope) throw pluginError('PLUGIN_STOPPED', '插件已停用，操作已取消')
  }
  private own(scope: Scope, dispose: Disposable): Disposable {
    this.assertScope(scope)
    let active = true
    const tracked = () => {
      if (!active) return
      active = false
      scope.disposables.delete(tracked)
      try { dispose() } catch (error) { this.recordError(scope.id, error) }
    }
    scope.disposables.add(tracked)
    return tracked
  }
  private disposeScope(scope: Scope) {
    if (!scope.alive) return
    scope.alive = false
    if (this.scopes.get(scope.id) === scope) {
      this.scopes.delete(scope.id)
      this.activations.delete(scope.id)
    }
    for (const view of this.state.views.filter(item => item.pluginId === scope.id)) this.unmount('views:' + view.id)
    for (const setting of this.state.settings.filter(item => item.pluginId === scope.id)) this.unmount('settings:' + setting.id)
    for (const dispose of [...scope.disposables].reverse()) dispose()
    this.publish({
      active: this.state.active.filter(id => id !== scope.id),
      commands: this.state.commands.filter(item => item.pluginId !== scope.id),
      views: this.state.views.filter(item => item.pluginId !== scope.id),
      menus: this.state.menus.filter(item => item.pluginId !== scope.id),
      toolbar: this.state.toolbar.filter(item => item.pluginId !== scope.id),
      status: this.state.status.filter(item => item.pluginId !== scope.id),
      settings: this.state.settings.filter(item => item.pluginId !== scope.id),
    })
  }
  private async withTimeout<T>(promise: Promise<T>, description: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([promise, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(description)), this.timeout)
      })])
    } finally { if (timer !== undefined) clearTimeout(timer) }
  }
  async activate(id: string, explicit = false): Promise<void> {
    const inProgress = this.activations.get(id)
    if (inProgress) return inProgress
    if (this.scopes.has(id) || (this.state.safeMode && !explicit)) return
    const record = this.state.records.find(item => item.manifest.id === id)
    if (!record?.enabled) return
    if (!this.host) throw new Error('插件宿主尚未就绪')
    this.markRunning(true)
    const scope: Scope = { id, generation: ++this.generation, alive: true, disposables: new Set(), writes: [] }
    this.scopes.set(id, scope)
    const run = async () => {
      try {
        const module = await this.withTimeout(this.loader(`${this.assetURL(record, record.manifest.entry)}?activation=${scope.generation}`), '插件加载超时')
        this.assertScope(scope)
        const implementation = module.default ?? (module.activate ? { activate: module.activate, deactivate: module.deactivate } : undefined)
        if (!implementation?.activate) throw new Error('插件缺少 activate(context) 入口')
        scope.module = implementation
        if (record.manifest.styles && typeof document !== 'undefined') {
          const link = document.createElement('link')
          link.rel = 'stylesheet'
          link.href = this.assetURL(record, record.manifest.styles)
          document.head.appendChild(link)
          this.own(scope, () => link.remove())
        }
        this.publish({ commands: this.state.commands.filter(command => command.pluginId !== id || !command.lazy) })
        const activation = Promise.resolve(implementation.activate(this.context(record, scope))).then(result => {
          if (!scope.alive && typeof result === 'function') { result(); return undefined }
          return result
        })
        const result = await this.withTimeout(activation, '插件初始化超时')
        if (typeof result === 'function') {
          if (scope.alive) this.own(scope, result)
          else result()
        }
        this.assertScope(scope)
        const errors = { ...this.state.errors }
        delete errors[id]
        this.publish({ active: [...this.state.active.filter(item => item !== id), id], errors })
        this.log(id, 'info', '插件已激活')
      } catch (error) {
        this.disposeScope(scope)
        this.recordError(id, error)
      } finally {
        if (this.scopes.get(id) === scope || !this.scopes.has(id)) this.activations.delete(id)
      }
    }
    const promise = run()
    this.activations.set(id, promise)
    return promise
  }
  async deactivate(id: string) {
    const scope = this.scopes.get(id)
    if (!scope) return
    this.disposeScope(scope)
    // Do not hold up shutdown or UI while arbitrary plugin cleanup is pending.
    if (scope.module?.deactivate) {
      try { await this.withTimeout(Promise.resolve(scope.module.deactivate()), '插件清理超时，请重启应用') }
      catch (error) { this.recordError(id, error) }
    }
    this.log(id, 'info', '插件已停用')
  }

  private savedViews(): Set<string> {
    try {
      const value = JSON.parse(this.storage()?.getItem('locknote-plugin-open-views') ?? '[]')
      return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(-128) : [])
    } catch { return new Set() }
  }
  private rememberView(id: string, open: boolean) {
    const ids = this.savedViews()
    if (open) ids.add(id)
    else ids.delete(id)
    try { this.storage()?.setItem('locknote-plugin-open-views', JSON.stringify([...ids].slice(-128))) } catch { /* optional layout */ }
  }
  private assetURL(record: PluginRecord, path: string): string {
    if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('无效的插件资源路径')
    return `/api/plugins/assets/${encodeURIComponent(this.session)}/${encodeURIComponent(record.manifest.id)}/${encodeURIComponent(record.manifest.version + (record.digest ? '@' + record.digest : ''))}/${path.split('/').map(encodeURIComponent).join('/')}`
  }
  private context(record: PluginRecord, scope: Scope): PluginContext {
    const manifest = record.manifest
    const host = this.host!
    const assert = () => this.assertScope(scope)
    const capability = (...names: string[]) => {
      assert()
      if (!names.some(name => manifest.capabilities.includes(name))) throw pluginError('CAPABILITY_DENIED', '插件未声明能力：' + names.join(' / '))
    }
    const invoke = async <T>(run: () => Promise<T>): Promise<T> => { assert(); const result = await run(); assert(); return result }
    // Submitted writes keep their success receipts even if the plugin is disabled.
    const commit = async <T>(run: () => Promise<T>): Promise<T> => { assert();return run() }
    const write = () => {
      assert()
      const cutoff = Date.now() - 60000
      scope.writes = scope.writes.filter(time => time > cutoff)
      if (scope.writes.length >= 60) throw pluginError('RATE_LIMITED', '插件写入过于频繁：每分钟最多 60 次，请检查自动化循环')
      scope.writes.push(Date.now())
    }
    const namespace = (id: string) => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) throw new Error('扩展 ID 只能包含字母、数字、点、下划线或短横线')
      return `${scope.id}:${id}`
    }
    const register = <T extends { id: string }>(key: 'commands' | 'views' | 'menus' | 'toolbar' | 'status' | 'settings', contribution: T): Disposable => {
      assert()
      const id = namespace(contribution.id)
      if (key === 'commands') this.assertHotkey((contribution as unknown as RegisteredCommand).hotkey, id)
      const list = this.state[key] as Array<{ id: string; pluginId: string }>
      if (list.some(item => item.id === id && !(key === 'commands' && (item as RegisteredCommand).lazy))) throw new Error(`重复的扩展 ID：${id}`)
      this.contributionText.set(key + ':' + id, { ...contribution, manifest })
      this.publish({ [key]: [...list.filter(item => item.id !== id), this.localizeContribution(key, { ...contribution, id, pluginId: scope.id })] })
      return this.own(scope, () => {
        if (key === 'views' || key === 'settings') this.unmount(key + ':' + id)
        this.contributionText.delete(key + ':' + id)
        this.publish({ [key]: this.state[key].filter(item => item.id !== id) })
      })
    }
    const aiRequest = async <T>(path: string, request: unknown, options?: { signal?: AbortSignal }): Promise<T> => {
      capability('ai.chat')
      const controller = new AbortController()
      const dispose = this.own(scope, () => controller.abort())
      const abort = () => controller.abort()
      options?.signal?.addEventListener('abort', abort, { once: true })
      if (options?.signal?.aborted) controller.abort()
      try { return await invoke(() => this.api<T>('/' + encodeURIComponent(scope.id) + '/ai/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal })) }
      finally { options?.signal?.removeEventListener('abort', abort); dispose() }
    }
    this.own(scope, noteChanges.register(scope.id, {
      reveal: id => invoke(() => host.workspace.openNote(id)),
      current: () => invoke(() => host.notes.current(scope.id)),
      get: id => { capability('notes.read');return invoke(() => host.notes.get(id, scope.id)) },
      create: input => { capability('notes.write');write();return commit(() => host.notes.create(input, scope.id)) },
      update: (id, patch) => { capability('notes.write');write();return commit(() => host.notes.update(id, patch, scope.id)) },
    }))
    let legacyRevision: string | undefined
    const readData = () => invoke(() => this.api<PluginDataSnapshot>('/' + encodeURIComponent(scope.id) + '/data'))
    const saveData = async (data: PluginData, expectedRevision: string) => {
      assert()
      if (!expectedRevision) throw Object.assign(new Error('需要配置版本 / Configuration revision required'), { code: 'INVALID_ARGUMENT' })
      return commit(() => this.api<PluginDataSnapshot>('/' + encodeURIComponent(scope.id) + '/data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data, expectedRevision }) }))
    }
    const runtime = this
    return {
      host: Object.freeze({ apiVersion: 1 as const, features, hasFeature: (name: string) => features.includes(name) }),
      changes: {
        review: (input, options) => { capability('notes.read');capability('notes.write');return noteChanges.review(scope.id, input, options?.signal) },
        list: () => { assert();return noteChanges.list(scope.id) },
        open: id => { assert();noteChanges.open(id, scope.id) },
        undo: id => { capability('notes.write');return noteChanges.undo(scope.id, id) },
      },
      i18n: { get locale() { return runtime.locale }, t: (key, params, fallback) => translate(manifest, runtime.locale, key, params, fallback) },
      manifest: Object.freeze({ ...manifest, capabilities: [...manifest.capabilities] }),
      onDispose: dispose => this.own(scope, dispose),
      commands: { register: command => register('commands', command) },
      views: { register: view => {
        if (!(['left', 'right', 'main', 'bottom'] as ViewLocation[]).includes(view.location)) throw new Error('不支持的插件视图位置')
        return register('views', { ...view, open: this.savedViews().has(namespace(view.id)) })
      } },
      menus: { register: menu => register('menus', menu) },
      toolbar: { register: button => register('toolbar', button) },
      status: { register: button => register('status', button) },
      settings: { register: setting => register('settings', setting) },
      notes: {
        current: () => { capability('notes.readCurrent', 'notes.read'); return invoke(() => host.notes.current(scope.id)) },
        list: query => { capability('notes.read'); return invoke(() => host.notes.list(query, scope.id)) },
        get: id => { capability('notes.read'); return invoke(() => host.notes.get(id, scope.id)) },
        create: input => { capability('notes.write'); write(); return commit(() => host.notes.create(input, scope.id)) },
        update: async (id, patch) => {
          capability('notes.updateCurrent', 'notes.write')
          if (!patch || !Number.isInteger(patch.expectedVersion) || patch.expectedVersion < 1) {
            throw new Error('更新笔记必须提供读取时的 expectedVersion')
          }
          if (!manifest.capabilities.includes('notes.write')) {
            const current = await invoke(() => host.notes.current(scope.id))
            if (current?.id !== id) throw new Error('该插件只允许修改当前笔记')
          }
          write()
          return commit(() => host.notes.update(id, patch, scope.id))
        },
      },
      editor: {
        getSelection: () => { capability('editor.read', 'notes.readCurrent', 'notes.read'); return invoke(() => host.editor.getSelection(scope.id)) },
        replaceSelection: text => { capability('editor.write', 'notes.updateCurrent'); write(); return invoke(() => host.editor.replaceSelection(text, scope.id)) },
        insertText: text => { capability('editor.write', 'notes.updateCurrent'); write(); return invoke(() => host.editor.insertText(text, scope.id)) },
      },
      workspace: {
        openNote: id => invoke(() => host.workspace.openNote(id)),
        openView: id => { assert(); return this.openView(namespace(id)) },
        toggleView: id => { assert(); return this.toggleView(namespace(id)) },
        closeView: id => { assert(); this.closeView(namespace(id)) },
        revealLine: line => { assert(); host.workspace.revealLine?.(Math.max(1, Math.floor(line))) },
      },
      events: { on: (name, callback) => {
        assert()
        const listener = { scope, callback: callback as (payload: unknown) => void | Promise<void> }
        const listeners = this.listeners.get(name) ?? new Set()
        listeners.add(listener)
        this.listeners.set(name, listeners)
        return this.own(scope, () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(name) })
      } },
      ai: {
        chatCompletion: (request, options) => aiRequest<AIChatResponse>('chat', request, options),
        listModels: (provider, options) => aiRequest<{ models: string[] }>('models', provider, options),
      },
      conversations: {
        list: (offset = 0) => invoke(() => this.api('/' + encodeURIComponent(scope.id) + '/conversations?offset=' + offset)),
        create: title => invoke(() => this.api('/' + encodeURIComponent(scope.id) + '/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })),
        read: (id, before = -1) => invoke(() => this.api('/' + encodeURIComponent(scope.id) + '/conversations/' + encodeURIComponent(id) + '?before=' + before)),
        append: (id, expectedSeq, events) => invoke(() => this.api('/' + encodeURIComponent(scope.id) + '/conversations/' + encodeURIComponent(id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedSeq, events }) })),
        activate: id => invoke(async () => { await this.api('/' + encodeURIComponent(scope.id) + '/conversations', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activeId: id }) }) }),
        rename: (id, title) => invoke(async () => { await this.api('/' + encodeURIComponent(scope.id) + '/conversations/' + encodeURIComponent(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) }) }),
        delete: id => invoke(async () => { await this.api('/' + encodeURIComponent(scope.id) + '/conversations/' + encodeURIComponent(id), { method: 'DELETE' }) }),
      },
      storage: {
        get: async () => { const snapshot = await readData();legacyRevision = snapshot.revision;return snapshot.data },
        set: async data => {
          const expected = legacyRevision ?? (await readData()).revision
          const saved = await saveData(data, expected);legacyRevision = saved.revision
        },
        snapshot: readData,
        compareAndSet: saveData,
      },
      ui: {
        notify: text => { assert(); host.ui.notify(String(text)) },
        confirm: text => invoke(() => host.ui.confirm(String(text))),
      },
      resources: { assetURL: path => { assert(); return this.assetURL(record, path) } },
      timers: {
        setTimeout: (callback, delay) => {
          assert()
          const timer = setTimeout(() => { dispose(); if (scope.alive) this.runSafely(scope.id, callback) }, Math.max(0, delay))
          const dispose = this.own(scope, () => clearTimeout(timer))
          return dispose
        },
        setInterval: (callback, delay) => {
          assert()
          const timer = setInterval(() => { if (scope.alive) this.runSafely(scope.id, callback) }, Math.max(16, delay))
          return this.own(scope, () => clearInterval(timer))
        },
      },
    }
  }

  private async runSafely(pluginId: string, run: () => unknown) {
    try { await run() } catch (error) { this.recordError(pluginId, error) }
  }
  emit(name: string, payload: unknown) {
    for (const listener of this.listeners.get(name) ?? []) {
      if (name === 'note:change' && payload && typeof payload === 'object') {
        const event = payload as { pluginId?: string; source?: string }
        if (event.pluginId === listener.scope.id || event.source === `plugin:${listener.scope.id}`) continue
      }
      if (listener.scope.alive) void this.runSafely(listener.scope.id, () => listener.callback(payload))
    }
  }
  private async runInteractive(pluginId: string, run: () => unknown) {
    try { await run() } catch (error) { this.recordError(pluginId, error); throw error }
  }
  async runCommand(id: string) {
    let command = this.state.commands.find(item => item.id === id)
    if (command?.lazy) {
      await this.activate(command.pluginId, true)
      command = this.state.commands.find(item => item.id === id && !item.lazy)
    }
    if (!command) throw new Error(this.state.errors[id.split(':')[0]] || '插件命令不可用')
    await this.runInteractive(command.pluginId, command.run)
  }
  async runMenu(id: string, context?: unknown) {
    const menu = this.state.menus.find(item => item.id === id)
    if (menu) await this.runInteractive(menu.pluginId, () => menu.run(context))
  }
  async runButton(id: string) {
    const button = [...this.state.toolbar, ...this.state.status].find(item => item.id === id)
    if (button) await this.runInteractive(button.pluginId, button.run)
  }
  async toggleView(id: string) {
    if (this.state.views.some(view => view.id === id && view.open)) this.closeView(id)
    else await this.openView(id)
  }
  async openView(id: string) {
    const pluginId = id.split(':')[0]
    if (!this.scopes.has(pluginId)) await this.activate(pluginId, true)
    const view = this.state.views.find(item => item.id === id)
    if (!view) return
    this.rememberView(id, true)
    // One visible view per dock, multiple main tabs retain their independent containers.
    this.publish({ views: this.state.views.map(item => item.id === id ? { ...item, open: true } : item), activeViews: { ...this.state.activeViews, [view.location]: id } })
  }
  selectView(id: string) { const view = this.state.views.find(item => item.id === id && item.open);if (view) this.publish({ activeViews: { ...this.state.activeViews, [view.location]: id } }) }
  selectNoteView() { this.publish({ activeViews: { ...this.state.activeViews, main: '__note__' } }) }
  closeView(id: string) {
    this.rememberView(id, false)
    this.unmount('views:' + id)
    this.publish({ views: this.state.views.map(item => item.id === id ? { ...item, open: false } : item) })
  }
  private unmount(id: string) {
    const cleanups = this.mounts.get(id)
    this.mounts.delete(id)
    for (const cleanup of cleanups ?? []) cleanup()
  }
  private mount(id: string, pluginId: string, container: HTMLElement, fn: () => void | Disposable | Promise<void | Disposable>): Disposable {
    const scope = this.scopes.get(pluginId)
    if (!scope?.alive) return () => {}
    let alive = true
    let inner: void | Disposable
    const cleanups = this.mounts.get(id) ?? new Set<Disposable>()
    const cleanup = () => {
      if (!alive) return
      alive = false
      cleanups.delete(cleanup)
      try { if (inner) inner() } catch (error) { this.recordError(pluginId, error) }
      container.replaceChildren()
    }
    cleanups.add(cleanup)
    this.mounts.set(id, cleanups)
    try {
      Promise.resolve(fn()).then(dispose => {
        if (!alive || !scope.alive) { if (typeof dispose === 'function') dispose() }
        else inner = dispose
      }).catch(error => {
        const showError = alive && scope.alive
        cleanup()
        this.recordError(pluginId, error)
        if (showError) container.textContent = `插件视图加载失败：${message(error)}`
      })
    } catch (error) {
      const showError = alive && scope.alive
      cleanup()
      this.recordError(pluginId, error)
      if (showError) container.textContent = `插件视图加载失败：${message(error)}`
    }
    return cleanup
  }
  mountView(id: string, container: HTMLElement): Disposable {
    const view = this.state.views.find(item => item.id === id && item.open)
    if (!view) return () => {}
    return this.mount('views:' + id, view.pluginId, container, () => view.mount(container, { id, pluginId: view.pluginId, location: view.location, close: () => this.closeView(id) }))
  }
  mountSettings(id: string, container: HTMLElement): Disposable {
    const setting = this.state.settings.find(item => item.id === id)
    return setting ? this.mount('settings:' + id, setting.pluginId, container, () => setting.mount(container)) : () => {}
  }
}

export const pluginRuntime = new PluginRuntime()
