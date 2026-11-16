/** Public API v1 for trusted Locknote AI desktop plugins. */
export type Disposable = () => void
export type ViewLocation = 'left' | 'right' | 'main' | 'bottom'
export type PluginData = Record<string, unknown>
export interface PluginDataSnapshot { data: PluginData; revision: string }
export interface PluginAPIError extends Error { code: string; status?: number }
export interface PluginManifest {
  id: string
  name: string
  version: string
  apiVersion: number
  minAppVersion: string
  entry: string
  styles?: string
  description?: string
  author?: string
  capabilities: string[]
  activationEvents?: string[]
  defaultLocale?: string
  locales?: Record<string, Record<string, string>>
  commands?: Array<{ id: string; title: string; titleKey?: string; hotkey?: string }>
}
export interface PluginRecord { manifest: PluginManifest; enabled: boolean; installedAt: string; digest?: string }
export interface PluginInstallPreview {
 manifest: PluginManifest
 digest: string
 action: 'install' | 'upgrade' | 'downgrade' | 'replace' | 'identical'
 replaces?: PluginRecord
 sameName?: PluginRecord[]
}
export interface PluginNote {
  id: string
  title: string
  content?: string
  version: number
  notebookId?: string
  notebook?: string
  pinned?: boolean
  tags?: string[]
  [key: string]: unknown
}
/** Editor buffer paired with its most recent persisted version. */
export interface CurrentPluginNote extends PluginNote { content: string; unsaved: boolean }
export interface NoteCreateInput { title?: string; content?: string; tags?: string[]; notebook?: string; notebookId?: string; pinned?: boolean }
export interface NoteUpdateInput extends NoteCreateInput { expectedVersion: number }
export type NotePatch = NoteUpdateInput
export interface NoteChangeInput { before?: PluginNote | null; after: NoteCreateInput; summary?: string }
export interface NoteChangeResult { saved: boolean; cancelled?: boolean; deferred?: boolean; changeId: string; id?: string; title?: string; version?: number }
export interface NoteChangeInfo { id: string; pluginId: string; state: 'pending' | 'applied' | 'discarded' | 'undone'; title: string; noteId?: string; summary: string; createdAt: string; error?: string }
export interface NoteQuery {
 q?: string
 scope?: 'all' | 'trash' | 'pinned' | 'uncategorized' | 'recent' | 'ai' | 'notebook' | 'tag' | 'source'
 notebook?: string
 tag?: string
 sort?: 'updated' | 'created' | 'title' | 'words'
 limit?: number
 offset?: number
 withBody?: '0' | '1'
}
export interface PluginEventMap {
 'note:selection': CurrentPluginNote | null
 'editor:change': CurrentPluginNote | null
 'editor:selection': CurrentPluginNote | null
 'note:change': { note?: PluginNote; noteId?: string; version?: number; type?: string; source?: string; pluginId?: string }
 'changes:change': { pluginId?: string }
 'language:change': { locale: string }
 'theme:change': { theme: string | null; fontSize: string | null }
 'workspace:ready': Record<string, never>
 'workspace:closing': Record<string, never>
}
export interface PluginHostInfo { readonly apiVersion: 1; readonly features: readonly string[]; hasFeature(name: string): boolean }
export interface Selection { text: string; start: number; end: number }
export interface PluginHost {
  notes: {
    current(pluginId: string): Promise<CurrentPluginNote | null>
    list(query: NoteQuery | undefined, pluginId: string): Promise<{ notes: PluginNote[]; total: number }>
    get(id: string, pluginId: string): Promise<PluginNote | null>
    create(input: NoteCreateInput, pluginId: string): Promise<PluginNote>
    update(id: string, patch: NoteUpdateInput, pluginId: string): Promise<PluginNote>
  }
  editor: {
    getSelection(pluginId: string): Promise<Selection>
    replaceSelection(text: string, pluginId: string): Promise<void>
    insertText(text: string, pluginId: string): Promise<void>
  }
  workspace: { openNote(id: string): Promise<void>; revealLine?(line: number): void }
  ui: { notify(message: string): void; confirm(message: string): Promise<boolean> }
}
export interface PluginCommand { id: string; title: string; titleKey?: string; hotkey?: string; run(): void | Promise<void> }
export interface RegisteredCommand extends PluginCommand { pluginId: string; lazy?: boolean }
export interface ViewContext { id: string; pluginId: string; location: ViewLocation; close(): void }
export interface PluginView {
  id: string
  title: string
  location: ViewLocation
  titleKey?: string
  showInNavigation?: boolean
  mount(container: HTMLElement, context: ViewContext): void | Disposable | Promise<void | Disposable>
}
export interface RegisteredView extends PluginView { pluginId: string; open: boolean }
export interface PluginMenu { id: string; title: string; titleKey?: string; context: 'note' | 'editor' | 'notebook'; run(context?: unknown): void | Promise<void> }
export interface RegisteredMenu extends PluginMenu { pluginId: string }
export interface PluginButton { id: string; title: string; titleKey?: string; text?: string; textKey?: string; run(): void | Promise<void> }
export interface RegisteredButton extends PluginButton { pluginId: string }
export interface PluginSetting { id: string; title: string; titleKey?: string; mount(container: HTMLElement): void | Disposable | Promise<void | Disposable> }
export interface RegisteredSetting extends PluginSetting { pluginId: string }
export interface PluginLog { pluginId: string; level: 'info' | 'error'; message: string; time: string }
export interface PluginSnapshot {
  available: boolean
  loading: boolean
  directory: string
  records: PluginRecord[]
  active: string[]
  commands: RegisteredCommand[]
  views: RegisteredView[]
  openViews: RegisteredView[]
  activeViews: Partial<Record<ViewLocation, string>>
  toolbar: RegisteredButton[]
  status: RegisteredButton[]
  menus: RegisteredMenu[]
  settings: RegisteredSetting[]
  logs: PluginLog[]
  errors: Record<string, string>
  safeMode: boolean
}
export interface AIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_call_id?: string
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  reasoning_content?: string
}
export interface AIChatRequest {
  baseURL: string
  apiKey?: string
  model: string
  messages: AIChatMessage[]
  maxTokens?: number
  tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }>
}
export interface AIUsage { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }
export interface AIChatResponse { choices: Array<{ message: AIChatMessage; finish_reason?: string }>; usage?: AIUsage }
export interface Conversation { id: string; title: string; createdAt: string; updatedAt: string; seq: number }
export interface ConversationEvent { type: string; seq?: number; [key: string]: unknown }
export interface ConversationPage extends Conversation { events: ConversationEvent[]; checkpoint?: ConversationEvent; before: number; recovered: boolean }
export interface ConversationList { items: Conversation[]; activeId: string; next: number; warnings?: string[] }
export interface PluginContext {
  readonly host: PluginHostInfo
  changes: { review(input: NoteChangeInput, options?: { signal?: AbortSignal }): Promise<NoteChangeResult>; list(): NoteChangeInfo[]; open(id: string): void; undo(id: string): Promise<NoteChangeResult> }
  manifest: Readonly<PluginManifest>
  i18n: { readonly locale: string; t(key: string, params?: Record<string, string | number>, fallback?: string): string }
  commands: { register(command: PluginCommand): Disposable }
  views: { register(view: PluginView): Disposable }
  menus: { register(menu: PluginMenu): Disposable }
  toolbar: { register(button: PluginButton): Disposable }
  status: { register(button: PluginButton): Disposable }
  settings: { register(setting: PluginSetting): Disposable }
  notes: {
    current(): Promise<CurrentPluginNote | null>
    list(query?: NoteQuery): Promise<{ notes: PluginNote[]; total: number }>
    get(id: string): Promise<PluginNote | null>
    create(input: NoteCreateInput): Promise<PluginNote>
    update(id: string, patch: NoteUpdateInput): Promise<PluginNote>
  }
  editor: { getSelection(): Promise<Selection>; replaceSelection(text: string): Promise<void>; insertText(text: string): Promise<void> }
  workspace: { openNote(id: string): Promise<void>; openView(id: string): Promise<void>; toggleView(id: string): Promise<void>; closeView(id: string): void; revealLine(line: number): void }
  events: { on<K extends keyof PluginEventMap>(name: K, callback: (payload: PluginEventMap[K]) => void | Promise<void>): Disposable }
  ai: { chatCompletion(request: AIChatRequest, options?: { signal?: AbortSignal }): Promise<AIChatResponse>; listModels(provider: { baseURL: string; apiKey?: string }, options?: { signal?: AbortSignal }): Promise<{ models: string[] }> }
  conversations: {
    list(offset?: number): Promise<ConversationList>
    create(title: string): Promise<Conversation>
    read(id: string, before?: number): Promise<ConversationPage>
    append(id: string, expectedSeq: number, events: ConversationEvent[]): Promise<Conversation>
    activate(id: string): Promise<void>
    rename(id: string, title: string): Promise<void>
    delete(id: string): Promise<void>
  }
  storage: { get(): Promise<PluginData>; set(data: PluginData): Promise<void>; snapshot(): Promise<PluginDataSnapshot>; compareAndSet(data: PluginData, expectedRevision: string): Promise<PluginDataSnapshot> }
  ui: { notify(message: string): void; confirm(message: string): Promise<boolean> }
  resources: { assetURL(path: string): string }
  timers: { setTimeout(callback: () => void, delay: number): Disposable; setInterval(callback: () => void, delay: number): Disposable }
  onDispose(dispose: Disposable): Disposable
}
export interface PluginModule {
  default?: { activate(context: PluginContext): void | Disposable | Promise<void | Disposable>; deactivate?(): void | Promise<void> }
  activate?(context: PluginContext): void | Disposable | Promise<void | Disposable>
  deactivate?(): void | Promise<void>
}
