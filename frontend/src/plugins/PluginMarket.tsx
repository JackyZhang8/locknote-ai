import { useEffect, useRef, useState } from 'react'
import { pluginRuntime } from './runtime'
import { PluginDialog } from './PluginSettings'
import { currentLocale } from './i18n'
import { t, errorMessage } from './ui-text'
import { loadMarketCatalog, marketPage, marketText, marketStatus, selectMarketRelease, type MarketPlugin, type MarketRelease, type MarketSnapshot } from './market'
import type { PluginRecord } from './types'

function statusText(status: ReturnType<typeof marketStatus>) {
  switch (status) {
    case 'install': return t('安装', 'Install')
    case 'upgrade': return t('升级', 'Upgrade')
    case 'installed': return t('已安装', 'Installed')
    case 'newer': return t('本地版本较新', 'Newer local version')
    case 'incompatible': return t('不兼容', 'Incompatible')
  }
}
export function PluginMarketCard({ plugin, installed, appVersion, locale, busy, onInstall, onDetails }: {
  plugin: MarketPlugin; installed?: string; appVersion: string; locale: string; busy: boolean
  onInstall(plugin: MarketPlugin, release: MarketRelease): void; onDetails(plugin: MarketPlugin): void
}) {
  const text = marketText(plugin, locale), release = selectMarketRelease(plugin, appVersion), status = marketStatus(release, installed)
  return <article className="plugin-card plugin-market-card">
    <div className="plugin-card-head"><div><h4>{text.name}</h4><div className="plugin-card-meta"><span>v{release?.version || plugin.latestVersion}</span><span>{plugin.author}</span>{installed && <span>{t('本地：', 'Local: ')}v{installed}</span>}</div></div>
      <button className={status === 'install' || status === 'upgrade' ? 'primary' : 'ghost-btn'} disabled={busy || (status !== 'install' && status !== 'upgrade')} onClick={() => release && onInstall(plugin, release)}>{statusText(status)}</button>
    </div>
    <p className="plugin-muted">{text.description}</p>
    {!release && <p className="plugin-muted">{t('暂无适用于当前应用的版本，请更新应用或稍后重试。', 'No compatible release. Update the app or check again later.')}</p>}
    {release && release.version !== plugin.latestVersion && <p className="plugin-muted">{t('最新版本需要更新应用，当前展示可安装版本。', 'The latest release needs a newer app. Showing a compatible release.')}</p>}
    <div className="plugin-actions"><button className="ghost-btn" onClick={() => onDetails(plugin)}>{t('查看详情', 'Details')}</button>{release && <span className="plugin-muted">{Math.ceil(release.size / 1024)} KB</span>}</div>
  </article>
}
export function PluginMarket({ records, available, busy, onPrepare }: {
  records: PluginRecord[]; available: boolean; busy: boolean
  onPrepare(plugin: MarketPlugin, release: MarketRelease, signal: AbortSignal): Promise<void>
}) {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null)
  const [loading, setLoading] = useState(available), [error, setError] = useState('')
  const [query, setQuery] = useState(''), [page, setPage] = useState(1), [refresh, setRefresh] = useState(0)
  const [details, setDetails] = useState<MarketPlugin | null>(null), [downloading, setDownloading] = useState('')
  const request = useRef<AbortController | null>(null)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort() } }, [])
  useEffect(() => {
    if (!available) return
    const controller = new AbortController()
    setLoading(true); setError('')
    loadMarketCatalog(
      (path, signal) => pluginRuntime.api<MarketSnapshot>(path, { signal }),
      refresh > 0, setSnapshot, controller.signal,
    ).catch(reason => { if (!controller.signal.aborted) setError(errorMessage(reason)) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [available, refresh])
  async function prepare(plugin: MarketPlugin, release: MarketRelease) {
    if (request.current || busy) return
    const controller = new AbortController();request.current = controller
    setDownloading(marketText(plugin, currentLocale()).name); setError('')
    try { await onPrepare(plugin, release, controller.signal) }
    catch (reason) { if (!controller.signal.aborted && mounted.current) setError(errorMessage(reason)) }
    finally { if (request.current === controller) request.current = null;if (mounted.current) setDownloading('') }
  }
  const locale = currentLocale(), results = marketPage(snapshot?.catalog.plugins || [], query, page, locale)
  const detailRelease = details && selectMarketRelease(details, snapshot?.appVersion || '')
  const detailText = details && marketText(details, locale)
  const source = details?.sourceUrl && /^https:\/\//i.test(details.sourceUrl) ? details.sourceUrl : undefined
  return <section className="plugin-market" aria-busy={loading} aria-label={t('插件市场', 'Plugin market')}>
    <div className="plugin-market-tools"><input type="search" aria-label={t('搜索插件', 'Search plugins')} placeholder={t('搜索名称、介绍或作者', 'Search name, description or author')} value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} />
      <button className="ghost-btn" disabled={!available || loading || !!downloading || busy} onClick={() => setRefresh(value => value + 1)}>{t('刷新市场', 'Refresh market')}</button></div>
    {loading && <div className="plugin-market-loading">
      <p role="status" className="plugin-muted">{snapshot ? t('正在更新插件目录…', 'Updating plugin catalog…') : t('正在读取插件市场…', 'Loading plugin market…')}</p>
      <div className="plugin-market-loading-track" role="progressbar" aria-label={t('插件市场加载进度', 'Plugin market loading progress')}><span /></div>
    </div>}
    {error && <p className="plugin-error" role="alert">{error}</p>}
    {snapshot?.stale && <p className="plugin-safe" role="status">{t('暂时无法连接市场，当前显示本地缓存。', 'Market unavailable. Showing the local cache.')}</p>}
    {snapshot && <p className="plugin-muted">{t('官方插件 · 最近获取：', 'Official plugins · Last fetched: ')}{new Date(snapshot.fetchedAt).toLocaleString(locale)}</p>}
    {downloading && <div className="plugin-market-progress" role="status"><span>{t('正在下载并校验：', 'Downloading and verifying: ')}{downloading}</span><progress aria-label={t('插件下载进度', 'Plugin download progress')} /><button className="ghost-btn" onClick={() => request.current?.abort()}>{t('取消下载', 'Cancel download')}</button></div>}
    {results.items.map(plugin => <PluginMarketCard key={plugin.id} plugin={plugin} installed={records.find(record => record.manifest.id === plugin.id)?.manifest.version} appVersion={snapshot?.appVersion || ''} locale={locale} busy={busy || !!downloading || !available} onInstall={(item, release) => void prepare(item, release)} onDetails={setDetails} />)}
    {!loading && snapshot && !results.total && <p className="plugin-muted">{query ? t('没有找到匹配的插件。', 'No matching plugins.') : t('市场暂时没有插件。', 'No plugins available yet.')}</p>}
    {snapshot && <nav className="plugin-market-pages" aria-label={t('插件市场分页', 'Plugin market pagination')}><span className="plugin-muted">{t('共 ', 'Total: ')}{results.total}{t(' 个插件', ' plugins')}</span><button className="ghost-btn" disabled={results.page <= 1} onClick={() => setPage(results.page - 1)}>{t('上一页', 'Previous')}</button><span>{results.page} / {results.pages}</span><button className="ghost-btn" disabled={results.page >= results.pages} onClick={() => setPage(results.page + 1)}>{t('下一页', 'Next')}</button></nav>}
    {details && detailText && <PluginDialog title={detailText.name} onClose={() => setDetails(null)}>
      <p>{detailText.description}</p><p className="plugin-muted">ID: <code>{details.id}</code></p><p>{details.author} · {details.license}</p>
      <p>{t('最新发布：', 'Latest release: ')}v{details.latestVersion}</p>
      {detailRelease && <><p>{t('兼容版本：', 'Compatible release: ')}v{detailRelease.version} · {Math.ceil(detailRelease.size / 1024)} KB</p><p>{t('最低应用版本：', 'Minimum app version: ')}{detailRelease.minAppVersion} · API {detailRelease.apiVersion}</p><p>{t('声明能力：', 'Declared capabilities: ')}{detailRelease.capabilities.join(', ') || '—'}</p></>}
      {source && <p className="plugin-market-source">{t('源代码：', 'Source code: ')}<a className="about-link" href={source} target="_blank" rel="noopener noreferrer">{source}</a></p>}
      <p className="plugin-muted">{t('安装前会下载校验并展示确认框，不会自动启用。升级会停止插件，建议先结束正在进行的任务。', 'Packages are verified before confirmation and are not enabled automatically. Upgrading stops the plugin; finish ongoing tasks first.')}</p>
      <footer><button className="ghost-btn" onClick={() => setDetails(null)}>{t('关闭', 'Close')}</button>{detailRelease && ['install', 'upgrade'].includes(marketStatus(detailRelease, records.find(record => record.manifest.id === details.id)?.manifest.version)) && <button className="primary" disabled={busy || !!downloading || !available} onClick={() => { const plugin = details;setDetails(null);void prepare(plugin, detailRelease) }}>{t('下载并查看安装信息', 'Download and review')}</button>}</footer>
    </PluginDialog>}
  </section>
}
