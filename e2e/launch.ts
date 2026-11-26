import type { Page } from '@playwright/test'
import { _electron as electron } from '@playwright/test'

// The built app on a fresh profile, once Playwright has its settings window.
// `onWindow` subscribes before the wait, so it sees the windows attach.
export async function launch(onWindow?: (page: Page) => void) {
	const app = await electron.launch({ args: ['.', '--fresh-user-data'] })
	if (onWindow) app.on('window', onWindow)
	// BrowserWindows exist before Playwright has attached to their pages;
	// windows() is empty until then. Settings + pill = two.
	while (app.windows().length < 2) await app.waitForEvent('window')
	const page = app.windows().find((p) => !p.url().includes('mode=compact'))
	if (!page) throw new Error('settings window not found')
	return { app, page }
}
