import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	jest,
} from 'bun:test'
import { clipboard } from 'electron'

// The live clipboard: one item, MIME type → value. Empty = nothing copied.
let board: Record<string, string> = {}
// Linux PRIMARY: the last highlighted text.
let primary = ''
const log: string[] = []
// The window the last press was made in, as the platform module tracks it.
let pressedIn = 'editor'
// false: no paste tool / keystroke API (paste.linux.ts without xdotool).
let canPaste = true
const key = {
	pasteTarget: () => pressedIn,
	simulatePaste: async (target: unknown) => {
		log.push(`paste:${board['text/plain']}`)
		targets.push(target)
		return canPaste
	},
}
const targets: unknown[] = []
// Through require.cache, not mock.module: that one is process-wide and would
// replace the real modules for sibling test files that run later (Linux order).
const platforms = ['./paste.win', './paste.mac', './paste.linux'].map((id) =>
	require.resolve(id),
)
for (const filename of platforms)
	require.cache[filename] = {
		exports: { captureForegroundWindow: () => undefined, ...key },
		filename,
		loaded: true,
	} as NodeModule

Object.assign(clipboard, {
	clear: () => {
		board = {}
	},
	read: async () =>
		Object.keys(board).length
			? [{ getType: async (t: string) => board[t], types: Object.keys(board) }]
			: [],
	readText: async () => board['text/plain'] ?? '',
	selection: {
		clear: async () => {
			primary = ''
		},
		readText: async () => primary,
		writeText: async (text: string) => {
			primary = text
		},
	},
	write: async (items: { entry: Record<string, string> }[]) => {
		board = { ...items[0]?.entry }
	},
	writeText: async (text: string) => {
		board = { 'text/plain': text }
	},
})

const { pasteText, RESTORE_DELAY_MS } = require('./paste')
for (const filename of platforms) delete require.cache[filename]

// Promise chains under fake timers: settle what's queued, move the clock, settle.
const flush = async () => {
	for (let i = 0; i < 50; i++) await Promise.resolve()
}
const advance = async (ms: number) => {
	await flush()
	jest.advanceTimersByTime(ms)
	await flush()
}

describe('pasteText', () => {
	beforeAll(() => jest.useFakeTimers())
	afterAll(() => jest.useRealTimers())
	beforeEach(async () => {
		await advance(10 * RESTORE_DELAY_MS) // drain any earlier queue
		board = { 'text/plain': 'mine' }
		primary = 'highlighted'
		pressedIn = 'editor'
		canPaste = true
		log.length = 0
		targets.length = 0
	})

	it('restores the clipboard only after the target had time to read the paste', async () => {
		expect(await pasteText('dictated', false)).toBe(true)
		expect(log).toEqual(['paste:dictated'])
		await advance(RESTORE_DELAY_MS - 1)
		expect(await clipboard.readText()).toBe('dictated') // a slow tab still reads ours
		await advance(1)
		expect(await clipboard.readText()).toBe('mine')
	})

	it('leaves alone whatever was copied after the paste', async () => {
		await pasteText('dictated', false)
		await clipboard.writeText('copied later')
		await advance(RESTORE_DELAY_MS)
		expect(await clipboard.readText()).toBe('copied later')
	})

	it('back-to-back pastes queue: the user clipboard survives both', async () => {
		const first = pasteText('one', false)
		const second = pasteText('two', false)
		await first
		await flush()
		expect(log).toEqual(['paste:one']) // two waits for one's restore
		await advance(RESTORE_DELAY_MS)
		await second
		expect(log).toEqual(['paste:one', 'paste:two'])
		await advance(RESTORE_DELAY_MS)
		expect(await clipboard.readText()).toBe('mine')
	})

	it('a queued paste keeps the window of its own press', async () => {
		const first = pasteText('one', false)
		const second = pasteText('two', false)
		pressedIn = 'chat' // a new press while "two" waits for the restore of "one"
		await first
		await advance(RESTORE_DELAY_MS)
		await second
		expect(targets).toEqual(['editor', 'editor'])
	})

	it('PRIMARY gets the highlighted text back, unless something else was selected', async () => {
		await pasteText('dictated', false)
		expect(primary).toBe('dictated') // what Shift+Insert pastes in a terminal
		await advance(RESTORE_DELAY_MS)
		expect(primary).toBe('highlighted')
		await pasteText('again', false)
		primary = 'selected later'
		await advance(RESTORE_DELAY_MS)
		expect(primary).toBe('selected later')
	})

	it('an empty clipboard is emptied again; keep leaves the transcript', async () => {
		board = {}
		await pasteText('dictated', false)
		await advance(RESTORE_DELAY_MS)
		expect(board).toEqual({})
		await pasteText('kept', true)
		await advance(RESTORE_DELAY_MS)
		expect(await clipboard.readText()).toBe('kept')
	})

	it('nothing could paste: the transcript stays for a manual paste, the next one still runs', async () => {
		canPaste = false
		expect(await pasteText('dictated', false)).toBe(false)
		await advance(RESTORE_DELAY_MS)
		expect(await clipboard.readText()).toBe('dictated')
		canPaste = true
		await pasteText('next', false)
		expect(log).toEqual(['paste:dictated', 'paste:next'])
	})
})
