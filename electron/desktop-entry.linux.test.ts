import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type * as DesktopEntryModule from './desktop-entry.linux'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xdg-test-'))
const registry = path.join(root, 'data/applications/com.lethim.voice.desktop')
const autostart = path.join(root, 'cfg/autostart/com.lethim.voice.desktop')
const env = { ...process.env }
let entry: typeof DesktopEntryModule

beforeAll(() => {
	process.env.XDG_DATA_HOME = path.join(root, 'data')
	process.env.XDG_CONFIG_HOME = path.join(root, 'cfg')
	process.env.APPIMAGE = '/home/me/My "Apps"/100%/app$1.AppImage'
	delete require.cache[require.resolve('./utils/config')]
	delete require.cache[require.resolve('./desktop-entry.linux')]
	entry = require('./desktop-entry.linux')
})

afterAll(() => {
	process.env = env
	fs.rmSync(root, { force: true, recursive: true })
})

describe('ensureDesktopEntry', () => {
	it('writes a hidden entry with a spec-escaped Exec', () => {
		entry.ensureDesktopEntry()
		expect(fs.readFileSync(registry, 'utf8')).toBe(
			[
				'[Desktop Entry]',
				'Type=Application',
				'Name=LetHim Voice',
				'Exec="/home/me/My \\"Apps\\"/100%%/app\\$1.AppImage"',
				'Icon=lethim-voice',
				'NoDisplay=true',
				'',
			].join('\n'),
		)
	})

	it('does not rewrite unchanged content', () => {
		const before = fs.statSync(registry)
		fs.utimesSync(registry, 1, 1)
		entry.ensureDesktopEntry()
		expect(fs.statSync(registry).mtimeMs).toBeLessThan(before.mtimeMs)
	})
})

describe('autostart', () => {
	it('round-trips enable and disable', () => {
		entry.setAutostart(true)
		expect(fs.readFileSync(autostart, 'utf8')).toContain(
			'.AppImage" --autostart\n',
		)
		expect(fs.readFileSync(autostart, 'utf8')).not.toContain('NoDisplay')
		expect(entry.isAutostartEnabled()).toBe(true)
		entry.setAutostart(false)
		expect(fs.existsSync(autostart)).toBe(false)
		expect(entry.isAutostartEnabled()).toBe(false)
	})

	it('refreshes a stale Exec path on start', () => {
		entry.setAutostart(true)
		const current = fs.readFileSync(autostart, 'utf8')
		fs.writeFileSync(autostart, current.replace(/^Exec=.*$/mu, 'Exec="/old"'))
		entry.ensureDesktopEntry()
		expect(fs.readFileSync(autostart, 'utf8')).toBe(current)
	})

	it.each(['Hidden=true', 'X-GNOME-Autostart-enabled=false'])(
		'reads %s written by desktop settings as disabled',
		(line) => {
			entry.setAutostart(true)
			fs.appendFileSync(autostart, `${line}\n`)
			expect(entry.isAutostartEnabled()).toBe(false)
			entry.setAutostart(true)
			expect(entry.isAutostartEnabled()).toBe(true)
		},
	)
})
