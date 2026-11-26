import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fake } from '../electron.mock'
import { loadSettings, saveSettings } from '../store/settings'
import { config } from '../utils/config'
import type * as PasteLinuxModule from './paste.linux'

type ExecCallback = (error: NodeJS.ErrnoException | null) => void
const realExecFile = execFile as unknown as (...a: unknown[]) => void
const PASTE_TOOLS = ['wtype', 'xdotool']

const session = (wayland: boolean) => Object.assign(config, { wayland })
const initialSession = config.wayland
const userData = fake.userData
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-paste-'))
fake.userData = dir
afterAll(() => {
	session(initialSession)
	fake.userData = userData
	fs.rmSync(dir, { force: true, recursive: true })
})
let rejectPortal = false
let failNextNotify = false
let sessionNumber = 0
let portalCalls = 0
let startTokens: string[] = []
let toolErrors: Record<string, NodeJS.ErrnoException | null> = {}
const execCalls: [string, string[]][] = []
const notifyKeys: [number, number][] = []
const requests: { member: string; body: unknown[] }[] = []

const client = {
	call: (_i: string, _m: string, _s: string, body: unknown[]) => {
		const [, , keycode, state] = body
		if (typeof keycode !== 'number' || typeof state !== 'number') {
			return Promise.reject(new Error('invalid key event'))
		}
		notifyKeys.push([keycode, state])
		if (failNextNotify) {
			failNextNotify = false
			return Promise.reject(new Error('injection failed'))
		}
		return Promise.resolve()
	},
	request: (
		_i: string,
		member: string,
		_s: string,
		bodyFactory: (token: string) => unknown[],
	): Promise<[number, Record<string, unknown>]> => {
		requests.push({ body: bodyFactory('test-token'), member })
		if (member === 'CreateSession') {
			sessionNumber += 1
			return Promise.resolve([
				0,
				{ session_handle: `/session/${sessionNumber}` },
			])
		}
		if (member === 'Start') {
			const restoreToken = startTokens.shift()
			return Promise.resolve([
				0,
				restoreToken ? { restore_token: restoreToken } : {},
			])
		}
		return Promise.resolve([0, {}])
	},
}

mock.module('../xdg-portal.linux', () => ({
	portal: () => {
		portalCalls += 1
		return rejectPortal
			? Promise.reject(new Error('portal unavailable'))
			: Promise.resolve(client)
	},
}))
mock.module('node:child_process', () => ({
	// Process-wide: every other caller (options argument included) gets the real one.
	execFile: (file: string, args: string[], ...rest: unknown[]) => {
		if (!PASTE_TOOLS.includes(file)) {
			realExecFile(file, args, ...rest)
			return
		}
		execCalls.push([file, args])
		;(rest.at(-1) as ExecCallback)(toolErrors[file] ?? null)
	},
}))

const fresh = (): typeof PasteLinuxModule => {
	delete require.cache[require.resolve('./paste.linux')]
	return require('./paste.linux')
}
const missing = (): NodeJS.ErrnoException =>
	Object.assign(new Error('not found'), { code: 'ENOENT' })

beforeEach(() => {
	session(true)
	rejectPortal = false
	failNextNotify = false
	sessionNumber = 0
	portalCalls = 0
	saveSettings({ ...loadSettings(), linuxRemoteDesktopToken: '' })
	startTokens = []
	toolErrors = {}
	for (const list of [execCalls, notifyKeys, fake.notifications, requests]) {
		list.length = 0
	}
})

describe('Wayland', () => {
	it('uses one RemoteDesktop session and emits evdev Shift+Insert transitions', async () => {
		expect(await fresh().simulatePaste()).toBe(true)
		expect(notifyKeys).toEqual([
			[42, 1],
			[110, 1],
			[110, 0],
			[42, 0],
		])
		expect(execCalls).toEqual([])
	})

	it('no portal and no wtype → wtype, then ONE notification', async () => {
		rejectPortal = true
		toolErrors = { wtype: missing() }
		const paste = fresh()
		expect(await paste.simulatePaste()).toBe(false)
		await paste.simulatePaste()
		expect(execCalls.map(([file]) => file)).toEqual(['wtype', 'wtype'])
		expect(fake.notifications).toHaveLength(1)
		expect(fake.notifications[0]).toContain('Press Ctrl+V to paste')
		expect(fake.notifications[0]).toContain('wtype')
	})

	it('persists a rotated restore token and supplies it when a failed session rebuilds', async () => {
		startTokens = ['rotated-token']
		failNextNotify = true
		const paste = fresh()
		await paste.simulatePaste()
		await paste.simulatePaste()
		expect(loadSettings().linuxRemoteDesktopToken).toBe('rotated-token')
		const selects = requests.filter(({ member }) => member === 'SelectDevices')
		const options = selects[1]?.body[1] as [string, unknown][]
		expect(options.find(([key]) => key === 'restore_token')).toEqual([
			'restore_token',
			['s', 'rotated-token'],
		])
	})
})

describe('X11', () => {
	it('starts with xdotool and never opens the Wayland portal', async () => {
		session(false)
		await fresh().simulatePaste()
		expect(execCalls).toEqual([
			['xdotool', ['key', '--clearmodifiers', 'shift+Insert']],
		])
		expect(portalCalls).toBe(0)
		expect(fake.notifications).toEqual([])
	})

	it('no xdotool → ONE notification naming xdotool', async () => {
		session(false)
		toolErrors = { xdotool: missing() }
		const paste = fresh()
		expect(await paste.simulatePaste()).toBe(false)
		await paste.simulatePaste()
		expect(execCalls.map(([file]) => file)).toEqual(['xdotool', 'xdotool'])
		expect(fake.notifications).toHaveLength(1)
		expect(fake.notifications[0]).toContain('xdotool')
		expect(fake.notifications[0]).not.toContain('wtype')
	})
})
