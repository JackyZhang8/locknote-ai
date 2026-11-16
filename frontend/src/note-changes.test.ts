import test from 'node:test'
import assert from 'node:assert/strict'
import { NoteChangeManager, diffLines } from './plugins/note-changes.js'
import type { PluginNote } from './plugins/types.js'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NoteChangeReview, PendingNoteDrafts } from './plugins/NoteChangeReview.js'
import { noteChanges } from './plugins/note-changes.js'
test('review renders escaped differences and separate apply discard footer', async () => {
 const before = { id: 'render', title: 'Original', content: 'Old', version: 1 }
 const unregister = noteChanges.register('render.test', { current: async () => null, get: async () => before, update: async () => before, create: async () => before })
 const pending = noteChanges.review('render.test', { before, after: { content: '<script>unsafe</script>' } })
 const html = renderToStaticMarkup(createElement(NoteChangeReview))
 assert.equal(html.includes('&lt;script&gt;unsafe&lt;/script&gt;'), true);assert.equal(html.includes('<script>'), false)
 assert.equal(html.includes('<footer>'), true);assert.equal(html.includes('应用修改'), true);assert.equal(html.includes('丢弃'), true)
 noteChanges.discard(noteChanges.getSnapshot().activeId!);await pending;unregister();noteChanges.close()
})
function fixture() {
 let note: PluginNote = { id: 'n1', title: 'Original', content: 'first\nsecond', tags: ['old'], version: 3 }, unsaved = false, writes = 0
 const data = new Map<string, string>()
 const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
 const manager = new NoteChangeManager(storage)
 manager.register('plugin.test', {
  current: async () => ({ ...note, content: note.content || '', unsaved }), get: async () => ({ ...note }),
  update: async (id, patch) => { if (patch.expectedVersion !== note.version) throw new Error('conflict');writes++;note = { ...note, ...patch, id, version: note.version + 1 };return { ...note } },
  create: async input => { writes++;return { id: 'new', title: '', version: 1, ...input } },
 })
 return { manager, storage, get note() { return { ...note } }, get writes() { return writes }, edit(value: Partial<PluginNote>) { note = { ...note, ...value } }, dirty() { unsaved = true } }
}
async function start(f: ReturnType<typeof fixture>) {
 const result = f.manager.review('plugin.test', { before: f.note, after: { content: 'first\nadded\nsecond' } })
 await new Promise(resolve => setTimeout(resolve, 0))
 return { result, id: f.manager.getSnapshot().entries.slice(-1)[0].id }
}
async function rejects(run: () => Promise<unknown>) { let failed = false;try { await run() } catch { failed = true }assert.equal(failed, true) }
test('draft stays separate and applies exactly the manually edited candidate', async () => {
 const f = fixture(), { result, id } = await start(f)
 assert.equal(f.writes, 0);assert.equal(f.note.content, 'first\nsecond')
 f.manager.edit(id, { title: 'Edited', content: 'manual draft', tags: ['new'] })
 await f.manager.apply(id);const receipt = await result
 assert.equal(receipt.saved, true);assert.equal(f.writes, 1);assert.equal(f.note.content, 'manual draft');assert.equal(f.note.title, 'Edited')
 await f.manager.undo('plugin.test', id);assert.equal(f.note.content, 'first\nsecond');assert.equal(f.note.version, 5)
})
test('review and undo reject concurrent edits without overwriting user work', async () => {
 const f = fixture(), { result, id } = await start(f)
 f.edit({ version: 4, content: 'user edit' });await rejects(() => f.manager.apply(id));assert.equal(f.writes, 0)
 f.manager.discard(id);assert.equal((await result).saved, false)
 const next = await start(f);await f.manager.apply(next.id);await next.result
 f.edit({ version: 6, content: 'later edit' });await rejects(() => f.manager.undo('plugin.test', next.id));assert.equal(f.note.content, 'later edit')
})
test('cancel leaves no write and restored drafts require explicit review', async () => {
 const f = fixture(), controller = new AbortController()
 const result = f.manager.review('plugin.test', { before: f.note, after: { content: 'draft' } }, controller.signal)
 await new Promise(resolve => setTimeout(resolve, 0));controller.abort();assert.equal((await result).saved, false);assert.equal(f.writes, 0)
 const pending = await start(f);f.manager.close()
 const restored = new NoteChangeManager(f.storage);assert.equal(restored.getSnapshot().activeId, null)
 assert.equal(restored.getSnapshot().entries.find(item => item.id === pending.id)?.state, 'pending')
 f.manager.discard(pending.id);await pending.result
})
test('unsaved editor blocks apply and double apply cannot save twice', async () => {
 const f = fixture(), pending = await start(f);f.dirty();await rejects(() => f.manager.apply(pending.id));assert.equal(f.writes, 0);f.manager.discard(pending.id);await pending.result
 const g = fixture(), next = await start(g);const results = await Promise.allSettled([g.manager.apply(next.id), g.manager.apply(next.id)]);assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);await next.result;assert.equal(g.writes, 1)
})
test('line diff preserves both sources and bounds pathological work', () => {
 const changes = diffLines('a\nb', 'a\nnew\nb');assert.equal(changes.some(line => line.kind === 'add' && line.text === 'new'), true)
 assert.equal(changes.filter(line => line.kind !== 'add').map(line => line.text).join('\n'), 'a\nb')
 assert.equal(changes.filter(line => line.kind !== 'remove').map(line => line.text).join('\n'), 'a\nnew\nb')
 assert.equal(diffLines('a\n'.repeat(3000), 'b\n'.repeat(3000)).length > 0, true)
})
test('new notes are created only after approval and discarded drafts never write', async () => {
 const f = fixture(), result = f.manager.review('plugin.test', { after: { title: 'New', content: 'Draft' } })
 const id = f.manager.getSnapshot().entries[0].id;assert.equal(f.writes, 0)
 await f.manager.apply(id);assert.equal((await result).saved, true);assert.equal(f.writes, 1)
 await rejects(() => f.manager.undo('plugin.test', id))
 const another = f.manager.review('plugin.test', { after: { title: 'Discard', content: 'No' } })
 f.manager.discard(f.manager.getSnapshot().entries[1].id);assert.equal((await another).saved, false);assert.equal(f.writes, 1)
})
test('cancelling during validation prevents the write from starting', async () => {
 const manager = new NoteChangeManager(), controller = new AbortController();let writes = 0, release!: () => void
 const before = { id: 'n', title: 'N', content: 'old', version: 1 }
 manager.register('p', { current: () => new Promise(resolve => { release = () => resolve(null) }), get: async () => before, create: async () => before, update: async () => { writes++;return before } })
 const result = manager.review('p', { before, after: { content: 'new' } }, controller.signal)
 const id = manager.getSnapshot().entries[0].id, applying = manager.apply(id)
 controller.abort();release();await rejects(() => applying);assert.equal(writes, 0);assert.equal((await result).saved, false)
})

test('explicitly retained draft survives cancellation disposal and restart without saving', async () => {
 const f = fixture(), controller = new AbortController()
 const result = f.manager.review('plugin.test', { before: f.note, after: { content: 'Retained text' } }, controller.signal)
 const id = f.manager.getSnapshot().activeId!
 f.manager.retain(id)
 const receipt = await result
 assert.equal(receipt.saved, false);assert.equal(receipt.deferred, true);assert.equal(receipt.cancelled, undefined)
 assert.equal(f.manager.getSnapshot().activeId, null);assert.equal(f.writes, 0)
 controller.abort()
 const unregister = f.manager.register('plugin.test', { current: async () => null, get: async () => f.note, update: async () => f.note, create: async () => f.note })
 unregister()
 assert.equal(f.manager.getSnapshot().entries[0].state, 'pending')
 const restored = new NoteChangeManager(f.storage)
 assert.equal(restored.getSnapshot().entries[0].after.content, 'Retained text')
 const dispose = restored.register('plugin.test', { current: async () => null, get: async () => f.note, update: async () => f.note, create: async () => f.note });dispose()
 assert.equal(restored.getSnapshot().entries[0].state, 'pending')
})
test('retain then apply checks original revision and only closes after successful save', async () => {
 const f = fixture(), { result, id } = await start(f)
 f.manager.retain(id);await result;f.manager.open(id)
 f.edit({ version: 4 });await rejects(() => f.manager.applyAndClose(id))
 assert.equal(f.manager.getSnapshot().activeId, id);assert.equal(f.writes, 0)
 f.edit({ version: 3 });await f.manager.applyAndClose(id)
 assert.equal(f.manager.getSnapshot().activeId, null);assert.equal(f.writes, 1)
})
test('busy saving cannot be minimized or retained and a new active review is not closed', async () => {
 const manager = new NoteChangeManager();let release!: () => void
 const before = { id: 'n', title: 'N', content: 'old', version: 1 }
 manager.register('p', { current: () => new Promise(resolve => { release = () => resolve(null) }), get: async () => before, create: async () => before, update: async () => ({ ...before, version: 2 }) })
 const result = manager.review('p', { before, after: { content: 'new' } });const id = manager.getSnapshot().activeId!
 const applying = manager.applyAndClose(id);manager.close();assert.equal(manager.getSnapshot().activeId, id)
 assert.throws(() => manager.retain(id))
 release();await applying;await result
})

test('failed checkpoint retention keeps proposal active and cancellable', async () => {
 let fail = false
 const manager = new NoteChangeManager({ getItem: () => null, setItem: () => { if (fail) throw new Error('quota') } })
 const note = { id: 'n', title: 'N', content: '', version: 1 }
 manager.register('p', { current: async () => null, get: async () => note, update: async () => note, create: async () => note })
 const controller = new AbortController(), result = manager.review('p', { after: { content: 'draft' } }, controller.signal), id = manager.getSnapshot().activeId!
 fail = true;assert.throws(() => manager.retain(id));assert.equal(manager.getSnapshot().activeId, id)
 assert.equal(manager.getSnapshot().entries[0].retained, undefined)
 controller.abort();assert.equal((await result).cancelled, true)
})

test('pending banner exposes untargeted new drafts and excludes completed records', () => {
 const base = { id: 'draft', pluginId: 'p', state: 'pending' as const, title: 'New AI note', summary: '', createdAt: '', before: null, after: { content: 'Text' }, busy: false }
 const pending = renderToStaticMarkup(createElement(PendingNoteDrafts, { entries: [base] }))
 assert.equal(pending.includes('继续审阅'), true);assert.equal(pending.includes('New AI note'), true)
 assert.equal(renderToStaticMarkup(createElement(PendingNoteDrafts, { entries: [{ ...base, state: 'applied' }] })), '')
})

test('apply and minimize reveals the saved new note before closing review', async () => {
 const manager = new NoteChangeManager();let revealed = '', visibleDuringReveal: string | null = null
 const note = { id: 'created', title: 'Written note', content: 'Text', version: 1 }
 manager.register('p', { current: async () => null, get: async () => note, create: async () => note, update: async () => note, reveal: async id => { revealed = id;visibleDuringReveal = manager.getSnapshot().activeId } })
 const result = manager.review('p', { after: { title: note.title, content: note.content } }), id = manager.getSnapshot().activeId!
 await manager.applyAndClose(id);await result
 assert.equal(revealed, 'created');assert.equal(visibleDuringReveal, id);assert.equal(manager.getSnapshot().activeId, null)
})
test('finishing one apply does not close another plugin review', async () => {
 const manager = new NoteChangeManager();let release!: () => void
 const note = { id: 'created', title: 'N', content: 'Text', version: 1 }
 const notes = { current: async () => null, get: async () => note, create: () => new Promise<PluginNote>(resolve => { release = () => resolve(note) }), update: async () => note }
 manager.register('p', notes);manager.register('q', notes)
 const first = manager.review('p', { after: { content: 'One' } }), id = manager.getSnapshot().activeId!, applying = manager.applyAndClose(id)
 const second = manager.review('q', { after: { content: 'Two' } }), other = manager.getSnapshot().activeId!
 release();await applying;await first
 assert.equal(manager.getSnapshot().activeId, other);manager.discard(other);await second
})

test('saved note navigation failure does not permit a duplicate create', async () => {
 const manager = new NoteChangeManager();let writes = 0
 const note = { id: 'created', title: 'N', content: 'Text', version: 1 }
 manager.register('p', { current: async () => null, get: async () => note, update: async () => note, create: async () => { writes++;return note }, reveal: async () => { throw new Error('navigation failed') } })
 const result = manager.review('p', { after: { content: 'Text' } }), id = manager.getSnapshot().activeId!
 await rejects(() => manager.applyAndClose(id));assert.equal((await result).saved, true)
 assert.equal(manager.getSnapshot().activeId, id);assert.equal(manager.getSnapshot().entries[0].state, 'applied')
 assert.equal(manager.getSnapshot().entries[0].busy, false)
 await rejects(() => manager.applyAndClose(id));assert.equal(writes, 1)
})

test('review preserves notebook and pinned metadata and undo restores original values', async () => {
 const manager = new NoteChangeManager()
 let note: PluginNote = { id: 'metadata', title: 'Old', content: 'Body', tags: [], notebookId: 'nb_old', notebook: 'Old notebook', pinned: false, version: 1 }
 manager.register('metadata', { current: async () => null, get: async () => note, create: async input => ({ ...note, ...input }), update: async (_id, input) => { note = { ...note, ...input, version: note.version + 1 };return note } })
 const result = manager.review('metadata', { before: note, after: { notebookId: 'nb_new', notebook: 'New notebook', pinned: true } }), id = manager.getSnapshot().activeId!
 await manager.apply(id);await result
 assert.equal(note.notebookId, 'nb_new');assert.equal(note.pinned, true)
 await manager.undo('metadata', id);assert.equal(note.notebookId, 'nb_old');assert.equal(note.pinned, false)
})
test('new reviewed notes retain their requested classification and reject invalid metadata', async () => {
 const manager = new NoteChangeManager();let created: unknown
 manager.register('metadata', { current: async () => null, get: async () => null, create: async input => { created = input;return { id: 'new', title: 'New', version: 1, ...input } }, update: async () => { throw new Error('unexpected') } })
 const result = manager.review('metadata', { after: { title: 'New', notebookId: 'nb_new', pinned: true } })
 await manager.apply(manager.getSnapshot().activeId!);await result
 assert.equal((created as { notebookId: string }).notebookId, 'nb_new');assert.equal((created as { pinned: boolean }).pinned, true)
 await rejects(() => manager.review('metadata', { after: { pinned: 'yes' } as never }))
})

test('review UI discloses notebook and pin changes before applying', async () => {
 const note = { id: 'render-metadata', title: 'Note', content: 'Body', version: 1, notebookId: 'nb_old', notebook: 'Old notebook', pinned: false }
 const cleanup = noteChanges.register('render.metadata', { current: async () => null, get: async () => note, create: async () => note, update: async () => note })
 const pending = noteChanges.review('render.metadata', { before: note, after: { notebookId: 'nb_new', notebook: 'New notebook', pinned: true } })
 const html = renderToStaticMarkup(createElement(NoteChangeReview))
 assert.equal(html.includes('New notebook'), true);assert.equal(html.includes('置顶'), true)
 noteChanges.discard(noteChanges.getSnapshot().activeId!);await pending;cleanup();noteChanges.close()
})

test('review notebook name change does not keep a conflicting old notebook ID', async () => {
 const f = fixture(), pending = await start(f)
 f.manager.edit(pending.id, { notebookId: 'nb_old' });f.manager.edit(pending.id, { notebook: 'Target notebook' })
 assert.equal(f.manager.getSnapshot().entries[0].after.notebookId, undefined)
 f.manager.discard(pending.id);await pending.result
})

test('undo returns a moved note to uncategorized and unpinned original state', async () => {
 const manager = new NoteChangeManager();let note: PluginNote = { id:'uncategorized',title:'N',content:'Body',tags:[],version:1 }
 manager.register('p',{current:async()=>null,get:async()=>note,create:async()=>note,update:async(_id,patch)=>{note={...note,...patch,version:note.version+1};return note}})
 const reviewing=manager.review('p',{before:note,after:{notebookId:'nb_target',pinned:true}}),id=manager.getSnapshot().activeId!
 await manager.apply(id);await reviewing;await manager.undo('p',id)
 assert.equal(note.notebookId,'');assert.equal(note.pinned,false)
})
