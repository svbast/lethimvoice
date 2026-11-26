import fs from 'node:fs'
import path from 'node:path'

import { app, powerMonitor } from 'electron'
import { applySettings } from './applySettings'
import { setAutostart } from './autostart'
import { registerIpc } from './ipc'
import { broadcast } from './ipc/broadcast'
import { mac } from './permissions'
import { captureForegroundWindow } from './pipeline/paste'
import { killStale, reconcile } from './runtime/servers'
import * as shortcuts from './shortcuts'
import { loadSettings, saveSettings } from './store/settings'
import { createTray, refreshTray } from './tray'
import { startUpdater } from './updater'
import { config } from './utils/config'
import {
	getRecordingWindow,
	getSettingsWindow,
	hideRecording,
	recoverWindows,
	sendToRecording,
	showRecording,
	showSettings,
} from './windows'

// Throwaway userData. setPath throws on missing dir; must run pre-ready. A profile
// cannot delete itself (Chromium holds its files until exit), so each run clears
// the ones earlier runs left that are over an hour old.
if (process.argv.includes('--fresh-user-data')) {
	const temp = app.getPath('temp')
	const prefix = `${app.name}-preview-`
	for (const name of fs.readdirSync(temp)) {
		const at = Number(name.slice(prefix.length).split('-')[0])
		if (!(name.startsWith(prefix) && Date.now() - at > 3_600_000)) continue
		try {
			fs.rmSync(path.join(temp, name), { force: true, recursive: true })
		} catch {
			/* a parallel run is deleting it too (EPERM on Windows), or still uses it */
		}
	}
	const dir = path.join(temp, `${prefix}${Date.now()}-${process.pid}`)
	fs.mkdirSync(dir, { recursive: true })
	app.setPath('userData', dir)
}

// Hidden renderers get demoted; pill must answer the shortcut without waiting for promotion.
app.commandLine.appendSwitch('disable-renderer-backgrounding')

const bootstrap = () => {
	const settings = loadSettings()

	// Portal Registry needs <appId>.desktop pointing at current binary (AppImages move).
	try {
		if (process.platform === 'linux')
			require('./desktop-entry.linux').ensureDesktopEntry()

		// Once per install; never re-enrol an opt-out. A throwaway test profile
		// (--fresh-user-data) must not take over the installed app's login item.
		if (
			app.isPackaged &&
			!process.argv.includes('--fresh-user-data') &&
			!settings.autostartConfigured
		) {
			setAutostart(true)
			settings.autostartConfigured = true
			saveSettings(settings)
		}
	} catch {
		/* no desktop entry / login item — app still works */
	}

	killStale()
	// Mode or language switched from the tray: every window (Settings, pill) hears it.
	createTray((patch) => broadcast('settings-changed', applySettings(patch)))
	registerIpc()
	// The tray offers the restart once an update is downloaded.
	startUpdater(refreshTray)
	app.on('child-process-gone', (_e, details) => {
		if (details.type === 'GPU') recoverWindows()
	})
	getRecordingWindow()

	// wasOpenedAtLogin is macOS-only; elsewhere login entry carries --autostart.
	const openedAtLogin =
		process.platform === 'darwin'
			? app.getLoginItemSettings().wasOpenedAtLogin
			: process.argv.includes(config.autostartArg)
	// macOS: started at login, no settings open, so no Dock icon (windows.ts).
	if (openedAtLogin) app.dock?.hide()
	else getSettingsWindow()

	shortcuts.setShortcut(settings.shortcut)
	const bindShortcut = () =>
		shortcuts.bind({
			onAbort: () => {
				sendToRecording('shortcut', 'aborted')
				hideRecording()
			},
			onPress: () => {
				showRecording()
				captureForegroundWindow()
				// Local models released while idle load while the user speaks, not after.
				const s = loadSettings()
				if (s.backend === 'local') reconcile(s).catch(() => undefined)
			},
			onRelease: () => {
				sendToRecording('shortcut', 'released')
			},
		})
	// uiohook started untrusted fires the OS's own Accessibility prompt; in-app gate
	// drives the grant instead. Check is a cheap non-prompting query.
	if (!mac || mac.isAccessibilityTrusted()) bindShortcut()
	else {
		showSettings()
		const poll = setInterval(() => {
			if (!mac?.isAccessibilityTrusted()) return
			clearInterval(poll)
			bindShortcut()
		}, 1500)
		app.on('will-quit', () => clearInterval(poll))
	}

	// Lock screen swallows releases, wedges PTT; rebinding is idempotent.
	powerMonitor.on('resume', shortcuts.rebind)
	powerMonitor.on('unlock-screen', shortcuts.rebind)

	// Cloud gets no pre-warm: its first dictation pays the TLS handshake. Settings read
	// when the timer fires: a change saved in these 4 s must not be undone.
	setTimeout(() => reconcile(loadSettings()), 4000)
}

// Two instances on one userData fight over Chromium cache; a --fresh-user-data run
// (the e2e tests) has its own.
if (
	process.argv.includes('--fresh-user-data') ||
	app.requestSingleInstanceLock()
) {
	app.on('second-instance', () => showSettings())
	app.whenReady().then(bootstrap)
	app.on('window-all-closed', () => {
		/* subscribing disables quit-on-last-window */
	})
	app.on('will-quit', () => shortcuts.unbind())
} else {
	app.quit()
}
