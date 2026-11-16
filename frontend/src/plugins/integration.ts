import { responseError } from './errors'
import { pluginRuntime } from './runtime'
import { noteChanges } from './note-changes'
import type { PluginHost } from './types'

declare global {
  interface Window {
    LNHasPendingNoteChange?: (id: string) => boolean
    LNPluginHost?: PluginHost
    LNPluginTransport?: { request(pluginId: string, path: string, method?: string, body?: unknown): Promise<unknown> }
    LNPluginHasMenus?: (context: string) => boolean
  }
}

/** The desktop binding supplies a per-process session; HTTP clients never receive it. */
export function installPluginIntegration() {
  window.LNHasPendingNoteChange = id => noteChanges.getSnapshot().entries.some(entry => entry.state === 'pending' && entry.noteId === id)
  let started = false
  let session = ''
  async function start() {
    if (started || !window.LNPluginHost) return
    started = true
    const desktop = (window as unknown as { go?: { main?: { desktop?: { PluginSession(): Promise<string> } } } }).go?.main?.desktop
    if (!desktop?.PluginSession) return
    try {
      session = await desktop.PluginSession()
      window.LNPluginTransport = {
        async request(pluginId, path, method = 'GET', body) {
          const response = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}${path}`, {
            method,
            headers: { 'X-Locknote-Plugin-Session': session, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            body: body === undefined ? undefined : JSON.stringify(body),
          })
          const value = await response.json()
          if (!response.ok) throw responseError(response.status, value)
          return value
        },
      }
      pluginRuntime.setHost(window.LNPluginHost)
      window.LNPluginHasMenus = context => pluginRuntime.getSnapshot().menus.some(menu => menu.context === context)
      await pluginRuntime.initialize(session)
    } catch (error) {
      console.error('Plugin initialization failed', error)
      pluginRuntime.recordError('host', error)
    }
  }
  window.addEventListener('locknote:plugin-event', event => {
    const { name, payload } = (event as CustomEvent<{ name: string; payload: unknown }>).detail
    if (name === 'workspace:ready') { void start(); return }
    if (name === 'workspace:closing') { pluginRuntime.prepareToClose(); return }
    pluginRuntime.emit(name, payload)
  })
  const languageChanged = () => pluginRuntime.setLocale(document.documentElement.lang)
  languageChanged()
  window.addEventListener('ln:language', languageChanged)
  const themeObserver = new MutationObserver(() => pluginRuntime.emit('theme:change', {
    theme: document.documentElement.getAttribute('data-theme'),
    fontSize: document.documentElement.getAttribute('data-font'),
  }))
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-font'] })
}
