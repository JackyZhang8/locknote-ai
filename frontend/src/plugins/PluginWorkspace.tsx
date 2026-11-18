import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { pluginRuntime } from './runtime'
import { PluginDialog } from './PluginDialog'
import type { RegisteredView, ViewLocation } from './types'
import { t, errorMessage } from './ui-text'
import './plugins.css'
import { noteChanges } from './note-changes'
import { NoteChangeReview, PendingNoteDrafts } from './NoteChangeReview'

type ContextRequest = { context: 'note' | 'editor' | 'notebook'; payload?: unknown; x: number; y: number }
type Sizes = { left: number; right: number; bottom: number }
const defaultSizes: Sizes = { left: 260, right: 300, bottom: 230 }

function readSizes(): Sizes {
  try { const saved = JSON.parse(localStorage.getItem('locknote-plugin-pane-sizes') || '{}'); return { left: Math.max(180, Math.min(480, Number(saved.left) || 260)), right: Math.max(180, Math.min(480, Number(saved.right) || 300)), bottom: Math.max(120, Math.min(500, Number(saved.bottom) || 230)) } } catch { return defaultSizes }
}

export function matchesPluginHotkey(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split('+').map(part => part.trim())
  const key = parts.pop()
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const ctrl = parts.includes('ctrl') || parts.includes('control') || (parts.includes('mod') && !mac)
  const meta = parts.includes('meta') || parts.includes('cmd') || (parts.includes('mod') && mac)
  return !!key && event.key.toLowerCase() === key && event.ctrlKey === ctrl && event.metaKey === meta && event.altKey === parts.includes('alt') && event.shiftKey === parts.includes('shift')
}

function MountedView({ view, active }: { view: RegisteredView; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current ? pluginRuntime.mountView(view.id, ref.current) : undefined, [view.id])
  return <div className="plugin-view-body" role="tabpanel" aria-label={view.title} hidden={!active} ref={ref} tabIndex={0} />
}

export function ViewDock({ location, views, size, onResize }: { location: ViewLocation; views: RegisteredView[]; size: number; onResize(value: number): void }) {
  const snapshot = useSyncExternalStore(pluginRuntime.subscribe, pluginRuntime.getSnapshot, pluginRuntime.getSnapshot)
  useEffect(() => {
    if (location !== 'main') return
    const show = () => pluginRuntime.selectNoteView()
    window.addEventListener('locknote:plugin-show-note', show)
    return () => window.removeEventListener('locknote:plugin-show-note', show)
  }, [location])
  const selected = snapshot.activeViews?.[location]
  const active = location === 'main' && selected === '__note__' ? '__note__' : views.some(view => view.id === selected) ? selected : views[0]?.id
  const locationLabel = { left: t('插件左侧栏', 'Plugin left sidebar'), right: t('插件右侧栏', 'Plugin right sidebar'), main: t('插件工作区', 'Plugin workspace'), bottom: t('插件底部面板', 'Plugin bottom panel') }[location]
  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
    const element = event.currentTarget, start = location === 'bottom' ? event.clientY : event.clientX
    const move = (next: PointerEvent) => { const position = location === 'bottom' ? next.clientY : next.clientX; const delta = (position - start) * (location === 'left' ? 1 : -1); onResize(size + delta) }
    const end = () => { element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', end); element.removeEventListener('pointercancel', end) }
    element.addEventListener('pointermove', move); element.addEventListener('pointerup', end); element.addEventListener('pointercancel', end)
  }
  if (!views.length) return null
  return <section className={`plugin-view-dock plugin-view-dock-${location}${location === 'main' && selected === '__note__' ? ' plugin-note-selected' : ''}`} aria-label={locationLabel}>
    {location !== 'main' && <div className="plugin-view-resizer" role="separator" aria-label={t('调整插件面板大小', 'Resize plugin panel')} aria-orientation={location === 'bottom' ? 'horizontal' : 'vertical'} tabIndex={0} onPointerDown={startResize} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
      event.preventDefault(); onResize(size + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 16 : -16) * (location === 'left' ? 1 : -1))
    }} />}
    <div className="plugin-view-tabs" role="tablist" aria-label={locationLabel}>
      {location === 'main' && <div className={`plugin-view-tab${active === '__note__' ? ' active' : ''}`}><button role="tab" aria-selected={active === '__note__'} onClick={() => pluginRuntime.selectNoteView()}>{t('笔记', 'Note')}</button></div>}
      {views.map(view => <div key={view.id} className={`plugin-view-tab${view.id === active ? ' active' : ''}`}><button role="tab" aria-selected={view.id === active} onClick={() => pluginRuntime.selectView(view.id)}>{view.title}</button><button className="plugin-view-close" aria-label={`${t('关闭', 'Close')} ${view.title}`} onClick={() => pluginRuntime.closeView(view.id)}>×</button></div>)}
    </div>
    {views.map(view => <MountedView key={view.id} view={view} active={view.id === active} />)}
  </section>
}

export function PluginWorkspace() {
  const changes = useSyncExternalStore(noteChanges.subscribe, noteChanges.getSnapshot, noteChanges.getSnapshot)
  const [showChanges, setShowChanges] = useState(false)
  useEffect(() => { if (changes.activeId) document.getElementById('settingsClose')?.click() }, [changes.activeId])
  const state = useSyncExternalStore(pluginRuntime.subscribe, pluginRuntime.getSnapshot, pluginRuntime.getSnapshot)
  const [workspace, setWorkspace] = useState<HTMLElement | null>(null), [sizes, setSizes] = useState<Sizes>(defaultSizes)
  const [palette, setPalette] = useState(false), [query, setQuery] = useState(''), [error, setError] = useState('')
  const [context, setContext] = useState<ContextRequest | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [, rerender] = useState(0)
  useEffect(() => { setWorkspace(document.getElementById('workspace')); setSizes(readSizes()); const changed = () => rerender(value => value + 1); window.addEventListener('ln:language', changed); return () => window.removeEventListener('ln:language', changed) }, [])
  const rail = workspace?.querySelector<HTMLElement>('.rail') || null
  const noteEditor = workspace?.querySelector<HTMLElement>('.editor') || null
  const headerActions = workspace?.parentElement?.querySelector<HTMLElement>('.top-right') || null
  useEffect(() => {
    rail?.classList.toggle('plugin-rail-open', state.views.length > 0)
    return () => rail?.classList.remove('plugin-rail-open')
  }, [rail, state.views.length])
  const navigationViews = state.views.filter(view => view.showInNavigation !== false)
  const open = state.openViews
  const left = open.some(view => view.location === 'left'), right = open.some(view => view.location === 'right'), bottom = open.some(view => view.location === 'bottom'), main = open.some(view => view.location === 'main')
  useEffect(() => {
    if (!workspace) return
    workspace.classList.toggle('plugin-views-open', open.length > 0)
    workspace.classList.toggle('plugin-main-open', main)
    workspace.classList.toggle('plugin-left-open', left); workspace.classList.toggle('plugin-right-open', right); workspace.classList.toggle('plugin-bottom-open', bottom)
    for (const key of ['left', 'right', 'bottom'] as const) workspace.style.setProperty(`--plugin-${key}-${key === 'bottom' ? 'height' : 'width'}`, `${sizes[key]}px`)
    workspace.style.setProperty('--plugin-left-width-active', left ? `${sizes.left}px` : '0px'); workspace.style.setProperty('--plugin-right-width-active', right ? `${sizes.right}px` : '0px'); workspace.style.setProperty('--plugin-bottom-height-active', bottom ? `${sizes.bottom}px` : '0px')
    const editor = workspace.querySelector<HTMLElement>('.editor')
    const measure = () => { if (!editor || !editor.offsetWidth) return; const rect = editor.getBoundingClientRect(), outer = workspace.getBoundingClientRect(); workspace.style.setProperty('--plugin-main-left', `${rect.left - outer.left}px`); workspace.style.setProperty('--plugin-main-right', `${Math.max(0, outer.right - rect.right)}px`) }
    measure()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (editor) observer?.observe(editor)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [workspace, open.length, left, right, bottom, main, sizes])
  useEffect(() => () => {
    workspace?.classList.remove('plugin-views-open', 'plugin-left-open', 'plugin-right-open', 'plugin-bottom-open', 'plugin-main-open')
  }, [workspace])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat || !state.available || window.LNHistory?.isOpen()) return
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); event.stopPropagation(); setPalette(value => !value); setQuery(''); return }
      const command = state.commands.find(item => item.hotkey && matchesPluginHotkey(event, item.hotkey))
      if (command) { event.preventDefault(); event.stopPropagation(); void pluginRuntime.runCommand(command.id).catch(reason => setError(errorMessage(reason))) }
    }
    window.addEventListener('keydown', keydown, true)
    return () => window.removeEventListener('keydown', keydown, true)
  }, [state.available, state.commands])
  useEffect(() => {
    const show = (event: Event) => { const request = (event as CustomEvent<ContextRequest>).detail; if (request && state.menus.some(item => item.context === request.context)) setContext(request) }
    const close = () => setContext(null)
    window.addEventListener('locknote:plugin-context', show); window.addEventListener('resize', close); window.addEventListener('blur', close); window.addEventListener('click', close)
    return () => { window.removeEventListener('locknote:plugin-context', show); window.removeEventListener('resize', close); window.removeEventListener('blur', close); window.removeEventListener('click', close) }
  }, [state.menus])
  useEffect(() => { if (context) menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus() }, [context])
  function resize(location: ViewLocation, value: number) {
    if (location === 'main') return
    setSizes(previous => { const next = { ...previous, [location]: Math.max(location === 'bottom' ? 120 : 180, Math.min(location === 'bottom' ? Math.max(120, window.innerHeight * .6) : Math.max(180, window.innerWidth * .45), value)) }; try { localStorage.setItem('locknote-plugin-pane-sizes', JSON.stringify(next)) } catch { /* optional layout persistence */ } return next })
  }
  async function command(id: string) { setError(''); try { await pluginRuntime.runCommand(id); setPalette(false) } catch (reason) { setError(errorMessage(reason)) } }
  if (!state.available) return null
  const commands = state.commands.filter(item => `${item.title} ${item.pluginId}`.toLowerCase().includes(query.toLowerCase()))
  return <>
    {noteEditor && !changes.activeId && createPortal(<PendingNoteDrafts entries={changes.entries} />, noteEditor)}
    {rail && navigationViews.length > 0 && createPortal(<div className="plugin-rail-launchers" aria-label={t('插件视图', 'Plugin views')}>{navigationViews.map(view => <button key={view.id} className={view.open ? 'active' : ''} title={view.title} aria-label={view.title} aria-pressed={view.open} onClick={() => { if (workspace?.classList.contains('settings-open')) document.getElementById('settingsClose')?.click(); void pluginRuntime.toggleView(view.id).catch(reason => setError(errorMessage(reason))) }}><svg aria-hidden="true"><use href="#i-plug" /></svg><span>{view.title}</span></button>)}</div>, rail)}
    {workspace && createPortal(<>{(['left', 'right', 'main', 'bottom'] as const).map(location => <ViewDock key={location} location={location} views={open.filter(view => view.location === location)} size={location === 'main' ? 0 : sizes[location]} onResize={value => resize(location, value)} />)}<NoteChangeReview /></>, workspace)}
    {headerActions && (state.records.length > 0 || state.toolbar.length > 0 || state.status.length > 0) && createPortal(<div className="plugin-toolbar" aria-label={t('插件工具栏', 'Plugin toolbar')}>
      <button onClick={() => { setPalette(true); setQuery('') }} title={t('插件命令（⌘/Ctrl + Shift + P）', 'Plugin commands (⌘/Ctrl + Shift + P)')}>{t('插件命令', 'Plugin commands')}</button>
      {changes.entries.length > 0 && <button onClick={() => setShowChanges(true)}>{t('改动记录', 'Note changes')}{changes.entries.some(entry => entry.state === 'pending') ? ' •' : ''}</button>}
      {state.toolbar.map(button => <button key={button.id} title={button.title} onClick={() => void pluginRuntime.runButton(button.id).catch(reason => setError(errorMessage(reason)))}>{button.text || button.title}</button>)}
      {state.status.map(button => <button key={button.id} className="plugin-status" title={button.title} onClick={() => void pluginRuntime.runButton(button.id).catch(reason => setError(errorMessage(reason)))}>{button.text || button.title}</button>)}
    </div>, headerActions)}
    {palette && <PluginDialog title={t('插件命令', 'Plugin commands')} onClose={() => setPalette(false)}><input autoFocus aria-label={t('搜索插件命令', 'Search plugin commands')} placeholder={t('搜索命令…', 'Search commands…')} value={query} onChange={event => setQuery(event.target.value)} style={{ width: '100%' }} onKeyDown={event => { if (event.key === 'Enter' && commands[0]) void command(commands[0].id) }} /><div className="plugin-command-list">{commands.map(item => <button key={item.id} onClick={() => void command(item.id)}>{item.title}<small>{item.pluginId}{item.hotkey ? ` · ${item.hotkey}` : ''}</small></button>)}{!commands.length && <p className="plugin-muted">{t('没有可用的插件命令', 'No plugin commands available')}</p>}</div>{error && <p role="alert" className="plugin-error">{error}</p>}</PluginDialog>}
    {context && createPortal(<div role="menu" aria-label={t('插件操作', 'Plugin actions')} className="plugin-context-menu" ref={menuRef} style={{ left: Math.max(8, Math.min(context.x, window.innerWidth - 330)), top: Math.max(8, Math.min(context.y, window.innerHeight - 200)) } as CSSProperties} onKeyDown={event => { if (event.key === 'Escape') setContext(null) }}>{state.menus.filter(item => item.context === context.context).map(menu => <button key={menu.id} role="menuitem" onClick={() => { setContext(null); void pluginRuntime.runMenu(menu.id, context.payload).catch(reason => setError(errorMessage(reason))) }}>{menu.title}</button>)}</div>, document.body)}
    {showChanges && <PluginDialog title={t('笔记改动记录', 'Note change history')} onClose={() => setShowChanges(false)}><div className="plugin-command-list">{[...changes.entries].reverse().map(entry => <button key={entry.id} onClick={() => { noteChanges.open(entry.id);setShowChanges(false) }}>{entry.title}<small>{entry.pluginId} · {({ pending: t('待审阅', 'Pending'), applied: t('已应用', 'Applied'), discarded: t('已丢弃', 'Discarded'), undone: t('已撤回', 'Undone') })[entry.state]} · {new Date(entry.createdAt).toLocaleString()}</small></button>)}</div></PluginDialog>}
    {error && !palette && <div className="plugin-error-toast" role="alert"><span className="plugin-error">{error}</span><button onClick={() => setError('')}>{t('关闭', 'Close')}</button></div>}
  </>
}
