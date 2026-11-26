import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	jest,
} from 'bun:test'
import { type FakeChild, fake } from '../electron.mock'
import type * as UiohookWin from './uiohook.win'

const fresh = (): typeof UiohookWin => {
	delete require.cache[require.resolve('./uiohook.win')]
	return require('./uiohook.win')
}

const childAt = (index: number): FakeChild => {
	const child = fake.children[index]
	if (!child) throw new Error(`no child #${index}`)
	return child
}

describe('uiohook.win (Windows utilityProcess proxy)', () => {
	let win: typeof UiohookWin
	let got: string[] = []
	const listen = (tag: string) =>
		win.bind({
			onAbort: () => got.push(`${tag}:abort`),
			onPress: () => got.push(`${tag}:press`),
			onRelease: () => got.push(`${tag}:release`),
		})

	beforeAll(() => jest.useFakeTimers())
	afterAll(() => jest.useRealTimers())

	beforeEach(() => {
		fake.children.length = 0
		got = []
		win = fresh()
		win.setShortcut('Alt+Q')
		listen('a')
	})

	it('one child, state replayed at fork, every message type routed to the latest callbacks', () => {
		listen('b')
		expect(fake.children).toHaveLength(1)
		const child = childAt(0)
		win.rebind()
		expect(child.sent).toEqual([
			{ shortcut: 'Alt+Q', type: 'shortcut' },
			{ type: 'rebind' },
		])
		for (const type of ['press', 'release', 'abort'])
			child.emit('message', { type })
		expect(got).toEqual(['b:press', 'b:release', 'b:abort'])
	})

	it('a dead child releases the hold and is respawned with state replayed', () => {
		const first = childAt(0)
		first.emit('message', { type: 'press' })
		win.setCaptureMode(true)
		first.emit('exit', 1)
		expect(got).toEqual(['a:press', 'a:release']) // release died with the child
		jest.advanceTimersByTime(1000)
		expect(childAt(1).sent).toEqual([
			{ shortcut: 'Alt+Q', type: 'shortcut' },
			{ enabled: true, type: 'capture' },
		])
	})

	it('eats a combo only while the hook runs and capture is off', () => {
		fake.globalShortcuts.clear()
		const child = childAt(0)
		expect([...fake.globalShortcuts]).toEqual([]) // not before the hook is up
		child.emit('message', { type: 'ready' })
		expect([...fake.globalShortcuts]).toEqual(['Alt+Q'])
		win.setCaptureMode(true)
		expect([...fake.globalShortcuts]).toEqual([])
		win.setCaptureMode(false)
		win.setShortcut('AltRight') // a held modifier is no accelerator
		expect([...fake.globalShortcuts]).toEqual([])
		win.setShortcut('Ctrl+Space')
		expect([...fake.globalShortcuts]).toEqual(['Ctrl+Space'])
		child.emit('exit', 1) // a dead hook must not leave the key dead everywhere
		expect([...fake.globalShortcuts]).toEqual([])
		jest.advanceTimersByTime(1000)
		childAt(1).emit('message', { type: 'ready' })
		expect([...fake.globalShortcuts]).toEqual(['Ctrl+Space'])
		win.unbind()
		expect([...fake.globalShortcuts]).toEqual([])
	})

	it('unbind kills without respawn; a later bind forks a fresh child', () => {
		const child = childAt(0)
		win.unbind()
		expect(child.killed).toBe(true)
		child.emit('exit', 0)
		jest.advanceTimersByTime(1000)
		expect(fake.children).toHaveLength(1)
		expect(got).toEqual([])
		listen('c')
		expect(fake.children).toHaveLength(2)
	})
})
