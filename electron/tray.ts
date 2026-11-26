import path from 'node:path'

import { app, Menu, type MenuItemConstructorOptions, Tray } from 'electron'

import { type Key, t } from './i18n'
import { BUILTIN_MODES } from './pipeline/prompts'
import { loadSettings, type Settings } from './store/settings'
import { installUpdate, updateState } from './updater'
import { config } from './utils/config'
import { LANGUAGE_NAMES, RECOGNITION_LANGUAGES } from './utils/languages'
import {
	getRecordingWindow,
	getSettingsWindow,
	isDev,
	showSettings,
} from './windows'

let tray: Tray | null = null
// Saves a choice made in the menu (main.ts: like a settings-window change, sent to
// every window). Handed in, not imported: ipc/settings refreshes this menu.
let choose: (patch: Partial<Settings>) => void = () => undefined

const devTools = (label: Key, win: () => Electron.BrowserWindow) => ({
	click: () => win().webContents.openDevTools({ mode: 'detach' }),
	label: t(label),
})

const choice = (
	label: string,
	checked: boolean,
	patch: Partial<Settings>,
): MenuItemConstructorOptions => ({
	checked,
	click: () => choose(patch),
	label,
	type: 'radio',
})

const switches = (s: Settings): MenuItemConstructorOptions[] => {
	const mode = s.activeModeId || 'clean'
	return [
		{ type: 'separator' },
		{
			label: t('modes.section.label'),
			submenu: [
				...BUILTIN_MODES.map(({ id }) =>
					choice(t(`modes.${id}.title` as Key), id === mode, {
						activeModeId: id,
					}),
				),
				...s.modes.map(({ id, title }) =>
					choice(title || t('modes.untitled'), id === mode, {
						activeModeId: id,
					}),
				),
			],
		},
		{
			label: t('preferences.recognitionLanguage'),
			submenu: RECOGNITION_LANGUAGES.map((code) =>
				choice(LANGUAGE_NAMES[code] ?? code, code === s.language, {
					language: code,
				}),
			),
		},
	]
}

const buildMenu = () => {
	const s = loadSettings()
	const update = updateState()
	return Menu.buildFromTemplate([
		{ click: showSettings, label: t('common.settings') },
		...(update.phase === 'ready'
			? [
					{
						click: installUpdate,
						label: t('tray.update', { version: update.version ?? '' }),
					},
				]
			: []),
		...(isDev
			? [
					devTools('tray.devRecording', getRecordingWindow),
					devTools('tray.devSettings', getSettingsWindow),
				]
			: []),
		...switches(s),
		{ type: 'separator' },
		{ click: () => app.quit(), label: t('tray.quit') },
	])
}

// Windows: multi-size ICO so Electron's GetHICON(SM_CXSMICON) gets a real bitmap
// per DPI. macOS: Template suffix makes menu bar tint it and pick @2x.
const TRAY_ICON: Partial<Record<NodeJS.Platform, string>> = {
	darwin: 'trayTemplate.png',
	win32: 'tray.ico',
}

export const createTray = (onChoose: typeof choose) => {
	choose = onChoose
	tray = new Tray(
		path.join(
			app.getAppPath(),
			'assets',
			TRAY_ICON[process.platform] ?? 'tray.png',
		),
	)
	tray.setToolTip(config.appName)
	tray.setContextMenu(buildMenu())
	tray.on('click', showSettings)
}

export const refreshTray = () => tray?.setContextMenu(buildMenu())
