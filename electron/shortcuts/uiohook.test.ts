import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	jest,
	mock,
} from 'bun:test'
import { EventEmitter } from 'node:events'
import type { UiohookKeyboardEvent } from 'uiohook-napi'
import type * as Uiohook from './uiohook'

const hook = Object.assign(new EventEmitter(), {
	start() {
		this.starts++
	},
	starts: 0,
	stop() {
		this.stops++
	},
	stops: 0,
})

// Any name is a key; each gets a distinct code on first use.
const codes = new Map<string, number>()
const K = (name: string) => {
	if (!codes.has(name)) codes.set(name, codes.size + 1)
	return codes.get(name) as number
}
mock.module('uiohook-napi', () => ({
	UiohookKey: new Proxy({}, { get: (_t, name: string) => K(name) }),
	uIOhook: hook,
}))

// What the OS says about the keys right now (keystate.ts); undefined = can't tell.
let osHeld: boolean | undefined
let masks = 0
mock.module('./keystate', () => ({
	isHeld: () => osHeld,
	maskMenu: (keys: { alt: boolean; modifierOnly: boolean }) => {
		if (keys.alt && !keys.modifierOnly) masks++
	},
}))

const press = (keycode: number, mods: Partial<UiohookKeyboardEvent> = {}) =>
	hook.emit('keydown', { keycode, ...mods })
const release = (keycode: number) => hook.emit('keyup', { keycode })

const fresh = (): typeof Uiohook => {
	delete require.cache[require.resolve('./uiohook')]
	return require('./uiohook')
}

describe('uiohook backend', () => {
	let uiohook: typeof Uiohook
	let presses = 0
	let releases = 0
	let aborts = 0

	beforeEach(() => {
		osHeld = true
		hook.removeAllListeners()
		uiohook = fresh()
		presses = 0
		releases = 0
		aborts = 0
		uiohook.bind({
			onAbort: () => aborts++,
			onPress: () => presses++,
			onRelease: () => releases++,
		})
	})
	afterEach(() => uiohook.unbind())

	it('a combo fires only on its exact keycode + modifier set; keyup matches keycode alone', () => {
		uiohook.setShortcut('Alt+Q')
		press(K('Q')) // no Alt
		press(K('Q'), { altKey: true, shiftKey: true }) // extra modifier
		press(K('W'), { altKey: true }) // other key
		expect(presses).toBe(0)
		press(K('Q'), { altKey: true })
		release(K('Q')) // Alt already released, as users do
		expect([presses, releases]).toEqual([1, 1])
	})

	it('an Alt combo masks the bare Alt tap its eaten key leaves; a modifier hold does not', () => {
		masks = 0
		uiohook.setShortcut('Alt+Q')
		press(K('Q'), { altKey: true })
		press(K('Q'), { altKey: true }) // autorepeat: one mask per hold
		release(K('Q'))
		uiohook.setShortcut('AltRight')
		press(K('AltRight'))
		expect(masks).toBe(1)
	})

	it('capture mode and an unparseable shortcut both leave the hook inert', () => {
		uiohook.setShortcut('Alt+Q')
		uiohook.setCaptureMode(true)
		press(K('Q'), { altKey: true })
		release(K('Q'))
		uiohook.setCaptureMode(false)
		uiohook.setShortcut('Alt+NoSuchKey')
		press(K('Q'), { altKey: true })
		expect([presses, releases]).toEqual([0, 0])
	})

	it('an aborted chord is forgotten on the modifier keyup, no rebind needed', () => {
		uiohook.setShortcut('MetaRight')
		press(K('MetaRight'))
		press(K('C'))
		release(K('MetaRight'))
		expect([presses, releases, aborts]).toEqual([1, 0, 1]) // ⌘C: no stop, one abort
		press(K('MetaRight'))
		release(K('MetaRight'))
		expect([presses, releases]).toEqual([2, 1])
	})

	it('a keyup swallowed by the lock screen: rebind ends the hold and re-arms the shortcut', () => {
		osHeld = undefined // OS can't tell: only rebind recovers
		uiohook.setShortcut('Alt+Q')
		press(K('Q'), { altKey: true })
		press(K('Q'), { altKey: true })
		expect(presses).toBe(1)
		const startsBefore = hook.starts
		uiohook.rebind()
		expect(hook.starts).toBe(startsBefore + 1)
		expect(releases).toBe(1) // the pill must not record on
		press(K('Q'), { altKey: true })
		release(K('Q'))
		expect([presses, releases]).toEqual([2, 2])
	})

	it('a keyup lost while held: two "up" reads from the OS end the hold', () => {
		jest.useFakeTimers()
		try {
			uiohook.setShortcut('Alt+Q')
			press(K('Q'), { altKey: true })
			jest.advanceTimersByTime(1000)
			expect(releases).toBe(0) // still held: never cut short
			osHeld = false
			jest.advanceTimersByTime(200)
			expect(releases).toBe(0) // one read is not enough
			osHeld = true
			jest.advanceTimersByTime(200)
			osHeld = false
			jest.advanceTimersByTime(400)
			expect(releases).toBe(1)
			release(K('Q')) // late keyup after the recovered release: ignored
			press(K('Q'), { altKey: true })
			expect([presses, releases]).toEqual([2, 1])
		} finally {
			jest.useRealTimers()
		}
	})

	it('a state API that never sees the key held (no permission) never ends a hold', () => {
		jest.useFakeTimers()
		try {
			osHeld = false
			uiohook.setShortcut('MetaRight')
			press(K('MetaRight'))
			jest.advanceTimersByTime(5000)
			expect(releases).toBe(0)
			release(K('MetaRight'))
			expect(releases).toBe(1)
		} finally {
			jest.useRealTimers()
		}
	})

	it('modifier-only shortcut: an aborted chord wedges the same way and recovers', () => {
		uiohook.setShortcut('MetaRight')
		press(K('MetaRight'))
		press(K('C'))
		press(K('MetaRight'))
		expect([presses, aborts]).toEqual([1, 1])
		uiohook.rebind()
		press(K('MetaRight'))
		expect(presses).toBe(2)
	})

	it('rebind before bind must not start a hook that was never installed', () => {
		const startsBefore = hook.starts
		fresh().rebind()
		expect(hook.starts).toBe(startsBefore)
	})

	it('forked as a utilityProcess: drives the same hook over parentPort', () => {
		const posted: unknown[] = []
		const port = Object.assign(new EventEmitter(), {
			postMessage: (m: unknown) => posted.push(m),
		})
		Object.defineProperty(process, 'parentPort', {
			configurable: true,
			value: port,
		})
		try {
			hook.removeAllListeners()
			fresh()
			port.emit('message', {
				data: { shortcut: 'Alt+Q', type: 'shortcut' },
			})
			press(K('Q'), { altKey: true })
			release(K('Q'))
			const startsBefore = hook.starts
			port.emit('message', { data: { type: 'rebind' } })
			expect(hook.starts).toBe(startsBefore + 1)
			expect(posted).toEqual([
				{ type: 'ready' },
				{ type: 'press' },
				{ type: 'release' },
			])
		} finally {
			Object.defineProperty(process, 'parentPort', {
				configurable: true,
				value: undefined,
			})
		}
	})
})
