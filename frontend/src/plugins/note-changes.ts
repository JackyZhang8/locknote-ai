import type { CurrentPluginNote, NoteChangeInfo, NoteChangeInput, NoteChangeResult, NoteCreateInput, NoteUpdateInput, PluginNote } from './types.js'
type Notes = { reveal?(id: string): Promise<void>; current(): Promise<CurrentPluginNote | null>; get(id: string): Promise<PluginNote | null>; update(id: string, input: NoteUpdateInput): Promise<PluginNote>; create(input: NoteCreateInput): Promise<PluginNote> }
export interface ChangeEntry extends NoteChangeInfo { before: PluginNote | null; after: NoteCreateInput; applied?: PluginNote; busy: boolean; recovered?: boolean; retained?: boolean }
type Snapshot = { entries: ChangeEntry[]; activeId: string | null; warning: string }
const key = 'locknote-note-change-checkpoints-v1'
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const textFields = (note: NoteCreateInput): NoteCreateInput => ({ title: String(note.title ?? ''), content: String(note.content ?? ''), tags: [...(note.tags ?? [])], ...(note.notebook !== undefined ? { notebook: note.notebook } : {}), ...(note.notebookId !== undefined ? { notebookId: note.notebookId } : {}), ...(note.pinned !== undefined ? { pinned: note.pinned } : {}) })
const footprint = (entries: ChangeEntry[]) => JSON.stringify(entries).length + entries.filter(entry => entry.state === 'pending').reduce((size, entry) => size + JSON.stringify(entry.after).length + 2048, 0)
function validate(note: NoteCreateInput) {
 if (!note || typeof note !== 'object' || (note.title !== undefined && typeof note.title !== 'string') || (note.content !== undefined && typeof note.content !== 'string') || (note.tags !== undefined && (!Array.isArray(note.tags) || note.tags.length > 100 || note.tags.some(tag => typeof tag !== 'string' || tag.length > 100)))) throw new Error('无效草稿 / Invalid draft')
 if ((note.notebook !== undefined && (typeof note.notebook !== 'string' || note.notebook.length > 1000)) || (note.notebookId !== undefined && (typeof note.notebookId !== 'string' || note.notebookId.length > 200)) || (note.pinned !== undefined && typeof note.pinned !== 'boolean')) throw new Error('无效分类或置顶 / Invalid notebook or pinned metadata')
 if ((note.content?.length ?? 0) > 1000000 || (note.title?.length ?? 0) > 1000) throw new Error('草稿过大 / Draft too large')
}
function same(a: PluginNote, b: PluginNote) { return a.version === b.version && a.title === b.title && (a.content || '') === (b.content || '') && JSON.stringify(a.tags || []) === JSON.stringify(b.tags || []) && (a.notebookId || '') === (b.notebookId || '') && !!a.pinned === !!b.pinned }
export class NoteChangeManager {
 private state: Snapshot = { entries: [], activeId: null, warning: '' }
 private listeners = new Set<() => void>()
 private bindings = new Map<string, Notes>()
 private waiting = new Map<string, (value: NoteChangeResult) => void>()
 private sequence = 0
 private cancelled = new Set<string>()
 private persistTimer?: ReturnType<typeof setTimeout>
 constructor(private storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  try {
   const raw = storage?.getItem(key);if (!raw || raw.length > 4000000) return
   const entries: ChangeEntry[] = JSON.parse(raw)
   if (!Array.isArray(entries)) return
   this.state.entries = entries.slice(-20).filter(item => {
    try { validate(item.after);if (item.before) validate(item.before);if (item.applied) validate(item.applied);return typeof item.id === 'string' && typeof item.pluginId === 'string' && ['pending','applied','discarded','undone'].includes(item.state) } catch { return false }
   }).map(item => ({ ...item, busy: false, recovered: true, retained: item.state === 'pending' || item.retained, error: item.busy ? '上次操作被中断，请核对笔记与历史版本 / Previous operation interrupted; check note history' : undefined }))
  } catch { this.state.warning = '无法恢复改动记录 / Unable to restore change records' }
 }
 getSnapshot = () => this.state
 subscribe = (fn: () => void) => { this.listeners.add(fn);return () => { this.listeners.delete(fn) } }
 register(pluginId: string, notes: Notes) { this.bindings.set(pluginId, notes);return () => { this.bindings.delete(pluginId);for (const entry of this.state.entries) if (entry.pluginId === pluginId && entry.state === 'pending' && !entry.retained) { this.cancelled.add(entry.id);if (!entry.busy) this.discard(entry.id) } } }
 private persist() {
  if (this.persistTimer) clearTimeout(this.persistTimer);this.persistTimer = undefined
  try { this.storage?.setItem(key, JSON.stringify(this.state.entries)) } catch { this.state.warning = '改动记录未能保存到本机；请勿依赖重启恢复 / Checkpoint storage failed' }
 }
 private publish(defer = false) {
  this.state = { ...this.state, entries: [...this.state.entries] }
  if (defer) { if (this.persistTimer) clearTimeout(this.persistTimer);this.persistTimer = setTimeout(() => { this.persist();this.state = { ...this.state };for (const listener of this.listeners) listener() }, 400) } else this.persist()
  for (const listener of this.listeners) listener()
 }
 private entry(id: string, pluginId?: string) { const value = this.state.entries.find(item => item.id === id && (!pluginId || item.pluginId === pluginId));if (!value) throw new Error('改动不存在 / Change not found');return value }
 private notes(entry: ChangeEntry) { const value = this.bindings.get(entry.pluginId);if (!value) throw new Error('请先启用对应插件 / Enable the originating plugin first');return value }
 list(pluginId: string): NoteChangeInfo[] { return this.state.entries.filter(entry => entry.pluginId === pluginId).map(({ id, pluginId, state, title, noteId, summary, createdAt, error }) => ({ id, pluginId, state, title, noteId, summary, createdAt, error })) }
 open(id: string, pluginId?: string) { this.entry(id, pluginId);this.state.activeId = id;this.publish() }
 close() { if (this.state.entries.some(entry => entry.id === this.state.activeId && entry.busy)) return;this.state.activeId = null;this.publish() }
 retain(id: string) {
  const entry = this.entry(id)
  if (entry.busy || entry.state !== 'pending') throw new Error('草稿状态已变化 / Draft state changed')
  const previous = entry.retained;entry.retained = true
  try {
   if (!this.storage) throw new Error('本机存储不可用 / Local storage unavailable')
   this.storage.setItem(key, JSON.stringify(this.state.entries))
  } catch { entry.retained = previous;throw new Error('建议稿保留失败，请继续审阅或应用修改 / Unable to retain draft; continue reviewing or apply it') }
  this.finish(entry, { saved: false, deferred: true, changeId: id })
  if (this.state.activeId === id) this.state.activeId = null
  this.publish()
 }
 async applyAndClose(id: string) {
  await this.apply(id)
  if (this.state.activeId !== id) return
  const entry = this.entry(id), notes = this.bindings.get(entry.pluginId)
  if (entry.applied && notes?.reveal) {
   entry.busy = true;this.publish()
   try { await notes.reveal(entry.applied.id) }
   catch { entry.error = '笔记已保存，但无法打开；请从笔记列表查看 / Note saved, but could not be opened; find it in the note list';throw new Error(entry.error) }
   finally { entry.busy = false;this.publish() }
  }
  if (this.state.activeId === id) this.close()
 }
 async review(pluginId: string, input: NoteChangeInput, signal?: AbortSignal): Promise<NoteChangeResult> {
  if (signal?.aborted) throw new Error('已取消 / Cancelled')
  if (!this.bindings.has(pluginId)) throw new Error('插件不可用 / Plugin unavailable')
  validate(input.after);if (input.before) { validate(input.before);if (!Number.isInteger(input.before.version) || input.before.version < 1 || typeof input.before.content !== 'string') throw new Error('请完整读取原文 / Read the full original note') }
  if (this.state.entries.some(item => item.state === 'pending' && item.pluginId === pluginId)) throw new Error('请先处理已有草稿 / Resolve the existing draft first')
  const before = input.before ? copy(input.before) : null
  const after = textFields({ ...(before || {}), ...input.after })
  if (input.after.notebook !== undefined && input.after.notebookId === undefined) delete after.notebookId
  if (input.after.notebookId !== undefined && input.after.notebook === undefined) delete after.notebook
  const entry: ChangeEntry = { id: globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + '-' + ++this.sequence, pluginId, state: 'pending', title: after.title || '未命名 / Untitled', noteId: before?.id, summary: String(input.summary || '').slice(0, 500), createdAt: new Date().toISOString(), before, after, busy: false }
  const retained = this.state.entries.slice()
  while (retained.length >= 20 || footprint([...retained, entry]) > 3500000) { const index = retained.findIndex(item => item.state !== 'pending' && !item.busy);if (index < 0) throw new Error('草稿空间不足，请先处理或丢弃已有草稿 / Draft storage limit reached');retained.splice(index, 1) }
  this.state.entries = [...retained, entry];this.state.activeId = entry.id
  return new Promise(resolve => {
   const abort = () => { this.cancelled.add(entry.id);if (!entry.busy && entry.state === 'pending') this.discard(entry.id) }
   this.waiting.set(entry.id, result => { signal?.removeEventListener('abort', abort);resolve(result) });signal?.addEventListener('abort', abort, { once: true });this.publish();if (signal?.aborted) abort()
  })
 }
 edit(id: string, patch: NoteCreateInput) { const entry = this.entry(id);if (entry.busy || entry.state !== 'pending') throw new Error('草稿不可编辑 / Draft is not editable');validate(patch);const candidate = textFields({ ...entry.after, ...patch });if (patch.notebook !== undefined && patch.notebookId === undefined) delete candidate.notebookId;if (patch.notebookId !== undefined && patch.notebook === undefined) delete candidate.notebook;const old = entry.after;entry.after = candidate;if (footprint(this.state.entries) > 3500000) { entry.after = old;throw new Error('草稿空间不足 / Draft storage limit reached') }entry.title = String(entry.after.title || '未命名 / Untitled');entry.error = '';this.publish(true) }
 private finish(entry: ChangeEntry, result: NoteChangeResult) { const resolve = this.waiting.get(entry.id);this.waiting.delete(entry.id);this.cancelled.delete(entry.id);resolve?.(result) }
 discard(id: string) { const entry = this.entry(id);if (entry.busy || entry.state !== 'pending') return;entry.state = 'discarded';this.finish(entry, { saved: false, cancelled: true, changeId: id });this.publish() }
 async apply(id: string) {
  const entry = this.entry(id);if (entry.busy || entry.state !== 'pending') throw new Error('改动状态已变化 / Change state changed')
  const notes = this.notes(entry), candidate = copy(entry.after);entry.busy = true;entry.error = '';this.publish()
  try {
   if (entry.before) {
    const current = await notes.current();if (current?.id === entry.before.id && current.unsaved) throw new Error('当前笔记有未保存编辑，请先保存 / Unsaved editor changes')
    const persisted = await notes.get(entry.before.id);if (!persisted || !same(persisted, entry.before)) throw new Error('笔记已变化，保留草稿，请重新生成或核对 / Version conflict; regenerate against the latest note')
   }
   if (this.cancelled.has(id) || this.bindings.get(entry.pluginId) !== notes) throw new Error('已取消 / Cancelled')
   const saved = entry.before ? await notes.update(entry.before.id, { ...candidate, expectedVersion: entry.before.version }) : await notes.create(candidate)
   entry.applied = copy(saved);entry.noteId = saved.id;entry.state = 'applied';entry.recovered = false
   this.finish(entry, { saved: true, changeId: id, id: saved.id, title: saved.title, version: saved.version })
  } catch (error) { entry.error = error instanceof Error ? error.message : String(error);throw error }
  finally { entry.busy = false;if (entry.state === 'pending' && this.cancelled.has(id)) this.discard(id);this.publish() }
 }
 async undo(pluginId: string, id: string): Promise<NoteChangeResult> {
  const entry = this.entry(id, pluginId);if (entry.busy || entry.state !== 'applied' || !entry.applied || !entry.before) throw new Error('此改动不能直接撤回 / Change cannot be undone')
  const notes = this.notes(entry);entry.busy = true;entry.error = '';this.publish()
  try {
   const current = await notes.current();if (current && current.id === entry.noteId && current.unsaved) throw new Error('请先保存编辑 / Unsaved editor changes')
   const persisted = await notes.get(entry.applied.id);if (!persisted || !same(persisted, entry.applied)) throw new Error('应用后笔记又有变化，不能覆盖后续编辑；请从历史版本对比恢复 / Later edits prevent safe undo')
   const saved = await notes.update(entry.applied.id, { ...textFields(entry.before), notebookId: entry.before.notebookId || '', notebook: entry.before.notebook || '', pinned: !!entry.before.pinned, expectedVersion: entry.applied.version });entry.state = 'undone'
   return { saved: true, changeId: id, id: saved.id, title: saved.title, version: saved.version }
  } catch (error) { entry.error = error instanceof Error ? error.message : String(error);throw error }
  finally { entry.busy = false;this.publish() }
 }
}
export { diffLines } from '../history/diff.js'
let storage: Storage | undefined
try { storage = typeof window === 'undefined' ? undefined : window.localStorage } catch {}
export const noteChanges = new NoteChangeManager(storage)
