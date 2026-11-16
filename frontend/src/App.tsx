import { useEffect, useRef } from 'react'
import { BootOverlay } from './components/BootOverlay'
import { IconSymbols } from './components/IconSymbols'
import { WorkspaceShell } from './components/WorkspaceShell'
import { Overlays } from './components/Overlays'
import { PluginWorkspace } from './plugins/PluginWorkspace'
import { HistoryWindow } from './history/HistoryWindow'

interface AppProps {
  onReady?: () => void
}

// Keep the existing uncontrolled inputs and controller-owned regions stable.
// Startup runs only after all React-created DOM nodes have been committed.
export default function App({ onReady }: AppProps) {
  const started = useRef(false)

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
      <HistoryWindow />
    </>
  )
}
