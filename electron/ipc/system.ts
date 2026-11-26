import { app, BrowserWindow } from 'electron'
import { setAutostart } from '../autostart'
import { mac } from '../permissions'
import { configure, setCaptureMode } from '../shortcuts'
import { checkForUpdate, installUpdate, updateState } from '../updater'
import { getSettingsWindow, showSettings } from '../windows'
import type { Handler } from '.'

export const handlers = {
	'check-update': () => checkForUpdate(),
	// Wayland: the compositor owns the push-to-talk binding, so "change shortcut"
	// opens ITS dialog, not our capture UI. No-op on other backends.
	'configure-shortcuts': () => configure().catch(() => undefined),

	// macOS-only permission gate; elsewhere resolves undefined; renderer gate
	// renders nothing.
	'get-permissions': () => mac?.getPermissionStatus(),
	'get-update': () => updateState(),

	'hide-window': (e) => {
		BrowserWindow.fromWebContents(e.sender)?.hide()
	},

	'install-update': () => installUpdate(),

	'minimize-window': (e) => {
		BrowserWindow.fromWebContents(e.sender)?.minimize()
	},
	'open-permission-settings': (_e, target: string) =>
		mac?.openSettingsPane(target),
	'prompt-accessibility': () => mac?.promptAccessibility(),
	'set-autostart': (_e, enable: boolean) => {
		// Dev guard: unpackaged, process.execPath is node_modules electron.exe and
		// would register the bare Electron shell at every boot. Refuse.
		if (!app.isPackaged) {
			return
		}
		setAutostart(enable)
	},
	// Capture mode routes the next keypress to the capture UI instead of dictation.
	'set-shortcut-capture': (_e, on: boolean) => {
		setCaptureMode(on)
		if (!on) return
		showSettings()
		getSettingsWindow().focus()
	},
} satisfies Record<string, Handler>
