import test from 'node:test'
import assert from 'node:assert/strict'
import { PluginRuntime } from './plugins/runtime.js'
import type { PluginContext, PluginRecord, PluginHost } from './plugins/types.js'
import { noteChanges } from './plugins/note-changes.js'

test('change review requires declared read/write capabilities and scopes checkpoints', async () => {
 let context!: PluginContext
 const denied = setup(ctx => { context = ctx })
 await denied.initialize('session');let rejected = false
 try { await context.changes.review({ after: { title: 'Denied', content: 'No' } }) } catch { rejected = true }
 assert.equal(rejected, true);denied.shutdown()
 const allowedRecord = record('review.test');allowedRecord.manifest.capabilities = ['notes.read','notes.write']
 const runtime = setup(ctx => { context = ctx }, [allowedRecord]);await runtime.initialize('session')
 const pending = context.changes.review({ after: { title: 'Review', content: 'Draft' } })
 const id = context.changes.list()[0].id
 assert.equal(noteChanges.getSnapshot().activeId, id)
 assert.throws(() => noteChanges.open(id, 'other.plugin'))
 runtime.shutdown();assert.equal((await pending).cancelled, true);
 assert.throws(() => context.changes.list())
})

const record = (id = 'example.test'): PluginRecord => ({
  manifest: { id, name: id, version: '0.1.0', apiVersion: 1, minAppVersion: '0.1.0', entry: 'main.js', capabilities: ['notes.readCurrent', 'notes.updateCurrent'], activationEvents: ['onStartup'] },
  enabled: true, installedAt: '',
})
const host = (): PluginHost => ({
  notes: { current: async () => null, list: async () => ({ notes: [], total: 0 }), get: async () => null, create: async data => ({ id: 'new', title: '', version: 1, ...data }), update: async (id, patch) => ({ id, title: '', version: patch.expectedVersion + 1, ...patch }) },
  editor: { getSelection: async () => ({ text: '', start: 0, end: 0 }), replaceSelection: async () => {}, insertText: async () => {} },
  workspace: { openNote: async () => {} },
  ui: { notify: () => {}, confirm: async () => true },
})
function setup(activate: (ctx: PluginContext) => void | Promise<void>, records = [record()]) {
  const runtime = new PluginRuntime({
    fetch: async (_input, init) => {
      if (init?.method === 'PUT') return new Response(JSON.stringify({ ok: true }), { status: 200 })
      return new Response(JSON.stringify({ plugins: records, directory: '/data/plugins' }), { status: 200 })
    },
    loadModule: async () => ({ default: { activate } }),
    activationTimeout: 100,
  })
  runtime.setHost(host())
  return runtime
}

test('plugins never execute without a desktop session', async () => {
  let loaded = 0
  const runtime = setup(() => { loaded++ })
  await runtime.initialize('')
  assert.equal(loaded, 0)
  assert.equal(runtime.getSnapshot().available, false)
})

test('ZIP preview and install use lossless text bodies across the desktop bridge', async () => {
  const bytes = new Uint8Array([80, 75, 3, 4, 0, 128, 255, 13, 10])
  const uploads: string[] = []
  const runtime = new PluginRuntime({
    fetch: async (input, init) => {
      const path = String(input)
      if (path.endsWith('/preview') || path.endsWith('/install')) {
        // File-backed Blob bodies can arrive empty through the WebView scheme handler.
        const received = typeof init?.body === 'string' ? init.body : ''
        assert.equal(new Headers(init?.headers).get('X-Locknote-Plugin-Encoding'), 'base64')
        assert.deepEqual(Array.from(atob(received), character => character.charCodeAt(0)), Array.from(bytes))
        uploads.push(path)
        return new Response(JSON.stringify({ manifest: record().manifest, enabled: false }))
      }
      return new Response(JSON.stringify({ plugins: [], directory: '/plugins' }))
    },
  })
  await runtime.initialize('session')
  const file = new Blob([bytes], { type: 'application/zip' })
  await runtime.previewInstall(file)
  await runtime.install(file)
  assert.deepEqual(uploads, ['/api/plugins/preview', '/api/plugins/install'])
})

test('successful management refresh clears a previous host initialization error', async () => {
  const runtime = setup(() => {})
  runtime.recordError('host', new Error('State unavailable'))
  await runtime.initialize('session')
  assert.equal(runtime.getSnapshot().errors.host, undefined)
  assert.equal(runtime.getSnapshot().logs.some(log => log.message === 'State unavailable'), true)
})

test('registrations are namespaced and removed on disable', async () => {
  let disposed = 0
  const runtime = setup(ctx => {
    ctx.commands.register({ id: 'open', title: 'Open', run() {} })
    ctx.views.register({ id: 'outline', title: 'Outline', location: 'right', mount() {} })
    ctx.onDispose(() => { disposed++ })
  })
  await runtime.initialize('session')
  assert.equal(runtime.getSnapshot().commands[0].id, 'example.test:open')
  assert.equal(runtime.isScopeActive('example.test'), true)
  await runtime.openView('example.test:outline')
  assert.equal(runtime.getSnapshot().views[0].open, true)
  await runtime.setEnabled('example.test', false)
  assert.equal(runtime.getSnapshot().commands.length, 0)
  assert.equal(runtime.getSnapshot().views.length, 0)
  assert.equal(disposed, 1)
  assert.equal(runtime.isScopeActive('example.test'), false)
})

test('activation failure cleans partial registrations and preserves other plugins', async () => {
  const runtime = setup(ctx => {
    if (ctx.manifest.id === 'example.bad') {
      ctx.commands.register({ id: 'bad', title: 'Bad', run() {} })
      throw new Error('broken plugin')
    }
    ctx.commands.register({ id: 'good', title: 'Good', run() {} })
  }, [record('example.bad'), record('example.good')])
  await runtime.initialize('session')
  assert.deepEqual(runtime.getSnapshot().commands.map(c => c.id), ['example.good:good'])
  assert.equal(runtime.getSnapshot().errors['example.bad'], 'broken plugin')
})

test('disabled activation cannot register or write after awaiting', async () => {
  let resume: () => void = () => {}
  let late: PluginContext | undefined
  const gate = new Promise<void>(resolve => { resume = resolve })
  const runtime = setup(async ctx => { late = ctx; await gate; ctx.commands.register({ id: 'late', title: 'Late', run() {} }) })
  const starting = runtime.initialize('session')
  await new Promise(resolve => setTimeout(resolve, 0))
  await runtime.setEnabled('example.test', false)
  resume()
  await starting
  assert.equal(runtime.getSnapshot().commands.length, 0)
  assert.throws(() => late!.commands.register({ id: 'after', title: 'After', run() {} }))
})

test('conflicting IDs fail activation and duplicate enabled plugins do not run twice', async () => {
  let calls = 0
  const runtime = setup(ctx => {
    calls++
    ctx.commands.register({ id: 'same', title: 'First', run() {} })
    ctx.commands.register({ id: 'same', title: 'Duplicate', run() {} })
  })
  await runtime.initialize('session')
  assert.equal(runtime.getSnapshot().commands.length, 0)
  assert.equal(calls, 1)
  assert.equal(Boolean(runtime.getSnapshot().errors['example.test']), true)
})

test('safe mode lists packages without activating code', async () => {
  let loaded = 0
  const runtime = setup(() => { loaded++ })
  await runtime.initialize('session', { safeMode: true })
  assert.equal(runtime.getSnapshot().records.length, 1)
  assert.equal(loaded, 0)
  assert.equal(runtime.getSnapshot().safeMode, true)
})

test('re-enabling replaces an activation that was disabled while awaiting', async () => {
  let resolveFirst: () => void = () => {}
  const gate = new Promise<void>(resolve => { resolveFirst = resolve })
  let calls = 0
  const runtime = setup(async ctx => {
    calls++
    if (calls === 1) await gate
    ctx.commands.register({ id: 'ready', title: 'Ready', run() {} })
  })
  const starting = runtime.initialize('session')
  await new Promise(resolve => setTimeout(resolve, 0))
  await runtime.setEnabled('example.test', false)
  const enabling = runtime.setEnabled('example.test', true)
  await new Promise(resolve => setTimeout(resolve, 0))
  resolveFirst()
  await Promise.all([starting, enabling])
  assert.equal(calls, 2)
  assert.equal(runtime.getSnapshot().commands[0]?.id, 'example.test:ready')
})

test('unclean plugin startup enters safe mode and shutdown clears the marker', async () => {
  const entries = new Map<string, string>([['locknote-plugin-session-active', '1']])
  let calls = 0
  const runtime = new PluginRuntime({
    storage: {
      getItem: key => entries.get(key) ?? null,
      setItem: (key, value) => { entries.set(key, value) },
      removeItem: key => { entries.delete(key) },
    },
    fetch: async () => new Response(JSON.stringify({ plugins: [record()], directory: '/data/plugins' })),
    loadModule: async () => ({ default: { activate() { calls++ } } }),
  })
  runtime.setHost(host())
  await runtime.initialize('session')
  assert.equal(runtime.getSnapshot().safeMode, true)
  assert.equal(calls, 0)
  await runtime.setSafeMode(false)
  assert.equal(calls, 1)
  assert.equal(entries.get('locknote-plugin-session-active'), '1')
  runtime.shutdown()
  assert.equal(entries.has('locknote-plugin-session-active'), false)
})

test('mount disposal runs once when a view closes and again only for a new mount', async () => {
  let mounted = 0, disposed = 0
  const runtime = setup(ctx => {
    ctx.views.register({ id: 'panel', title: 'Panel', location: 'right', mount() { mounted++; return () => { disposed++ } } })
  })
  await runtime.initialize('session')
  await runtime.openView('example.test:panel')
  const element = { replaceChildren() {} } as unknown as HTMLElement
  const cleanup = runtime.mountView('example.test:panel', element)
  await Promise.resolve()
  runtime.closeView('example.test:panel')
  cleanup()
  assert.equal(mounted, 1)
  assert.equal(disposed, 1)
  await runtime.openView('example.test:panel')
  runtime.mountView('example.test:panel', element)
  await Promise.resolve()
  await runtime.setEnabled('example.test', false)
  assert.equal(mounted, 2)
  assert.equal(disposed, 2)
})

test('slow failed mount cannot overwrite a later mount in the same host container', async () => {
  let reject: (error: Error) => void = () => {}
  let mountCount = 0
  const runtime = setup(ctx => {
    ctx.views.register({ id: 'panel', title: 'Panel', location: 'right', mount(container) {
      mountCount++
      if (mountCount === 1) return new Promise((_resolve, rejectPromise) => { reject = rejectPromise })
      container.textContent = 'new mount'
    } })
  })
  await runtime.initialize('session')
  await runtime.openView('example.test:panel')
  const fakeElement = { textContent: '', replaceChildren() { fakeElement.textContent = '' } }
  const element = fakeElement as unknown as HTMLElement
  const cleanup = runtime.mountView('example.test:panel', element)
  cleanup()
  runtime.mountView('example.test:panel', element)
  reject(new Error('late failure'))
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(element.textContent, 'new mount')
})

test('note changes do not echo back into the originating plugin', async () => {
  let calls = 0
  const runtime = setup(ctx => { ctx.events.on('note:change', () => { calls++ }) })
  await runtime.initialize('session')
  runtime.emit('note:change', { source: 'plugin:example.test', pluginId: 'example.test' })
  runtime.emit('note:change', { source: 'web' })
  assert.equal(calls, 1)
})

test('runtime rejects unversioned updates before invoking a custom host', async () => {
  let context: PluginContext | undefined
  let writes = 0
  const runtime = setup(ctx => { context = ctx })
  const bridge = host()
  bridge.notes.current = async () => ({ id: 'n1', title: 'Note', content: '', version: 1, unsaved: false })
  bridge.notes.update = async () => { writes++; throw new Error('host was invoked') }
  runtime.setHost(bridge)
  await runtime.initialize('session')
  for (const version of [undefined, 0, -1, 1.5, NaN]) {
    let failure = ''
    try { await context!.notes.update('n1', { expectedVersion: version } as never) } catch (error) { failure = String(error) }
    assert.equal(failure.includes('expectedVersion'), true, failure)
  }
  assert.equal(writes, 0)
})

test('bounded writes interrupt feedback loops across multiple plugins', async () => {
  let context: PluginContext | undefined
  const runtime = setup(ctx => { context = ctx })
  await runtime.initialize('session')
  for (let count = 0; count < 60; count++) await context!.editor.insertText('x')
  let error = ''
  try { await context!.editor.insertText('one too many') } catch (failure) { error = String(failure) }
  assert.equal(error.includes('频繁'), true)
})

test('reserved and conflicting hotkeys cannot replace application or plugin shortcuts', async () => {
  const reserved = setup(ctx => { ctx.commands.register({ id: 'save', title: 'Hijack save', hotkey: 'Ctrl+S', run() {} }) })
  await reserved.initialize('session')
  assert.equal(reserved.getSnapshot().commands.length, 0)
  const conflicting = setup(ctx => {
    ctx.commands.register({ id: 'one', title: 'One', hotkey: 'Mod+Shift+O', run() {} })
    ctx.commands.register({ id: 'two', title: 'Two', hotkey: 'Ctrl+Shift+O', run() {} })
  })
  await conflicting.initialize('session')
  assert.equal(conflicting.getSnapshot().commands.length, 0)
  assert.equal(Boolean(conflicting.getSnapshot().errors['example.test']), true)
})

test('prepareToClose clears recovery marker without invoking third-party cleanup', async () => {
  let cleanups = 0
  const runtime = setup(ctx => { ctx.onDispose(() => { cleanups++ }) })
  await runtime.initialize('session')
  runtime.prepareToClose()
  assert.equal(cleanups, 0)
})

test('open view layout survives deactivation and is restored after activation', async () => {
  const entries = new Map<string, string>()
  const runtime = new PluginRuntime({
    storage: { getItem: key => entries.get(key) ?? null, setItem: (key, value) => { entries.set(key, value) }, removeItem: key => { entries.delete(key) } },
    fetch: async () => new Response(JSON.stringify({ plugins: [record()], directory: '/plugins' })),
    loadModule: async () => ({ default: { activate(ctx) { ctx.views.register({ id: 'panel', title: 'Panel', location: 'right', mount() {} }) } } }),
  })
  runtime.setHost(host())
  await runtime.initialize('session')
  await runtime.openView('example.test:panel')
  await runtime.deactivate('example.test')
  await runtime.activate('example.test')
  assert.equal(runtime.getSnapshot().views[0].open, true)
})

test('reinitializing the live runtime does not mistake its own marker for a crash', async () => {
  const entries = new Map<string, string>()
  const runtime = new PluginRuntime({
    storage: { getItem: key => entries.get(key) ?? null, setItem: (key, value) => { entries.set(key, value) }, removeItem: key => { entries.delete(key) } },
    fetch: async () => new Response(JSON.stringify({ plugins: [record()], directory: '/plugins' })),
    loadModule: async () => ({ default: { activate() {} } }),
  })
  runtime.setHost(host())
  await runtime.initialize('session')
  await runtime.initialize('session')
  assert.equal(runtime.getSnapshot().safeMode, false)
})

test('saved views activate a lazy plugin after a clean application restart', async () => {
  const memory = new Map<string, string>([['locknote-plugin-open-views', '["example.test:panel"]']])
  const lazy = record(); lazy.manifest.activationEvents = ['onCommand:open']
  const runtime = new PluginRuntime({
    storage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value) }, removeItem: key => { memory.delete(key) } },
    fetch: async () => new Response(JSON.stringify({ plugins: [lazy], directory: '/plugins' })),
    loadModule: async () => ({ default: { activate(ctx) { ctx.views.register({ id: 'panel', title: 'Panel', location: 'right', mount() {} }) } } }),
  })
  runtime.setHost(host())
  await runtime.initialize('session')
  assert.equal(runtime.getSnapshot().openViews.length, 1)
})

test('module asset URLs include package identity for same-version replacement', async () => {
  const installed = { ...record(), digest: 'package-one' }
  let moduleURL = ''
  const runtime = new PluginRuntime({
    fetch: async () => new Response(JSON.stringify({ plugins: [installed], directory: '/plugins' })),
    loadModule: async url => { moduleURL = url; return { default: { activate() {} } } },
  })
  runtime.setHost(host())
  await runtime.initialize('session')
  assert.equal(moduleURL.includes('0.1.0%40package-one/main.js'), true)
})

test('identical package import preserves running commands and sends reviewed digest', async () => {
  const installed = { ...record(), digest: 'same-package' }
  let disposed = 0
  const runtime = new PluginRuntime({
    fetch: async (input, init) => {
      if (String(input).endsWith('/install')) {
        assert.equal(new Headers(init?.headers).get('X-Locknote-Plugin-Expected-Digest'), installed.digest)
        return new Response(JSON.stringify(installed))
      }
      return new Response(JSON.stringify({ plugins: [installed], directory: '/plugins' }))
    },
    loadModule: async () => ({ default: { activate(ctx) { ctx.onDispose(() => { disposed++ }); ctx.commands.register({ id: 'alive', title: 'Alive', run() {} }) } } }),
  })
  runtime.setHost(host())
  await runtime.initialize('session')
  await runtime.install(new Blob(['package']), { manifest: installed.manifest, digest: installed.digest, replaces: installed, action: 'identical' })
  assert.equal(disposed, 0)
  assert.equal(runtime.getSnapshot().commands.length, 1)
})

test('plugin translations update registrations and events without reactivation', async () => {
 const installed = record()
 installed.manifest.defaultLocale = 'en'
 installed.manifest.locales = { en: { greeting: 'Hello {name}', command: 'Open outline', view: 'Outline', button: 'Show', settings: 'Preferences' }, zh: { greeting: '你好 {name}', command: '打开大纲', view: '大纲', button: '显示', settings: '设置' } }
 let context: PluginContext | undefined, calls = 0, language = ''
 const runtime = setup(ctx => {
  context = ctx; calls++
  ctx.commands.register({ id: 'open', title: 'Fallback command', titleKey: 'command', run() {} })
  ctx.views.register({ id: 'view', title: 'Fallback view', titleKey: 'view', location: 'right', mount() {} })
  ctx.toolbar.register({ id: 'button', title: 'Fallback command', titleKey: 'command', text: 'Fallback button', textKey: 'button', run() {} })
  ctx.settings.register({ id: 'settings', title: 'Fallback settings', titleKey: 'settings', mount() {} })
  ctx.events.on('language:change', payload => { language = (payload as { locale: string }).locale })
 }, [installed])
 runtime.setLocale('en-US')
 await runtime.initialize('session')
 await runtime.openView('example.test:view')
 assert.equal(context!.i18n.t('greeting', { name: 'Ada' }), 'Hello Ada')
 assert.equal(context!.i18n.t('missing', {}, 'Readable fallback'), 'Readable fallback')
 runtime.setLocale('zh-CN')
 assert.equal(context!.i18n.locale, 'zh-CN')
 assert.equal(language, 'zh-CN')
 assert.equal(runtime.getSnapshot().commands[0].title, '打开大纲')
 assert.equal(runtime.getSnapshot().toolbar[0].text, '显示')
 assert.equal(runtime.getSnapshot().settings[0].title, '设置')
 assert.equal(runtime.getSnapshot().views[0].title, '大纲')
 assert.equal(runtime.getSnapshot().views[0].open, true)
 runtime.setLocale('fr-FR')
 assert.equal(runtime.getSnapshot().views[0].title, 'Outline')
 assert.equal(calls, 1)
})

test('lazy commands change language before loading plugin code', async () => {
 const installed = record()
 installed.manifest.activationEvents = ['onCommand:open']
 installed.manifest.commands = [{ id: 'open', title: 'Open', titleKey: 'open' }]
 installed.manifest.locales = { en: { open: 'Open' }, zh: { open: '打开' } }
 let loaded = 0
 const runtime = setup(() => { loaded++ }, [installed])
 runtime.setLocale('en')
 await runtime.initialize('session')
 assert.equal(runtime.getSnapshot().commands[0].title, 'Open')
 runtime.setLocale('zh-CN')
 assert.equal(runtime.getSnapshot().commands[0].title, '打开')
 assert.equal(loaded, 0)
})

test('disposing commands and closing views do not unmount other contribution kinds', async () => {
 let disposeCommand = () => {}, viewDisposed = 0, settingsDisposed = 0
 const runtime = setup(ctx => {
  disposeCommand = ctx.commands.register({id:'report',title:'Report',run(){}})
  ctx.views.register({id:'report',title:'Report',location:'main',mount(){return()=>{viewDisposed++}}})
  ctx.settings.register({id:'report',title:'Settings',mount(){return()=>{settingsDisposed++}}})
 })
 await runtime.initialize('session');await runtime.openView('example.test:report')
 const container = () => ({replaceChildren(){}} as unknown as HTMLElement)
 runtime.mountView('example.test:report',container());runtime.mountSettings('example.test:report',container())
 await Promise.resolve()
 disposeCommand();assert.equal(viewDisposed,0);assert.equal(settingsDisposed,0)
 runtime.closeView('example.test:report');assert.equal(viewDisposed,1);assert.equal(settingsDisposed,0)
 runtime.shutdown();assert.equal(settingsDisposed,1)
})

test('interactive actions reject failures while background events stay isolated', async () => {
 const runtime = setup(ctx => {
  const run = () => {throw new Error('operation failed')}
  ctx.commands.register({id:'fail',title:'Fail',run})
  ctx.menus.register({id:'fail',title:'Fail',context:'note',run})
  ctx.toolbar.register({id:'fail',title:'Fail',run})
  ctx.events.on('note:selection',run)
 })
 await runtime.initialize('session')
 for (const run of [()=>runtime.runCommand('example.test:fail'),()=>runtime.runMenu('example.test:fail'),()=>runtime.runButton('example.test:fail')]) {
  let rejected=false;try{await run()}catch{rejected=true};assert.equal(rejected,true)
 }
 runtime.emit('note:selection',{});await Promise.resolve()
 assert.equal(runtime.getSnapshot().errors['example.test'],'operation failed')
 runtime.shutdown()
})

test('navigation toggles a plugin view without disabling its plugin', async () => {
 let disposed = 0
 const runtime = setup(ctx => {
   ctx.views.register({ id: 'panel', title: 'Panel', location: 'right', mount() { return () => { disposed++ } } })
 })
 await runtime.initialize('session')
 await runtime.toggleView('example.test:panel')
 assert.equal(runtime.getSnapshot().views[0].open, true)
 runtime.mountView('example.test:panel', { replaceChildren() {} } as unknown as HTMLElement)
 await Promise.resolve()
 await runtime.toggleView('example.test:panel')
 assert.equal(runtime.getSnapshot().views[0].open, false)
 assert.equal(disposed, 1)
 assert.equal(runtime.isScopeActive('example.test'), true)
 await runtime.toggleView('example.test:panel')
 assert.equal(runtime.getSnapshot().views[0].open, true)
 runtime.shutdown()
})

test('toolbar can toggle its view through the public workspace API', async () => {
 const runtime = setup(ctx => {
   ctx.views.register({ id: 'outline', title: 'Outline', location: 'right', mount() {} })
   ctx.toolbar.register({ id: 'outline', title: 'Outline', run: () => ctx.workspace.toggleView('outline') })
 })
 await runtime.initialize('session')
 await runtime.runButton('example.test:outline')
 assert.equal(runtime.getSnapshot().views[0].open, true)
 await runtime.runButton('example.test:outline')
 assert.equal(runtime.getSnapshot().views[0].open, false)
 await runtime.toggleView('example.test:outline')
 await runtime.runButton('example.test:outline')
 assert.equal(runtime.getSnapshot().views[0].open, false)
 runtime.shutdown()
})

test('AI transport is scoped, aborts on disable and requires declared capability',async()=>{
 let context: PluginContext | undefined, signal: AbortSignal | null | undefined
 const item=record();item.manifest.capabilities.push('ai.chat')
 const runtime=new PluginRuntime({fetch:async(input,init)=>{
  if(String(input).endsWith('/ai/chat')){signal=init?.signal;return new Promise((_resolve,reject)=>signal?.addEventListener('abort',()=>reject(new Error('aborted'))))}
  if(init?.method==='PUT')return new Response('{}')
  return new Response(JSON.stringify({plugins:[item],directory:'/plugins'}))
 },loadModule:async()=>({activate(ctx){context=ctx}})})
 runtime.setHost(host());await runtime.initialize('session')
 const pending=context!.ai.chatCompletion({baseURL:'https://api.deepseek.com',apiKey:'key',model:'deepseek-flash',messages:[{role:'user',content:'Hi'}]}).then(()=>false,()=>true)
 await Promise.resolve();await runtime.setEnabled(item.manifest.id,false)
 assert.equal(signal?.aborted,true);assert.equal(await pending,true)
 const denied=setup(ctx=>{context=ctx});await denied.initialize('session')
 let failure='';try{await context!.ai.chatCompletion({baseURL:'https://api.deepseek.com',model:'deepseek-flash',messages:[{role:'user',content:'Hi'}]})}catch(error){failure=String(error)}
 assert.equal(failure.includes('ai.chat'),true);denied.shutdown()
})

test('enabled UI plugins restore navigation on restart even when their panels were closed',async()=>{
 const memory=new Map<string,string>()
 const records=['ui.sidebar','ui.panel'].map((capability,index)=>{const item=record('example.ui'+index);item.manifest.capabilities.push(capability);item.manifest.activationEvents=['onCommand:open'];return item})
 const disabled=record('example.disabled');disabled.enabled=false;disabled.manifest.capabilities.push('ui.sidebar');records.push(disabled)
 const loaded:string[]=[]
 const makeRuntime=()=>{const runtime=new PluginRuntime({
  storage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>{memory.set(key,value)},removeItem:key=>{memory.delete(key)}},
  fetch:async()=>new Response(JSON.stringify({plugins:records,directory:'/plugins'})),
  loadModule:async()=>({activate(ctx){loaded.push(ctx.manifest.id);ctx.views.register({id:'panel',title:'Panel',location:'right',mount(){}});ctx.toolbar.register({id:'open',title:'Open',run(){}})}}),
 });runtime.setHost(host());return runtime}
 const first=makeRuntime();await first.initialize('session-one')
 await first.openView('example.ui0:panel');first.closeView('example.ui0:panel');first.shutdown()
 loaded.length=0
 const restarted=makeRuntime();await restarted.initialize('session-two')
 assert.deepEqual([...loaded].sort(),['example.ui0','example.ui1'])
 assert.equal(restarted.getSnapshot().views.length,2)
 assert.equal(restarted.getSnapshot().toolbar.length,2)
 assert.equal(restarted.getSnapshot().openViews.length,0)
 restarted.shutdown()
 const safe=makeRuntime();await safe.initialize('session-three',{safeMode:true})
 assert.equal(safe.getSnapshot().views.length,0)
 await safe.exitSafeMode();assert.equal(safe.getSnapshot().views.length,2);safe.shutdown()
})

test('AI model discovery uses scoped transport and shares request cancellation',async()=>{
 let context: PluginContext | undefined,signal: AbortSignal | null | undefined
 const installed=record();installed.manifest.capabilities.push('ai.chat')
 const runtime=new PluginRuntime({fetch:async(input,init)=>{
  if(String(input).endsWith('/ai/models')){signal=init?.signal;return new Response(JSON.stringify({models:['deepseek-flash']}))}
  return new Response(JSON.stringify({plugins:[installed],directory:'/plugins'}))
 },loadModule:async()=>({activate(ctx){context=ctx}})})
 runtime.setHost(host());await runtime.initialize('session')
 const result=await context!.ai.listModels({baseURL:'https://api.deepseek.com',apiKey:'key'})
 assert.deepEqual(result.models,['deepseek-flash']);assert.equal(signal?.aborted,true);runtime.shutdown()
})

test('conversation storage is scoped to plugin identity and unavailable after disable', async () => {
 let context!: PluginContext
 const paths: string[] = []
 const runtime = new PluginRuntime({ fetch: async (input, init) => {
  const path = String(input);paths.push(path)
  if (path === '/api/plugins') return new Response(JSON.stringify({ plugins: [record()], directory: '/plugins' }))
  if (init?.body) assert.equal(String(init.body).includes('other.plugin'), false)
  return new Response(JSON.stringify({ id: 'chat', seq: 2, events: [] }))
 }, loadModule: async () => ({ default: { activate(ctx) { context = ctx } } }) })
 runtime.setHost(host());await runtime.initialize('session')
 await context.conversations.create('Test');await context.conversations.append('chat', 1, [{ type: 'message', content: 'Hello' }]);await context.conversations.read('chat')
 assert.equal(paths.some(path => path === '/api/plugins/example.test/conversations/chat?before=-1'), true)
 runtime.shutdown();let denied=false;try{await context.conversations.read('chat')}catch{denied=true};assert.equal(denied,true)
})

test('disabling during a submitted review write preserves successful receipt and applied state', async () => {
 let ctx!: PluginContext, complete!: () => void, writes = 0
 const rec = record('commit.test');rec.manifest.capabilities = ['notes.read', 'notes.write']
 const runtime = setup(context => { ctx = context }, [rec]), adapter = host()
 adapter.notes.create = () => new Promise(resolve => { complete = () => { writes++;resolve({ id: 'committed', title: 'Saved', content: 'Body', version: 1 }) } })
 runtime.setHost(adapter);await runtime.initialize('session')
 const receipt = ctx.changes.review({ after: { title: 'Saved', content: 'Body' } }).catch(error => ({ saved: false, error: String(error) }))
 const id = noteChanges.getSnapshot().activeId!, applying = noteChanges.apply(id).catch(error => error)
 await runtime.deactivate(rec.manifest.id);complete();await applying
 assert.equal((await receipt).saved, true);assert.equal(writes, 1)
 assert.equal(noteChanges.getSnapshot().entries.find(entry => entry.id === id)?.state, 'applied');runtime.shutdown()
})
test('one change publication reaches each plugin listener once regardless of plugin count', async () => {
 let count = 0
 const runtime = setup(ctx => { ctx.events.on('changes:change', () => { count++ }) }, [record('fanout.one'), record('fanout.two')])
 await runtime.initialize('session');count = 0;noteChanges.close();assert.equal(count, 2)
 runtime.shutdown();count = 0;noteChanges.close();assert.equal(count, 0)
})
test('opening an already open view explicitly selects its dock tab', async () => {
 const runtime = setup(ctx => { for (const id of ['one', 'two']) ctx.views.register({ id, title: id, location: 'right', mount() {} }) })
 await runtime.initialize('session')
 await runtime.openView('example.test:one');await runtime.openView('example.test:two');await runtime.openView('example.test:one')
 assert.equal(runtime.getSnapshot().activeViews?.right, 'example.test:one')
 runtime.closeView('example.test:one');assert.equal(runtime.getSnapshot().activeViews?.right, 'example.test:two');runtime.shutdown()
})
test('configuration snapshots reject stale writes and legacy set detects intervening changes', async () => {
 let ctx!: PluginContext, data = { model: 'old', color: 'blue' }, revision = 'r1', serial = 1
 const rec = record('storage.test')
 const runtime = new PluginRuntime({ loadModule: async () => ({ activate(context) { ctx = context } }), fetch: async (url, init) => {
  if (!String(url).endsWith('/data')) return new Response(JSON.stringify({ plugins: [rec], directory: '' }))
  if (init?.method === 'PUT') {
   const body = JSON.parse(String(init.body))
   if (body.expectedRevision !== revision) return new Response(JSON.stringify({ error: 'Changed', code: 'CONFIG_CONFLICT' }), { status: 409 })
   data = body.data;revision = 'r' + ++serial
  }
  return new Response(JSON.stringify({ data, revision }))
 } });runtime.setHost(host());await runtime.initialize('session')
 const first = await ctx.storage.snapshot(), second = await ctx.storage.snapshot()
 await ctx.storage.compareAndSet({ ...first.data, model: 'new' }, first.revision)
 let conflict = '';try { await ctx.storage.compareAndSet({ ...second.data, color: 'green' }, second.revision) } catch (error) { conflict = (error as { code: string }).code }
 assert.equal(conflict, 'CONFIG_CONFLICT');assert.equal(data.model, 'new')
 await ctx.storage.get();revision = 'external'
 try { await ctx.storage.set({ color: 'bad' });conflict = '' } catch (error) { conflict = (error as { code: string }).code }
 assert.equal(conflict, 'CONFIG_CONFLICT');assert.equal(data.model, 'new');runtime.shutdown()
})

test('SDK exposes immutable feature detection and predictable stopped error codes', async () => {
 let ctx!: PluginContext
 const runtime = setup(context => { ctx = context });await runtime.initialize('session')
 assert.equal(ctx.host.apiVersion, 1);assert.equal(ctx.host.hasFeature('storage.cas'), true)
 assert.equal(ctx.host.hasFeature('future.unknown'), false)
 assert.equal(Object.isFrozen(ctx.host.features), true)
 runtime.shutdown();let code = '';try { await ctx.notes.current() } catch (error) { code = (error as { code: string }).code }
 assert.equal(code, 'PLUGIN_STOPPED')
})

test('disabling during a submitted undo preserves its successful receipt', async () => {
 let ctx!: PluginContext, release!: () => void, note = { id: 'undo-note', title: 'N', content: 'Old', tags: [] as string[], version: 1 }, delay = false
 const rec = record('undo.test');rec.manifest.capabilities = ['notes.read', 'notes.write']
 const runtime = setup(context => { ctx = context }, [rec]), adapter = host()
 adapter.notes.get = async () => note
 adapter.notes.update = async (_id, patch) => { if (delay) await new Promise<void>(resolve => { release = resolve });note = { ...note, ...patch, version: note.version + 1 };return note }
 runtime.setHost(adapter);await runtime.initialize('session')
 const reviewing = ctx.changes.review({ before: note, after: { content: 'New' } }), id = noteChanges.getSnapshot().activeId!
 await noteChanges.apply(id);await reviewing;delay = true
 const undoing = ctx.changes.undo(id).catch(error => ({ saved: false, error: String(error) }))
 await new Promise(resolve => setTimeout(resolve, 0));await runtime.deactivate(rec.manifest.id);release()
 assert.equal((await undoing).saved, true);assert.equal(note.content, 'Old');runtime.shutdown()
})

test('market installation uses an opaque token and preserves a committed receipt if refresh fails', async () => {
 const rec = record('market.test');rec.enabled = false
 let committed = false, submitted = ''
 const runtime = new PluginRuntime({ fetch: async (url, init) => {
  if (String(url).endsWith('/market/install')) { submitted = String(init?.body);committed = true;return new Response(JSON.stringify(rec), { status: 201 }) }
  if (committed) throw new Error('Refresh offline')
  return new Response(JSON.stringify({ plugins: [], directory: '' }))
 } })
 await runtime.initialize('session')
 const saved = await runtime.install({ token: 'verified-package' }, { manifest: rec.manifest, digest: 'new-digest', action: 'install' })
 assert.equal(saved.manifest.id, rec.manifest.id)
 assert.deepEqual(JSON.parse(submitted), { token: 'verified-package', expectedDigest: '' })
 assert.equal(runtime.getSnapshot().errors.host.includes('Refresh offline'), true)
 runtime.shutdown()
})
