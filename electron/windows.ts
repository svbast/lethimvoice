import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
	app,
	autoUpdater,
	BrowserWindow,
	type BrowserWindowConstructorOptions,
	screen,
	shell,
	type WebContents,
} from 'electron'

import { type Events, type Payload, send } from './ipc/broadcast'
import { config } from './utils/config'

// Close only hides; before-quit (tray Quit, Cmd+Q) lifts that. An update's
// restart closes the windows before before-quit fires, so it lifts it too.
let quitting = false
const quit = () => {
	quitting = true
}
app.on('before-quit', quit)
autoUpdater.on('before-quit-for-update', quit)

export const isDev = !(
	app.isPackaged || process.argv.includes('--fresh-user-data')
)
const webPreferences = {
	contextIsolation: true,
	nodeIntegration: false,
	preload: path.join(app.getAppPath(), 'dist-electron/preload.js'),
}
// macOS uses bundle icon; packaged Windows uses exe icon.
const ICONS: Partial<Record<NodeJS.Platform, string>> = {
	linux: 'assets/window.png',
	win32: 'assets/window.ico',
}
const icon = ICONS[process.platform]
const APP_ICON = icon && path.join(app.getAppPath(), icon)

const appUrl = (suffix = '') =>
	isDev
		? `http://localhost:${config.devPort}${suffix}`
		: pathToFileURL(path.join(app.getAppPath(), 'dist/index.html')).href +
			suffix

const PILL_W = 210
const PILL_H = 48
const PILL_WIN: BrowserWindowConstructorOptions = {
	backgroundColor: '#00000000',
	focusable: false,
	frame: false,
	hasShadow: false,
	height: PILL_H,
	resizable: false,
	show: false,
	skipTaskbar: true,
	transparent: true,
	// Non-activating panel: floats over other apps' fullscreen Spaces, no switch.
	...(process.platform === 'darwin' && { type: 'panel' }),
	webPreferences,
	width: PILL_W,
}

// One opaque surface in the theme's page colour (--background in src/styles/theme.css),
// so the window never flashes white or grey before the page paints.
const SETTINGS_WIN: BrowserWindowConstructorOptions = {
	backgroundColor: '#262624',
	center: true,
	fullscreenable: false,
	height: 720, // the window is designed at 960 × 720
	icon: APP_ICON,
	maximizable: false, // fixed-size CSS shell would stay top-left
	resizable: false,
	title: config.appName,
	titleBarStyle: 'hidden',
	webPreferences,
	width: 960,
}

let settingsWindow: BrowserWindow | null = null
let recordingWindow: BrowserWindow | null = null

// GPU loss leaves dead compositor surface (grey window); reload recreates it.
const killRenderer = (webContents: WebContents) => {
	const pid = webContents.getOSProcessId()
	if (!pid) return
	try {
		process.kill(pid, 'SIGKILL')
	} catch {
		/* already gone */
	}
}

export const recoverWindows = () => {
	for (const win of [settingsWindow, recordingWindow]) {
		if (win && !win.isDestroyed()) killRenderer(win.webContents)
	}
}

// Exact page match, query ignored (?mode=compact); prefix test would admit
// localhost:52730 in dev.
const isAppPage = (url: string) => {
	const u = new URL(url)
	u.search = ''
	return u.href === new URL(appUrl()).href
}

const setup = (win: BrowserWindow, url: string) => {
	const { webContents } = win
	win.on('close', (e) => {
		if (!quitting) {
			e.preventDefault()
			win.hide()
		}
	})
	// Only renderer can hide pill (it fades, then calls hide-window); dead renderer
	// leaves a transparent always-on-top window on screen.
	// Cap reloads: oom/launch-failed reproduce on load, would loop.
	let reloads = 0
	const reload = () => {
		if (win.isDestroyed() || ++reloads > 3) return
		if (win === recordingWindow) win.hide()
		webContents.reload()
	}
	webContents.on('did-finish-load', () => {
		reloads = 0
	})
	webContents.on('render-process-gone', (_e, { reason }) => {
		if (!quitting && reason !== 'clean-exit') reload()
	})
	// Hung renderer can't service reload(); crash it, handler above recovers.
	webContents.on('unresponsive', () => killRenderer(webContents))
	webContents.on('will-navigate', (e, target) => {
		if (!isAppPage(target)) e.preventDefault()
	})
	webContents.setWindowOpenHandler(({ url: target }) => {
		if (target.startsWith('https:')) shell.openExternal(target)
		return { action: 'deny' }
	})
	win.loadURL(url)
}

export const getSettingsWindow = (): BrowserWindow => {
	if (settingsWindow && !settingsWindow.isDestroyed()) return settingsWindow
	// Never alwaysOnTop: with skipTaskbar became unfocusable by click.
	settingsWindow = new BrowserWindow(SETTINGS_WIN)
	// The app draws its own hide and minimize lights on every OS (the sidebar's brand
	// row); macOS's traffic lights would be a second set. Cmd+W and Cmd+M keep working
	// through Electron's default menu.
	if (process.platform === 'darwin')
		settingsWindow.setWindowButtonVisibility(false)
	setup(settingsWindow, appUrl())
	// macOS: a Dock icon only while settings are open, a menu-bar app otherwise.
	// Accessory apps' panels show over other apps' full-screen Spaces reliably
	// (Handy, OpenWhispr do the same). Minimized keeps the icon to restore from.
	if (process.platform === 'darwin') {
		settingsWindow.on('show', () => app.dock?.show())
		settingsWindow.on('hide', () => app.dock?.hide())
	}
	return settingsWindow
}

export const showSettings = () => {
	const win = getSettingsWindow()
	if (win.isMinimized()) win.restore() // show() no-ops on a minimized window
	win.show()
}

export const getRecordingWindow = (): BrowserWindow => {
	if (recordingWindow && !recordingWindow.isDestroyed()) return recordingWindow
	recordingWindow = new BrowserWindow(PILL_WIN)
	recordingWindow.setAlwaysOnTop(true, 'screen-saver')
	recordingWindow.webContents.setBackgroundThrottling(false) // hidden getUserMedia
	setup(recordingWindow, appUrl('?mode=compact'))
	return recordingWindow
}

// Bottom-right of the display under the pointer, where the user is working
// (VoiceInk, Handy, OpenWhispr); the primary display may be another monitor.
const placePill = (win: BrowserWindow) => {
	const wa = screen.getDisplayNearestPoint(
		screen.getCursorScreenPoint(),
	).workArea
	win.setBounds({
		height: PILL_H,
		width: PILL_W,
		x: wa.x + wa.width - PILL_W - 12,
		y: wa.y + wa.height - PILL_H - 12,
	})
}

export const showRecording = () => {
	const win = getRecordingWindow()
	// A shown pill (a re-press while it fades out or transcribes) stays put.
	const placing = !win.isVisible()
	if (placing) {
		placePill(win)
		// Per show: a topmost window that appeared since (a screen-share bar, a
		// game) would otherwise stay above it.
		win.setAlwaysOnTop(true, 'screen-saver')
	}
	// Never show(): on Windows and Linux it calls Activate(), on macOS it makes the
	// panel key; either can take the focus the paste needs.
	win.showInactive()
	if (placing) {
		// Shown on a monitor of another scale, Windows re-sizes and re-places it
		// (Handy re-places after show too).
		placePill(win)
		// SetWindowPos(HWND_TOP, SWP_NOACTIVATE): top of the topmost band. Elsewhere
		// moveTop() can activate (X11) or is not needed.
		if (process.platform === 'win32') win.moveTop()
	}
	// Always: re-press inside pill's 180 ms fade-out must cancel pending hide.
	send(win.webContents, 'window-shown')
	send(win.webContents, 'shortcut', 'pressed')
}

export const sendToRecording = <C extends keyof Events>(
	channel: C,
	...payload: Payload<C>
) => {
	// No getter: late hide/settings event during teardown must not respawn pill.
	if (recordingWindow && !recordingWindow.isDestroyed())
		send(recordingWindow.webContents, channel, ...payload)
}

export const hideRecording = () => sendToRecording('should-hide')
