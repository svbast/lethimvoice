import { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'

import './styles/theme.css'

// Lazy-load to keep the compact pill bundle minimal — the settings window pulls
// in icons, splash image and section views that compact mode never needs.
const View = lazy(() =>
	new URLSearchParams(window.location.search).get('mode') === 'compact'
		? import('./windows/RecordingPill')
		: import('./windows/SettingsWindow/SettingsWindow'),
)

const root = document.getElementById('root')
if (!root) throw new Error('index.html is missing #root')
ReactDOM.createRoot(root).render(
	<Suspense fallback={null}>
		<View />
	</Suspense>,
)
