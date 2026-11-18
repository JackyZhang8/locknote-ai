import { createRoot } from 'react-dom/client'
import App from './App'
import { installReactRendering } from './rendering'
import './runtime/startup.js'
import './styles.css'
import './runtime/svg.js'
import './runtime/markdown.js'
import './runtime/diagrams.js'
import './runtime/i18n.js'
import './runtime/list-performance.js'
import './runtime/window-controls.js'
import { startWorkspaceControls } from './workspace-controls.js'
import { startWorkspace } from './controller.js'
import { installPluginIntegration } from './plugins/integration'
import { installHistory } from './history/bridge'

installReactRendering()
installHistory()
installPluginIntegration()
const root = document.getElementById('root')
if (!root) throw new Error('Missing application root')

window.LNStartup?.mark('frontend.react.mount')
createRoot(root).render(
  <App onReady={() => {
    window.LNStartup?.mark('frontend.app.ready')
    startWorkspaceControls()
    startWorkspace()
  }} />,
)

// Controllers register native/delegated listeners once. Reload script changes
// so development never reuses a shell with stale one-time listeners.
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', ({ updates }) => {
    if (updates.some(update => update.type === 'js-update')) window.location.reload()
  })
}
