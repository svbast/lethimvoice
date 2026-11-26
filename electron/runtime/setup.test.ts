import { describe, expect, it } from 'bun:test'
import type { ProgressFn } from './downloader'
import { createSetup, type SetupAsset, type SetupState } from './setup'

const ENGINE: SetupAsset = { bytes: 100, id: 'whisper-cuda', kind: 'engine' }
const STT: SetupAsset = { bytes: 600, id: 'turbo', kind: 'stt' }
const LLM: SetupAsset = { bytes: 300, id: 'gemma', kind: 'llm' }

// Downloads the test finishes by hand: each asset reports half, then waits.
const harness = () => {
	const states: SetupState[] = []
	const applied: string[] = []
	const cancelled: string[] = []
	const downloads: string[] = []
	const pending = new Map<
		string,
		(r: { ok: boolean; error?: string }) => void
	>()
	const setup = createSetup({
		cancel: (a) => {
			cancelled.push(a.id)
			pending.get(a.id)?.({ error: 'cancelled', ok: false })
		},
		download: (a, onProgress: ProgressFn) =>
			new Promise((resolve) => {
				downloads.push(a.id)
				onProgress(a.bytes / 2, a.bytes)
				pending.set(a.id, resolve)
			}),
		publish: (s) => states.push(s),
	})
	const parts = () => [
		{
			apply: () => applied.push('stt'),
			assets: [ENGINE, STT],
			step: 'stt' as const,
		},
		{ apply: () => applied.push('llm'), assets: [LLM], step: 'llm' as const },
	]
	// Lets the setup reach its next download (one await per asset).
	const until = async (id: string) => {
		for (let i = 0; i < 50 && !pending.has(id); i++) await Promise.resolve()
		if (!pending.has(id)) throw new Error(`no download of ${id}`)
	}
	const finish = (
		id: string,
		result: { ok: boolean; error?: string } = { ok: true },
	) => {
		const resolve = pending.get(id)
		pending.delete(id)
		resolve?.(result)
	}
	return { applied, cancelled, downloads, finish, parts, setup, states, until }
}

describe('local setup', () => {
	it('one bar for every file, each part switched on when its files are in', async () => {
		const h = harness()
		const run = h.setup.start(h.parts())
		await h.until('whisper-cuda')
		expect(h.setup.state()).toMatchObject({
			phase: 'running',
			received: 50,
			step: 'stt',
			total: 1000,
		})
		h.finish('whisper-cuda')
		await h.until('turbo')
		expect(h.setup.state().received).toBe(100 + 300)
		expect(h.applied).toEqual([])
		h.finish('turbo')
		await h.until('gemma')
		// speech works before the cleanup model is in
		expect(h.applied).toEqual(['stt'])
		expect(h.setup.state()).toMatchObject({ received: 700 + 150, step: 'llm' })
		h.finish('gemma')
		await run
		expect(h.applied).toEqual(['stt', 'llm'])
		expect(h.setup.state()).toMatchObject({ phase: 'done', received: 1000 })
	})

	it('a failure says which part and why; speech stays on when cleanup failed', async () => {
		const h = harness()
		const run = h.setup.start(h.parts())
		await h.until('whisper-cuda')
		h.finish('whisper-cuda')
		await h.until('turbo')
		h.finish('turbo')
		await h.until('gemma')
		h.finish('gemma', { error: 'disk: 1 GB free', ok: false })
		await run
		expect(h.applied).toEqual(['stt'])
		expect(h.setup.state()).toMatchObject({
			error: 'disk: 1 GB free',
			phase: 'failed',
			step: 'llm',
		})
	})

	it('a retry starts clean and downloads only what it is given', async () => {
		const h = harness()
		const first = h.setup.start(h.parts())
		await h.until('whisper-cuda')
		h.finish('whisper-cuda', { error: 'network', ok: false })
		await first
		expect(h.setup.state().phase).toBe('failed')
		const retry = h.setup.start([
			{ apply: () => h.applied.push('stt'), assets: [], step: 'stt' },
		])
		await retry
		expect(h.setup.state()).toMatchObject({
			error: undefined,
			phase: 'done',
			total: 0,
		})
		expect(h.applied).toEqual(['stt'])
	})

	it('a part that cannot be switched on ends the setup as failed, not running', async () => {
		const h = harness()
		await h.setup.start([
			{
				apply: () => {
					throw new Error('EPERM: settings.json')
				},
				assets: [],
				step: 'stt',
			},
		])
		expect(h.setup.state()).toMatchObject({
			error: 'EPERM: settings.json',
			phase: 'failed',
		})
	})

	it('cancel stops the running download and switches nothing on', async () => {
		const h = harness()
		const run = h.setup.start(h.parts())
		await h.until('whisper-cuda')
		h.setup.cancel()
		await run
		expect(h.cancelled).toEqual(['whisper-cuda'])
		expect(h.applied).toEqual([])
		expect(h.setup.state()).toMatchObject({ error: undefined, phase: 'idle' })
	})

	it("a cancel from the asset's own row is a cancel, not a failure", async () => {
		const h = harness()
		const run = h.setup.start(h.parts())
		await h.until('whisper-cuda')
		h.finish('whisper-cuda', { error: 'cancelled', ok: false })
		await run
		expect(h.setup.state().phase).toBe('idle')
	})

	it('a second start while running is ignored', async () => {
		const h = harness()
		const run = h.setup.start(h.parts())
		await h.until('whisper-cuda')
		await h.setup.start(h.parts()) // returns at once
		expect(h.downloads).toEqual(['whisper-cuda'])
		h.setup.cancel()
		await run
	})

	it('dismiss closes "done" and "failed", never a running setup', async () => {
		const h = harness()
		const run = h.setup.start(h.parts())
		await h.until('whisper-cuda')
		h.setup.dismiss()
		expect(h.setup.state().phase).toBe('running')
		h.finish('whisper-cuda', { error: 'network', ok: false })
		await run
		h.setup.dismiss()
		expect(h.setup.state()).toMatchObject({ error: undefined, phase: 'idle' })
	})
})
