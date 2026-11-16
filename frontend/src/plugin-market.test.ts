import test from 'node:test'
import assert from 'node:assert/strict'
import { loadMarketCatalog, type MarketSnapshot, compareVersions, selectMarketRelease, marketPage, marketText, marketStatus, type MarketPlugin } from './plugins/market.js'
const plugin: MarketPlugin = { id: 'dev.example', name: '大纲', description: '标题导航', author: 'Dev', license: 'MIT', sourceUrl: '', defaultLocale: 'en', locales: { en: { name: 'Outline', description: 'Heading navigation' } }, latestVersion: '0.2.0', releases: [
 { version: '0.2.0', apiVersion: 1, minAppVersion: '0.2.0', capabilities: [], file: 'new.zip', downloadUrl: '', size: 12, sha256: '' },
 { version: '0.1.10', apiVersion: 1, minAppVersion: '0.1.0', capabilities: [], file: 'old.zip', downloadUrl: '', size: 12, sha256: '' },
 { version: '0.1.9', apiVersion: 1, minAppVersion: '0.1.0', capabilities: [], file: 'older.zip', downloadUrl: '', size: 12, sha256: '' },
] }
test('market selects latest compatible version using numeric semver and API version', () => {
 assert.equal(compareVersions('0.1.10', 'v0.1.9'), 1)
 assert.equal(selectMarketRelease(plugin, 'v0.1.1')?.version, '0.1.10')
 assert.equal(selectMarketRelease({ ...plugin, releases: plugin.releases.map(r => ({ ...r, apiVersion: 2 })) }, 'v0.1.1'), undefined)
 assert.equal(selectMarketRelease(plugin, '')?.version, undefined)
 assert.equal(compareVersions('bad', '0.1.0'), null)
})
test('market actions preserve newer local plugins and never imply automatic downgrade', () => {
 const release = selectMarketRelease(plugin, '0.1.1')!
 assert.equal(marketStatus(release), 'install')
 assert.equal(marketStatus(release, '0.1.9'), 'upgrade')
 assert.equal(marketStatus(release, '0.1.10'), 'installed')
 assert.equal(marketStatus(release, '0.2.0'), 'newer')
 assert.equal(marketStatus(undefined, '0.1.0'), 'incompatible')
})
test('market pagination clamps after search and localizes names with fallback', () => {
 const plugins = Array.from({ length: 25 }, (_, i) => ({ ...plugin, id: `dev.item${i}` }))
 assert.equal(marketPage(plugins, '', 3, 'zh', 12).items.length, 1)
 assert.equal(marketPage(plugins, '', 99, 'zh', 12).page, 3)
 assert.equal(marketPage(plugins, 'item0', 3, 'zh', 12).page, 1)
 assert.equal(marketPage(plugins, 'missing', 1, 'zh', 12).total, 0)
 assert.equal(marketPage(plugins, 'Outline', 1, 'en-US', 12).total, 25)
 assert.equal(marketText(plugin, 'en-US').name, 'Outline')
 assert.equal(marketText(plugin, 'zh-CN').name, 'Outline')
 assert.equal(marketText({ ...plugin, locales: { zh: { name: '笔记大纲' } } }, 'zh-CN').name, '笔记大纲')
})

test('market semver distinguishes prereleases and rejects malformed numeric versions', () => {
 assert.equal(compareVersions('0.2.0-beta.2', '0.2.0-beta.11'), -1)
 assert.equal(compareVersions('0.2.0', '0.2.0-beta.11'), 1)
 assert.equal(compareVersions('0.2.0-beta', '0.2.0-alpha'), 1)
 assert.equal(compareVersions('0.2.0-beta', '0.2.0-beta.1'), -1)
 assert.equal(compareVersions('01.2.0', '1.2.0'), null)
 assert.equal(compareVersions('0.2.0-beta.01', '0.2.0'), null)
})

test('market publishes an expired cache before waiting for background refresh', async () => {
 const cached: MarketSnapshot = { catalog: { schemaVersion: 1, updatedAt: '', plugins: [plugin] }, appVersion: 'v0.1.1', fetchedAt: '2026-11-16T00:00:00Z', stale: false, revalidate: true }
 const fresh = { ...cached, fetchedAt: '2026-11-16T01:00:00Z', revalidate: false }
 const paths: string[] = [], shown: string[] = []
 let finish!: (value: MarketSnapshot) => void
 const task = loadMarketCatalog(async path => {
  paths.push(path)
  if (paths.length === 1) return cached
  return new Promise<MarketSnapshot>(resolve => { finish = resolve })
 }, false, value => shown.push(value.fetchedAt), new AbortController().signal)
 await new Promise(resolve => setTimeout(resolve, 0))
 assert.deepEqual(shown, [cached.fetchedAt])
 assert.deepEqual(paths, ['/market?cached=1', '/market?refresh=1'])
 finish(fresh);await task
 assert.deepEqual(shown, [cached.fetchedAt, fresh.fetchedAt])
})
test('fresh cache skips revalidation and cancelled refresh never publishes late results', async () => {
 const cached: MarketSnapshot = { catalog: { schemaVersion: 1, updatedAt: '', plugins: [] }, appVersion: 'v0.1.1', fetchedAt: '', stale: false }
 let calls = 0
 await loadMarketCatalog(async () => { calls++;return cached }, false, () => {}, new AbortController().signal)
 assert.equal(calls, 1)
 const controller = new AbortController(), shown: MarketSnapshot[] = []
 await loadMarketCatalog(async () => { controller.abort();return cached }, true, value => shown.push(value), controller.signal)
 assert.equal(shown.length, 0)
})

test('failed background refresh preserves the published cached catalog', async () => {
 const cached: MarketSnapshot = { catalog: { schemaVersion: 1, updatedAt: '', plugins: [plugin] }, appVersion: 'v0.1.1', fetchedAt: '2026-11-16T00:00:00Z', stale: false, revalidate: true }
 const shown: MarketSnapshot[] = [];let calls = 0, failed = false
 try { await loadMarketCatalog(async () => { if (++calls === 1) return cached;throw new Error('Offline') }, false, value => shown.push(value), new AbortController().signal) }
 catch { failed = true }
 assert.equal(failed, true)
 assert.equal(shown.length, 1)
 assert.equal(shown[0], cached)
})
test('cancelling a background refresh keeps cache and ignores the late response', async () => {
 const cached: MarketSnapshot = { catalog: { schemaVersion: 1, updatedAt: '', plugins: [plugin] }, appVersion: 'v0.1.1', fetchedAt: 'cached', stale: false, revalidate: true }
 const controller = new AbortController(), shown: string[] = []
 let finish!: (value: MarketSnapshot) => void, calls = 0
 const task = loadMarketCatalog(async () => ++calls === 1 ? cached : new Promise<MarketSnapshot>(resolve => { finish = resolve }), false, value => shown.push(value.fetchedAt), controller.signal)
 await new Promise(resolve => setTimeout(resolve, 0))
 controller.abort();finish({ ...cached, fetchedAt: 'late' });await task
 assert.deepEqual(shown, ['cached'])
})
