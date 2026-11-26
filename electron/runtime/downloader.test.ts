import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { session } from 'electron'
import { fake } from '../electron.mock'
import { downloadFile, downloadTiming, ensureSpace } from './downloader'
import * as engines from './engines'
import * as models from './models'

// Chromium's side of a download, played by the test: every downloadURL() makes a
// FakeItem that `script` drives (progress, interruption, completion).
class FakeItem extends EventEmitter {
	savePath = ''
	received = 0
	resumable = false
	cancelled = false
	readonly url: string
	constructor(url: string) {
		super()
		this.url = url
	}
	getURLChain = () => [this.url]
	getURL = () => this.url
	setSavePath = (p: string) => {
		this.savePath = p
	}
	getReceivedBytes = () => this.received
	getTotalBytes = () => 1000
	canResume = () => this.resumable
	resume = () => undefined
	cancel = () => {
		this.cancelled = true
		this.emit('done', {}, 'cancelled')
	}
	progress(bytes: number) {
		this.received = bytes
		this.emit('updated', {}, 'progressing')
	}
	complete() {
		fs.writeFileSync(this.savePath, '')
		fs.truncateSync(this.savePath, this.received) // zero-filled, no big buffer
		this.emit('done', {}, 'completed')
	}
}

let items: FakeItem[] = []
let script: (item: FakeItem, attempt: number) => void = () => undefined
const fakeSession = Object.assign(new EventEmitter(), {
	downloadURL: (url: string) => {
		const item = new FakeItem(url)
		items.push(item)
		const n = items.length
		setTimeout(() => {
			fakeSession.emit('will-download', {}, item)
			script(item, n)
		}, 5)
	},
})

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-dl-'))
const target = path.join(dir, 'model.part')
const URL = 'https://example.test/model.bin'

beforeAll(() => {
	;(session as unknown as { defaultSession: unknown }).defaultSession =
		fakeSession
})
afterAll(() => fs.rmSync(dir, { force: true, recursive: true }))
afterEach(() => {
	items = []
	downloadTiming.retryMs = [2000, 10_000]
	downloadTiming.stallMs = 60_000
})

// A download that never settles must fail the test, not hang the whole run.
const settled = <T>(promise: Promise<T>, ms = 3000) =>
	Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error('hung: never settled')), ms),
		),
	])

const interrupt = (item: FakeItem) => {
	item.progress(400)
	item.emit('updated', {}, 'interrupted')
}

describe('downloadFile', () => {
	it('resolves once Chromium completes the file', async () => {
		script = (item) => {
			item.progress(1000)
			item.complete()
		}
		await downloadFile(URL, target, 1000).promise
		expect(fs.statSync(target).size).toBe(1000)
	})

	it('retries a network failure from zero and succeeds', async () => {
		downloadTiming.retryMs = [10, 10]
		script = (item, attempt) => {
			if (attempt === 1) interrupt(item)
			else {
				item.progress(1000)
				item.complete()
			}
		}
		await downloadFile(URL, target, 1000).promise
		expect(items).toHaveLength(2)
	})

	it('gives up after the retries with a network error, never hangs', async () => {
		downloadTiming.retryMs = [10, 10]
		script = interrupt
		await expect(
			settled(downloadFile(URL, target, 1000).promise),
		).rejects.toThrow(/^network:/u)
		expect(items).toHaveLength(3)
	})

	it('ends a stalled download (no new byte) as a network failure', async () => {
		downloadTiming.retryMs = []
		downloadTiming.stallMs = 150
		script = (item) => item.progress(100) // then silence
		await expect(
			settled(downloadFile(URL, target, 1000).promise),
		).rejects.toThrow(/^network:/u)
		expect(items[0]?.cancelled).toBe(true)
	})

	it('a cancel during the retry wait ends it at once', async () => {
		downloadTiming.retryMs = [60_000]
		script = interrupt
		const dl = downloadFile(URL, target, 1000)
		await new Promise((r) => setTimeout(r, 100))
		const t = Date.now()
		dl.cancel()
		await expect(settled(dl.promise, 1000)).rejects.toMatchObject({
			name: 'AbortError',
		})
		expect(Date.now() - t).toBeLessThan(1000)
		expect(items).toHaveLength(1)
	})
})

describe('ensureSpace', () => {
	it('passes when the disk has room and names the gap when not', () => {
		expect(() => ensureSpace(dir, 1)).not.toThrow()
		expect(() => ensureSpace(dir, 1e18)).toThrow(/^disk: /u)
	})
})

describe('models.download', () => {
	it('a cancel while the file is being verified installs nothing', async () => {
		fake.userData = dir
		const base = models.status().stt.find((m) => m.id === 'base')
		script = (item) => {
			item.progress(base?.bytes ?? 0)
			item.complete()
		}
		const phases: string[] = []
		const run = models.download('stt', 'base', (_r, _t, phase) => {
			if (!phase) return
			phases.push(phase)
			models.cancel('stt', 'base') // mid-hash
		})
		await expect(run).rejects.toMatchObject({ name: 'AbortError' })
		expect(phases).toEqual(['verifying'])
		const file = path.join(dir, 'models', 'ggml-base.bin')
		expect(fs.existsSync(file)).toBe(false)
		expect(fs.existsSync(`${file}.part`)).toBe(false)
	})

	it('downloads over a wrong-sized file instead of calling it done', async () => {
		fake.userData = dir
		const file = path.join(dir, 'models', 'ggml-base.bin')
		fs.mkdirSync(path.dirname(file), { recursive: true })
		fs.writeFileSync(file, 'not a model')
		let started = false
		script = () => {
			started = true
			models.cancel('stt', 'base')
		}
		await expect(models.download('stt', 'base')).rejects.toMatchObject({
			name: 'AbortError',
		})
		expect(started).toBe(true)
		fs.rmSync(file)
	})

	it('counts a model installed only at its exact size', () => {
		fake.userData = dir
		const file = path.join(dir, 'models', 'ggml-base.bin')
		const installed = () =>
			models.status().stt.find((m) => m.id === 'base')?.installed
		fs.mkdirSync(path.dirname(file), { recursive: true })
		fs.writeFileSync(file, 'not a model')
		expect(installed()).toBe(false)
		fs.truncateSync(file, 147_951_465)
		expect(installed()).toBe(true)
		fs.rmSync(file)
	})
})

describe('engines.download', () => {
	it('a second call for the same engine waits for the running download', async () => {
		fake.userData = dir
		script = (item) => item.progress(10) // keeps going until cancelled
		const id = engines.CATALOG[0]?.id as string
		const first = engines.download(id)
		const second = engines.download(id)
		expect(second).toBe(first)
		await new Promise((r) => setTimeout(r, 20))
		expect(items).toHaveLength(1) // one download, not two into one archive
		engines.cancel(id)
		await expect(settled(second)).rejects.toMatchObject({ name: 'AbortError' })
	})
})
