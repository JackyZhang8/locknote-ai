import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
const Settings = lazy(() => import('./PluginSettings').then(module => ({ default: module.PluginSettings })))
class LoadBoundary extends Component<{children: ReactNode}, {error: boolean}> {
  state = {error: false}
  static getDerivedStateFromError() { return {error: true} }
  render() { return this.state.error ? <p role="alert">{document.documentElement.lang.startsWith('zh') ? '加载失败，请重新打开应用。' : 'Loading failed. Reopen the application.'}</p> : this.props.children }
}
export function DeferredPluginSettings() {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const panel = document.querySelector('[data-panel=plugins]');if (!panel) return
    const check = () => { if (!panel.classList.contains('hidden')) setVisible(true) }
    check();const observer = new MutationObserver(check);observer.observe(panel, {attributes: true, attributeFilter: ['class']})
    return () => observer.disconnect()
  }, [])
  return <>{visible && <LoadBoundary><Suspense fallback={<p role="status">{document.documentElement.lang.startsWith('zh') ? '正在加载插件管理…' : 'Loading plugins…'}</p>}><Settings /></Suspense></LoadBoundary>}</>
}
