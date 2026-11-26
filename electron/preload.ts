import { contextBridge, ipcRenderer } from 'electron'

import type { Handlers } from './ipc'
import type { Events } from './ipc/broadcast'

type Args<H> = H extends (e: never, ...args: infer A) => unknown ? A : never
type Result<H> = H extends (...args: never[]) => infer R ? Awaited<R> : never

const bind =
	<C extends keyof Handlers>(channel: C) =>
	(...args: Args<Handlers[C]>): Promise<Result<Handlers[C]>> =>
		ipcRenderer.invoke(channel, ...args)

// Runtime allowlist for `on`; annotation keeps it equal to Events keys.
const CHANNELS: Record<keyof Events, true> = {
	'history-added': true,
	'local-runtime': true,
	'local-setup': true,
	'model-loading': true,
	'models-changed': true,
	progress: true,
	'settings-changed': true,
	shortcut: true,
	'shortcut-bound': true,
	'should-hide': true,
	'update-state': true,
	'window-shown': true,
}

const on = <C extends keyof Events>(
	channel: C,
	cb: (payload: Events[C]) => void,
) => {
	if (!Object.hasOwn(CHANNELS, channel))
		throw new Error(`unknown IPC channel: ${channel}`)
	const listener = (_e: unknown, payload: Events[C]) => cb(payload)
	ipcRenderer.on(channel, listener)
	return () => {
		ipcRenderer.removeListener(channel, listener)
	}
}

const api = {
	cancelDownload: bind('cancel-download'),
	checkUpdate: bind('check-update'),
	clearHistory: bind('clear-history'),
	configureShortcuts: bind('configure-shortcuts'),
	deleteAsset: bind('delete-asset'),
	deleteHistoryItem: bind('delete-history-item'),
	downloadAsset: bind('download-asset'),
	getAppState: bind('get-app-state'),
	getHistory: bind('get-history'),
	getLocalStatus: bind('get-local-status'),
	getModelStatus: bind('get-model-status'),
	getPermissions: bind('get-permissions'),
	getSettings: bind('get-settings'),
	getStats: bind('get-stats'),
	getUpdate: bind('get-update'),
	hideWindow: bind('hide-window'),
	installUpdate: bind('install-update'),
	localSetup: bind('local-setup'),
	minimizeWindow: bind('minimize-window'),
	on,
	openPermissionSettings: bind('open-permission-settings'),
	pasteText: bind('paste-text'),
	platform: process.platform,
	promptAccessibility: bind('prompt-accessibility'),
	retryGpu: bind('retry-gpu'),
	saveSettings: bind('save-settings'),
	setAutostart: bind('set-autostart'),
	setShortcutCapture: bind('set-shortcut-capture'),
	testApiKey: bind('test-api-key'),
	testLocal: bind('test-local'),
	// Raw ArrayBuffer: structured-cloned as bytes, never base64 (+33%) on wire.
	transcribe: bind('transcribe'),
}

export type Api = typeof api

contextBridge.exposeInMainWorld('electron', api)
