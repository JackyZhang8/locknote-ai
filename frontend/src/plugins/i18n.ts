import type { PluginManifest } from './types.js'

export function currentLocale(): string {
  return typeof document === 'undefined' ? 'zh-CN' : document.documentElement.lang || 'zh-CN'
}
export function translate(manifest: PluginManifest, locale: string, key: string, params: Record<string, string | number> = {}, fallback = key): string {
  const dictionaries = manifest.locales ?? {}
  const candidates = [locale, locale.split('-')[0], manifest.defaultLocale ?? 'en', (manifest.defaultLocale ?? 'en').split('-')[0]]
  let value = fallback
  for (const candidate of candidates) {
    const dictionary = Object.entries(dictionaries).find(([name]) => name.toLowerCase() === candidate.toLowerCase())?.[1]
    if (dictionary && Object.prototype.hasOwnProperty.call(dictionary, key) && typeof dictionary[key] === 'string' && dictionary[key]) { value = dictionary[key]; break }
  }
  return value.replace(/{([a-zA-Z0-9_]+)}/g, (original, name: string) => Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : original)
}
export function localizeManifest(manifest: PluginManifest, locale = currentLocale()): PluginManifest {
  return {
    ...manifest,
    name: translate(manifest, locale, 'name', {}, manifest.name),
    description: translate(manifest, locale, 'description', {}, manifest.description ?? ''),
    commands: manifest.commands?.map(command => ({ ...command, title: translate(manifest, locale, command.titleKey ?? 'commands.' + command.id, {}, command.title) })),
  }
}
