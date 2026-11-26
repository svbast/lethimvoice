// Chromium writes the file, not a Node stream: fetch piped into a WriteStream in the
// Electron main process can write large files with bytes wrong at random offsets
// (in-memory hash right, disk wrong). Callers hash it FROM DISK afterwards, which
// catches any write-path fault.

import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { type DownloadItem, session } from 'electron'

/** `phase: 'verifying'` once the bytes are in and the file is being checked. */
export type ProgressFn = (
	received: number,
	total: number,
	phase?: 'verifying',
) => void

// Bounds a test can shorten; the defaults are what users get.
export const downloadTiming = {
	/** Waits before each retry of a download that failed on the network. */
	retryMs: [2000, 10_000],
	/** No new byte for this long = stalled: give up the attempt (Handy uses 60 s). */
	stallMs: 60_000,
}

/** What a cancelled download rejects with; ipc/local.ts reports it as 'cancelled'. */
const abortError = () => {
	const e = new Error('cancelled')
	e.name = 'AbortError'
	return e
}

// One download per key: a second caller (two tiles needing the same file) waits for
// the one running instead of starting another into the same .part; cancel() aborts it.
export const downloadJobs = () => {
	const active = new Map<
		string,
		{ stop: AbortController; promise: Promise<void> }
	>()
	return {
		cancel: (key: string) => active.get(key)?.stop.abort(abortError()),
		running: (key: string) => active.get(key)?.promise,
		start: (key: string, work: (signal: AbortSignal) => Promise<void>) => {
			const stop = new AbortController()
			const promise = work(stop.signal).finally(() => active.delete(key))
			active.set(key, { promise, stop })
			return promise
		},
	}
}

interface Pending {
	savePath: string
	bytes: number
	onProgress?: ProgressFn
	resolve: () => void
	reject: (err: Error) => void
	item: DownloadItem | null
	resumes: number
	lastBytes: number
	lastProgressAt: number
	/** Gave up on an interruption or a stall: the cancel that follows is a network failure. */
	interrupted?: boolean
}

// Downloads awaiting their 'will-download' DownloadItem, keyed by exact URL passed to
// downloadURL() (getURLChain()[0] returns it even after redirects).
const pendingByUrl = new Map<string, Pending>()
let hooked = false

const hookSession = (): void => {
	if (hooked) return
	hooked = true
	session.defaultSession.on('will-download', (_e, item) => {
		const originalUrl = item.getURLChain()[0] ?? item.getURL()
		const p = pendingByUrl.get(originalUrl)
		if (!p) {
			item.cancel()
			return
		} // not ours — never show a save dialog
		pendingByUrl.delete(originalUrl)
		p.item = item
		item.setSavePath(p.savePath)
		item.on('updated', (_ev, state) => {
			// Chromium resumes transient network interruptions in place. Past that the
			// item sits 'interrupted' for good and 'done' never fires: end it, and
			// report the network rather than a user cancel.
			if (state === 'interrupted') {
				if (item.canResume() && p.resumes < 5) {
					p.resumes += 1
					item.resume()
				} else {
					p.interrupted = true
					item.cancel()
				}
				return
			}
			const received = item.getReceivedBytes()
			if (received !== p.lastBytes) {
				p.lastBytes = received
				p.lastProgressAt = Date.now()
			}
			p.onProgress?.(received, item.getTotalBytes() || p.bytes || 0)
		})
		item.once('done', (_ev, state) => {
			if (state === 'completed') {
				p.resolve()
				return
			}
			if (p.interrupted || state === 'interrupted') {
				p.reject(new Error('network: download interrupted'))
				return
			}
			p.reject(state === 'cancelled' ? abortError() : new Error(state))
		})
	})
}

// One attempt. A watchdog ends it when no byte arrived for downloadTiming.stallMs,
// including a download Chromium never started.
const attempt = (
	url: string,
	savePath: string,
	bytes: number,
	onProgress?: ProgressFn,
): { promise: Promise<void>; cancel: () => void } => {
	hookSession()
	fs.rmSync(savePath, { force: true }) // a retry starts from zero
	let p: Pending | null = null
	const promise = new Promise<void>((resolve, reject) => {
		p = {
			bytes,
			item: null,
			lastBytes: 0,
			lastProgressAt: Date.now(),
			onProgress,
			reject,
			resolve,
			resumes: 0,
			savePath,
		}
		pendingByUrl.set(url, p)
		session.defaultSession.downloadURL(url)
	})
	const watchdog = setInterval(
		() => {
			if (!p || Date.now() - p.lastProgressAt < downloadTiming.stallMs) return
			p.interrupted = true
			if (p.item) p.item.cancel()
			else if (pendingByUrl.delete(url))
				p.reject(new Error('network: download never started'))
		},
		Math.min(5000, downloadTiming.stallMs / 2),
	)
	promise.then(
		() => clearInterval(watchdog),
		() => clearInterval(watchdog),
	)
	const cancel = () => {
		if (!p) return
		if (p.item) p.item.cancel()
		else if (pendingByUrl.delete(url)) p.reject(abortError())
	}
	return { cancel, promise }
}

// A network failure (interruption, stall) is retried from zero, twice; anything else
// (cancel, HTTP error) ends the download at once. Resuming a partial file across
// attempts is not done.
// Known limit: each retry re-downloads from byte 0; Range resume through
// session.createInterruptedDownload if users on flaky links redownload 3 GB.
export const downloadFile = (
	url: string,
	savePath: string,
	bytes: number,
	onProgress?: ProgressFn,
): { promise: Promise<void>; cancel: () => void } => {
	const stop = new AbortController()
	let current: ReturnType<typeof attempt> | null = null
	const promise = (async () => {
		for (let n = 0; ; n++) {
			current = attempt(url, savePath, bytes, onProgress)
			try {
				return await current.promise
			} catch (e) {
				const network = (e as Error).message.startsWith('network:')
				if (
					stop.signal.aborted ||
					!network ||
					n >= downloadTiming.retryMs.length
				)
					throw e
			}
			// A cancel ends the wait at once.
			await sleep(downloadTiming.retryMs[n], undefined, {
				signal: stop.signal,
			}).catch(() => undefined)
			stop.signal.throwIfAborted()
		}
	})()
	const cancel = () => {
		stop.abort(abortError())
		current?.cancel()
	}
	return { cancel, promise }
}

// One verified download into `part`, from byte 0: exact size and SHA256 are checked
// FROM DISK. A cancel (`signal`) made while hashing, which takes seconds for 3 GB,
// still ends it before the caller installs anything.
export const downloadVerified = async (
	url: string,
	part: string,
	{ bytes, sha256 }: { bytes: number; sha256: string },
	{ onProgress, signal }: { onProgress?: ProgressFn; signal: AbortSignal },
): Promise<void> => {
	const dl = downloadFile(url, part, bytes, onProgress)
	signal.addEventListener('abort', dl.cancel)
	await dl.promise

	const size = fs.statSync(part).size
	if (size !== bytes)
		throw new Error(`incomplete: got ${size} of ${bytes} bytes`)
	onProgress?.(bytes, bytes, 'verifying')
	const digest = await sha256File(part)
	signal.throwIfAborted()
	if (digest !== sha256)
		throw new Error('corrupt: checksum mismatch — download again')
}

// Free space check before a download: a multi-GB file that cannot fit fails with a
// clear reason instead of a broken write at 90 %.
export const ensureSpace = (dir: string, needed: number): void => {
	const { bavail, bsize } = fs.statfsSync(dir)
	const free = bavail * bsize
	if (free < needed)
		throw new Error(
			`disk: ${(needed / 1e9).toFixed(1)} GB needed, ${(free / 1e9).toFixed(1)} GB free`,
		)
}

// SHA256 read back FROM DISK — verifies what will actually be loaded, not what
// passed through memory.
const sha256File = async (filePath: string): Promise<string> => {
	const hash = crypto.createHash('sha256')
	for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk)
	return hash.digest('hex')
}
