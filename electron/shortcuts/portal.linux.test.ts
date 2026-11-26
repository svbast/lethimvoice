import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from 'bun:test'
import { BrowserWindow } from 'electron'
import type { Response } from '../xdg-portal.linux'
import type * as PortalBackend from './portal.linux'

const requests: string[] = [] // member per Request
const preferred: (string | undefined)[] = [] // preferred_trigger per BindShortcuts
const calls: string[] = [] // member per plain call
const handlers: Record<string, (body: unknown[]) => void> = {}
const bound: (string | undefined)[] = []
let decline: string | null = null

const client = {
	call: (_iface: string, member: string) => {
		calls.push(member)
		return Promise.resolve()
	},
	closeSession: () => Promise.resolve(),
	onSignal(iface: string, member: string, handler: (body: unknown[]) => void) {
		handlers[`${iface}.${member}`] = handler
	},
	request(
		_iface: string,
		member: string,
		_signature: string,
		body: (handleToken: string) => unknown[],
	): Promise<Response> {
		requests.push(member)
		if (member === 'BindShortcuts') {
			const [shortcut] = body('token')[1] as [
				string,
				[string, [string, string]][],
			][]
			preferred.push(
				Object.fromEntries(shortcut?.[1] ?? []).preferred_trigger?.[1],
			)
		}
		if (decline === member) {
			decline = null
			return Promise.resolve([1, {}])
		}
		return Promise.resolve([
			0,
			member === 'CreateSession'
				? { session_handle: '/session/voice' }
				: { shortcuts: [['push-to-talk', { trigger_description: 'Alt+Q' }]] },
		])
	},
}
let portalClient = client
mock.module('../xdg-portal.linux', () => ({
	portal: () => Promise.resolve(portalClient),
}))
// The real broadcast() reaching one window. Not mock.module: that one is process-wide
// and would replace the module for every test file that loads it later.
const { getAllWindows } = BrowserWindow
const send = (_channel: string, payload: string | undefined) =>
	bound.push(payload)
Object.assign(BrowserWindow, {
	getAllWindows: () => [{ isDestroyed: () => false, webContents: { send } }],
})
afterAll(() => Object.assign(BrowserWindow, { getAllWindows }))

const signal = (member: string, session: string, ts: number) =>
	handlers[`GlobalShortcuts.${member}`]?.([
		session,
		'push-to-talk',
		BigInt(ts),
		[],
	])
const activate = (session: string, ts: number) =>
	signal('Activated', session, ts)
const deactivate = (session: string, ts: number) =>
	signal('Deactivated', session, ts)

// rebind runs close → create asynchronously; one macrotask drains it.
const settle = () => {
	const { promise, resolve } = Promise.withResolvers<void>()
	setTimeout(resolve, 0)
	return promise
}
const rebindTo = async (portal: typeof PortalBackend, stored: string) => {
	portal.setShortcut(stored)
	portal.rebind()
	await settle()
	return preferred.at(-1)
}

describe('portal backend', () => {
	const portal: typeof PortalBackend = require('./portal.linux')
	let presses = 0
	let releases = 0

	beforeAll(async () => {
		portal.setShortcut('Alt+Q')
		await portal.bind({
			onPress: () => {
				presses += 1
			},
			onRelease: () => {
				releases += 1
			},
		})
	})
	beforeEach(() => {
		presses = 0
		releases = 0
		calls.length = 0
	})

	it('binds once per session and reports what the compositor bound', () => {
		expect(requests).toEqual(['CreateSession', 'BindShortcuts'])
		expect(preferred).toEqual(['ALT+q'])
		expect(portal.trigger()).toBe('Alt+Q')
		expect(bound).toEqual(['Alt+Q'])
		handlers['GlobalShortcuts.ShortcutsChanged']?.([
			'/session/voice',
			[['push-to-talk', { trigger_description: 'Ctrl+Space' }]],
		])
		expect(portal.trigger()).toBe('Ctrl+Space')
	})

	it('one hold is one press/release: repeats while held, other sessions, and a stray Deactivated are ignored', () => {
		activate('/session/voice', 1100)
		activate('/session/voice', 1150) // GNOME key-repeat while still held
		activate('/session/other', 1160)
		deactivate('/session/other', 1170)
		deactivate('/session/voice', 1200)
		deactivate('/session/voice', 1250) // nothing is held anymore
		expect([presses, releases]).toEqual([1, 1])
	})

	it('a reconnected bus gets the signal handlers again', async () => {
		portalClient = { ...client }
		const installed = Object.keys(handlers).length
		for (const key of Object.keys(handlers)) delete handlers[key]
		portal.rebind()
		await settle()
		expect(Object.keys(handlers)).toHaveLength(installed)
		activate('/session/voice', 1400)
		deactivate('/session/voice', 1500)
		expect([presses, releases]).toEqual([1, 1])
	})

	it('shortcut → spec trigger: keysym names, single keys, arrows; a lone modifier sends none', async () => {
		expect(await rebindTo(portal, 'Ctrl+PageUp')).toBe('CTRL+Page_Up')
		expect(await rebindTo(portal, 'F9')).toBe('F9')
		expect(await rebindTo(portal, 'Ctrl+Right')).toBe('CTRL+Right') // arrow, not a modifier
		expect(await rebindTo(portal, 'MetaRight')).toBeUndefined()
		expect(requests.at(-1)).toBe('BindShortcuts') // still bound, just no preference
	})

	it('a key-repeat Activated stamped at or before the last Deactivated does not re-arm', () => {
		activate('/session/voice', 1800)
		deactivate('/session/voice', 1900)
		activate('/session/voice', 1900)
		expect([presses, releases]).toEqual([1, 1])
	})

	it('ConfigureShortcuts is a plain call: a Request would wait for a Response that never comes', async () => {
		await portal.configure()
		expect(calls).toEqual(['ConfigureShortcuts'])
	})

	it('a declined BindShortcuts leaves no session and nothing bound', async () => {
		bound.length = 0
		decline = 'BindShortcuts'
		portal.rebind()
		await settle()
		expect(bound).toEqual([undefined, undefined])
		expect(portal.trigger()).toBeUndefined()

		calls.length = 0
		await portal.configure() // nothing to configure; no dialog
		expect(calls).toEqual([])
	})

	it('a declined CreateSession rejects the bind; after unbind, signals reach nobody', async () => {
		portal.unbind()
		decline = 'CreateSession'
		const noop = () => undefined
		await expect(
			portal.bind({ onPress: noop, onRelease: noop }),
		).rejects.toThrow('declined')
		activate('/session/voice', 3000)
		deactivate('/session/voice', 3100)
		expect([presses, releases]).toEqual([0, 0])
	})
})
