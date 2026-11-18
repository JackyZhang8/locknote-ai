import { lazy, Suspense, useEffect, useRef, useSyncExternalStore } from 'react'
import { BootOverlay } from './components/BootOverlay'
import { IconSymbols } from './components/IconSymbols'
import { WorkspaceShell } from './components/WorkspaceShell'
import { Overlays } from './components/Overlays'
import { PluginWorkspace } from './plugins/PluginWorkspace'
import { historyStore } from './history/bridge'
const HistoryWindow = lazy(() => import('./history/HistoryWindow').then(module => ({default: module.HistoryWindow})))

interface AppProps {
  onReady?: () => void
}

// Keep the existing uncontrolled inputs and controller-owned regions stable.
// Startup runs only after all React-created DOM nodes have been committed.
export default function App({ onReady }: AppProps) {
  const started = useRef(false)
  const history = useSyncExternalStore(historyStore.subscribe, historyStore.getSnapshot, historyStore.getSnapshot)

  useEffect(() => {
    if (!started.current && onReady) {
      started.current = true
      onReady()
    }
  }, [onReady])

  return (
    <>
      <BootOverlay />
      <IconSymbols />
      <WorkspaceShell />
      <Overlays />
      <PluginWorkspace />
      {history && <Suspense fallback={<div role="status" className="history-loading">{document.documentElement.lang.startsWith('zh') ? '正在加载历史对比…' : 'Loading history…'}</div>}><HistoryWindow /></Suspense>}
    </>
  )
}
