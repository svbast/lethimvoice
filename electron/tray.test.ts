import { afterAll, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { MenuItemConstructorOptions } from 'electron'

import { fake } from './electron.mock'
import { loadSettings, saveSettings } from './store/settings'

const { createTray } = require('./tray')

// Its own settings dir: an earlier file may have deleted the one it pointed at.
const userData = fake.userData
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-tray-'))
fake.userData = dir
const before = loadSettings()
afterAll(() => {
	saveSettings(before) // settings are cached process-wide: hand the next file its own
	fake.userData = userData
	fs.rmSync(dir, { force: true, recursive: true })
})

const items = (menu: MenuItemConstructorOptions) =>
	menu.submenu as MenuItemConstructorOptions[]
const click = (item: MenuItemConstructorOptions | undefined) => {
	if (!item?.click) throw new Error('no such menu item')
	;(item.click as () => void)()
}

it('switches mode and language from the tray, the current ones checked', () => {
	saveSettings({
		...before,
		activeModeId: 'mine',
		language: 'sk',
		modes: [{ id: 'mine', promptText: 'Summarize.', title: 'Mine' }],
		uiLanguage: 'en',
	})
	const chosen: unknown[] = []
	createTray((patch: unknown) => chosen.push(patch))
	const [mode, language] = fake.trayMenu.filter((i) => i.submenu)
	if (!(mode && language)) throw new Error('no Mode / Language submenu')

	expect(items(mode).map((i) => i.label)).toEqual([
		'Clean',
		'Email',
		'Chat',
		'To Do List',
		'Rewrite',
		'Assistant',
		'Translate',
		'Raw',
		'Mine',
	])
	expect(items(mode).filter((i) => i.checked)).toHaveLength(1)
	expect(items(mode).find((i) => i.checked)?.label).toBe('Mine')
	expect(items(language).filter((i) => i.checked)).toHaveLength(1)
	expect(items(language).find((i) => i.checked)?.label).toBe('Slovak')

	click(items(language).find((i) => i.label === 'Czech'))
	click(items(mode)[0])
	expect(chosen).toEqual([{ language: 'cs' }, { activeModeId: 'clean' }])
})
