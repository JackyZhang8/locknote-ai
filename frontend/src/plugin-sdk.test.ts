import test from 'node:test'
import assert from 'node:assert/strict'
import type { PluginContext, PluginNote } from './plugins/types.js'

// Compiled by both application and test builds; never invokes a live host.
function checkSDK(ctx: PluginContext, note: PluginNote) {
  const version: number = note.version
  void ctx.notes.create({ title: 'New note', content: '', pinned: false })
  void ctx.notes.update(note.id, { content: 'Updated', expectedVersion: version })
  // @ts-expect-error Updates must include the version originally read.
  void ctx.notes.update(note.id, { content: 'Unsafe update' })
  // @ts-expect-error Creation does not accept an update precondition.
  void ctx.notes.create({ title: 'New', expectedVersion: 1 })
  void ctx.notes.current().then(current => {
    if (!current) return
    const content: string = current.content
    const unsaved: boolean = current.unsaved
    return { content, unsaved }
  })
}

test('SDK declarations enforce versioned writes and explicit editor state', () => {
  assert.equal(typeof checkSDK, 'function')
})

function checkTypedExtensions(ctx: PluginContext) {
 void ctx.notes.list({ q: 'query', notebook: 'nb_1', sort: 'title', limit: 40, offset: 0, withBody: '1' })
 // @ts-expect-error Query misspellings must not silently list all notes.
 void ctx.notes.list({ qurey: 'bad' })
 // @ts-expect-error Pagination is numeric.
 void ctx.notes.list({ offset: 'forty' })
 ctx.events.on('note:selection', note => { const id: string | undefined = note?.id;void id })
 ctx.events.on('language:change', event => { const locale: string = event.locale;void locale })
 ctx.events.on('changes:change', () => {})
 // @ts-expect-error Misspelled host events never fire.
 ctx.events.on('note:seletion', () => {})
 void ctx.host.hasFeature('storage.cas')
 void ctx.storage.snapshot().then(snapshot => ctx.storage.compareAndSet({ ...snapshot.data, example: true }, snapshot.revision))
}
test('SDK extensions expose typed events queries and conditional configuration writes', () => { assert.equal(typeof checkTypedExtensions, 'function') })
