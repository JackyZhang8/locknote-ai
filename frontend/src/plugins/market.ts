export interface MarketRelease {
  version: string; apiVersion: number; minAppVersion: string; capabilities: string[]
  file: string; downloadUrl?: string; size: number; sha256: string
}
export interface MarketPlugin {
  id: string; name: string; description: string; author: string; license: string; sourceUrl: string
  defaultLocale: string; locales: Record<string, Record<string, string>>; latestVersion: string; releases: MarketRelease[]
}
export interface MarketSnapshot {
  catalog: { schemaVersion: number; updatedAt: string; plugins: MarketPlugin[] }
  fetchedAt: string; appVersion: string; stale: boolean; warning?: string; revalidate?: boolean
}
export function compareVersions(left: string, right: string): number | null {
  const parse = (value: string) => {
    if (value.length > 128) return null
    const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/.exec(value)
    if (!match) return null
    const core = match.slice(1, 4).map(BigInt), pre = match[4]?.split('.') || []
    if (core.some(part => part > 4294967295n) || pre.some(part => !part || (/^\d+$/.test(part) && part.length > 1 && part[0] === '0'))) return null
    return { core, pre }
  }
  const a = parse(left), b = parse(right)
  if (!a || !b) return null
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    if (a.pre[i] === undefined) return -1
    if (b.pre[i] === undefined) return 1
    if (a.pre[i] === b.pre[i]) continue
    const an = /^\d+$/.test(a.pre[i]), bn = /^\d+$/.test(b.pre[i])
    if (an && bn) return BigInt(a.pre[i]) > BigInt(b.pre[i]) ? 1 : -1
    if (an !== bn) return an ? -1 : 1
    return a.pre[i] > b.pre[i] ? 1 : -1
  }
  return 0
}
export function selectMarketRelease(plugin: MarketPlugin, appVersion: string): MarketRelease | undefined {
  return plugin.releases.filter(release => release.apiVersion === 1 && compareVersions(release.version, release.version) === 0 && (compareVersions(appVersion, release.minAppVersion) ?? -1) >= 0)
    .sort((a, b) => compareVersions(b.version, a.version) ?? 0)[0]
}
export function marketStatus(release: MarketRelease | undefined, installed?: string) {
  if (!release) return 'incompatible'
  if (!installed) return 'install'
  const order = compareVersions(installed, release.version)
  if (order === null || order > 0) return 'newer'
  return order === 0 ? 'installed' : 'upgrade'
}
export function marketText(plugin: MarketPlugin, locale: string) {
  const defaultLocale = plugin.defaultLocale || 'en'
  const keys = [locale, locale.split('-')[0], defaultLocale, defaultLocale.split('-')[0]]
  const value = (key: 'name' | 'description') => keys.map(code => plugin.locales?.[code]?.[key]).find(text => text?.trim()) || plugin[key]
  return { name: value('name'), description: value('description') }
}
export function marketPage(plugins: MarketPlugin[], query: string, page: number, locale: string, size = 12) {
  const needle = query.trim().toLowerCase()
  const filtered = plugins.filter(plugin => {
    const text = marketText(plugin, locale)
    return [plugin.id, plugin.name, plugin.description, plugin.author, text.name, text.description].join(' ').toLowerCase().includes(needle)
  })
  const pages = Math.max(1, Math.ceil(filtered.length / size))
  const current = Math.min(pages, Math.max(1, page))
  return { items: filtered.slice((current - 1) * size, current * size), total: filtered.length, page: current, pages }
}

/** Publish cache immediately, then refresh only when its TTL has elapsed. */
export async function loadMarketCatalog(
  request: (path: string, signal: AbortSignal) => Promise<MarketSnapshot>,
  forceRefresh: boolean, publish: (snapshot: MarketSnapshot) => void, signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return
  const first = await request(forceRefresh ? '/market?refresh=1' : '/market?cached=1', signal)
  if (signal.aborted) return
  publish(first)
  if (!forceRefresh && first.revalidate) {
    const refreshed = await request('/market?refresh=1', signal)
    if (!signal.aborted) publish(refreshed)
  }
}
