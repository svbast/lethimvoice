import { afterAll, beforeEach, describe, expect, it } from 'bun:test'

import { fake } from '../electron.mock'
import { config } from '../utils/config'
import type * as Index from './index'

// Both backends recorded, so the dispatcher's choice and ordering are visible.
// Installed through require.cache, not mock.module: that one is process-wide
// and would replace the real backends for the sibling test files too.
const log: string[] = []
let bindFails = false
let portalAvailable = true
const backend = (name: string) => ({
	bind: () => {
		log.push(`${name}.bind`)
		return bindFails ? Promise.reject(new Error('declined')) : undefined
	},
	rebind: () => log.push(`${name}.rebind`),
	setCaptureMode: (on: boolean) => log.push(`${name}.capture ${on}`),
	setShortcut: (s: string | undefined) => log.push(`${name}.shortcut ${s}`),
	trigger: () => `${name}-trigger`,
	unbind: () => log.push(`${name}.unbind`),
})
const stubs: Record<string, unknown> = {
	'../xdg-portal.linux': {
		portal: () => Promise.resolve({ hasInterface: () => portalAvailable }),
	},
	'./portal.linux': backend('portal'),
	'./uiohook': backend('uiohook'),
	'./uiohook.win': backend('uiohook'),
}
const install = () => {
	for (const [id, exports] of Object.entries(stubs)) {
		const filename = require.resolve(id)
		require.cache[filename] = { exports, filename, loaded: true } as NodeModule
	}
}
afterAll(() => {
	for (const id of Object.keys(stubs)) delete require.cache[require.resolve(id)]
})

const session = (wayland: boolean) => Object.assign(config, { wayland })
const initialSession = config.wayland
afterAll(() => session(initialSession))

const fresh = (): typeof Index => {
	delete require.cache[require.resolve('./index')]
	return require('./index')
}
const settle = () => {
	const { promise, resolve } = Promise.withResolvers<void>()
	setTimeout(resolve, 0)
	return promise
}
const handlers = { onPress: () => undefined, onRelease: () => undefined }

describe('shortcut backend dispatcher', () => {
	let shortcuts: typeof Index

	beforeEach(() => {
		install()
		log.length = 0
		fake.notifications.length = 0
		bindFails = false
		portalAvailable = true
		session(false)
		shortcuts = fresh()
	})

	it('state set before selection reaches the backend, in order, before the bind', async () => {
		shortcuts.setShortcut('Alt+Q')
		shortcuts.setCaptureMode(true)
		shortcuts.bind(handlers)
		shortcuts.bind(handlers) // second call: no second selection
		await settle()
		expect(log).toEqual([
			'uiohook.shortcut Alt+Q',
			'uiohook.capture true',
			'uiohook.bind',
		])
		expect(await shortcuts.status()).toEqual({
			backend: 'uiohook',
			trigger: 'uiohook-trigger',
		})
		expect(fake.notifications).toEqual([])
	})

	// The Wayland branch is gated on process.platform; these run on Linux only.
	describe.if(process.platform === 'linux')('Wayland', () => {
		it('with a GlobalShortcuts backend selects the portal', async () => {
			session(true)
			shortcuts.bind(handlers)
			await settle()
			expect(log).toEqual([
				'portal.shortcut undefined',
				'portal.capture false',
				'portal.bind',
			])
			expect((await shortcuts.status()).backend).toBe('portal')
		})

		it('without GlobalShortcuts: one notification, then the XWayland-only hook', async () => {
			session(true)
			portalAvailable = false
			shortcuts.bind(handlers)
			await settle()
			expect(fake.notifications).toHaveLength(1)
			expect(log.at(-1)).toBe('uiohook.bind')
			expect((await shortcuts.status()).backend).toBe('uiohook')
		})

		it('a backend failing mid-bind stays selected and is reported dead once', async () => {
			session(true)
			bindFails = true
			shortcuts.bind(handlers)
			await settle()
			expect(log.at(-1)).toBe('portal.bind')
			expect(fake.notifications).toHaveLength(1)
			expect((await shortcuts.status()).backend).toBe('portal')
			shortcuts.rebind() // resume/unlock retries the bind
			expect(log.at(-1)).toBe('portal.rebind')
		})
	})
})
