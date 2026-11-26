import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { fake } from '../electron.mock'
import { postProcess, transcribe } from '../pipeline/local'
import { loadSettings, type Settings, saveSettings } from '../store/settings'
import * as engines from './engines'
import * as servers from './servers'

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-servers-'))
fake.userData = userData
const LOG = path.join(userData, 'fake.log')
const MODELS = path.join(userData, 'models')
const exes: Record<'whisper' | 'llama', string> = { llama: '', whisper: '' }

const BASE: Partial<Settings> = {
	activeModeId: 'clean',
	backend: 'local',
	computeMode: 'auto',
	language: 'en',
	localIdleMinutes: 0,
	localLlm: { enabled: false, model: 'gemma-4-e2b' },
	localStt: { model: 'base' },
	uiLanguage: 'en',
}
// Saved like the Settings window does: servers read the stored choice.
const apply = (patch: Partial<Settings> = {}): Settings => {
	saveSettings({ ...loadSettings(), ...BASE, ...patch })
	return loadSettings()
}

const FAKE = [
	'FAKE_CRASH',
	'FAKE_EXIT',
	'FAKE_GPU_ONLY',
	'FAKE_INFER_MS',
	'FAKE_LOAD_MS',
	'FAKE_ONLY',
	'FAKE_STDERR',
] as const
const fakeEnv = (vars: Partial<Record<(typeof FAKE)[number], string>>) =>
	Object.assign(process.env, vars)

interface Entry {
	args?: string[]
	at: number
	body?: { max_tokens?: number; chat_template_kwargs?: unknown }
	gpu: boolean
	llama: boolean
	path?: string
	pid: number
	warmUp?: boolean
}
const log = (): Entry[] =>
	fs.existsSync(LOG)
		? fs
				.readFileSync(LOG, 'utf8')
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line))
		: []
const spawns = (llama = false) =>
	log().filter((e) => e.args && e.llama === llama)
const alive = (pid: number) => {
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const wav = servers.silentWav()

beforeAll(async () => {
	// BUN_OPTIONS is split like a shell line: backslashes escape, spaces separate.
	process.env.BUN_OPTIONS = `"${require.resolve('./fakeServer.fixture').replaceAll('\\', '/')}"`
	process.env.FAKE_LOG = LOG
	const ctx = await servers.hostCtx()
	for (const engine of ['whisper', 'llama'] as const) {
		const variant = engines.selectVariant(engine, ctx)
		const exe = variant && engines.serverPath(variant.id)
		if (!exe) throw new Error(`no ${engine} variant for this platform`)
		exes[engine] = exe
		fs.mkdirSync(path.dirname(exe), { recursive: true })
		try {
			fs.linkSync(process.execPath, exe)
		} catch {
			fs.copyFileSync(process.execPath, exe) // other volume: no hard link
		}
	}
	fs.mkdirSync(MODELS, { recursive: true })
	for (const file of [
		'ggml-base.bin',
		'ggml-large-v3-turbo-q5_0.bin',
		'gemma-4-E2B_q4_0-it.gguf',
	])
		fs.writeFileSync(path.join(MODELS, file), 'fake weights')
})

afterEach(async () => {
	await servers.killAll()
	for (const name of FAKE) delete process.env[name]
	servers.retryGpu()
	servers.timing.drainMs = 60_000
	fs.rmSync(LOG, { force: true })
})

afterAll(() => {
	delete process.env.BUN_OPTIONS
	delete process.env.FAKE_LOG
	fs.rmSync(userData, { force: true, recursive: true })
})

describe('reconcile', () => {
	it('claims a server started only once it answers, and only once', async () => {
		expect(await servers.reconcile(apply())).toEqual({
			failed: [],
			started: ['stt'],
			stopped: [],
		})
		expect((await servers.reconcile(apply())).started).toEqual([])
	})

	it('says ahead what it will load or release, nothing when no server changes', async () => {
		expect(await servers.pending(apply())).toEqual({
			load: ['stt'],
			release: [],
		})
		await servers.reconcile(apply())
		// a save that changes no server (idle minutes, a theme): no "Loading…"
		expect(await servers.pending(apply({ localIdleMinutes: 15 }))).toEqual({
			load: [],
			release: [],
		})
		expect(await servers.pending(apply({ backend: 'cloud' }))).toEqual({
			load: [],
			release: ['stt'],
		})
	})

	it('reports a crash at load with its cause, never as started', async () => {
		fakeEnv({
			FAKE_EXIT: '3',
			FAKE_ONLY: 'whisper',
			FAKE_STDERR: 'whisper_model_load: invalid model data (bad magic)\n',
		})
		const r = await servers.reconcile(apply())
		expect(r.started).toEqual([])
		expect(r.failed[0]?.error).toStartWith('corrupt:')
		expect(spawns()).toHaveLength(1) // a corrupt file is not retried on CPU
	})

	it('warms the server up before calling it loaded', async () => {
		await servers.reconcile(apply())
		expect(log().filter((e) => e.path === '/inference')).toMatchObject([
			{ warmUp: true },
		])
	})

	it('takes a port from the OS: another process on a common port is harmless', async () => {
		const squatter = net.createServer().listen(8178, '127.0.0.1')
		try {
			await servers.reconcile(apply())
			expect(await transcribe(wav)).toBe('SPOKEN')
			const port = spawns()[0]?.args?.at(-1)
			expect(port).not.toBe('8178')
			expect(port).not.toBe('8177')
		} finally {
			squatter.close()
		}
	})

	it('reuses a server whose arguments did not change (auto ↔ gpu)', async () => {
		await servers.reconcile(apply({ computeMode: 'auto' }))
		expect(
			(await servers.reconcile(apply({ computeMode: 'gpu' }))).started,
		).toEqual([])
		expect(spawns()).toHaveLength(1)
	})

	it('restarts on CPU with every GPU device off', async () => {
		const llm = { localLlm: { enabled: true, model: 'gemma-4-e2b' } }
		await servers.reconcile(apply(llm))
		const r = await servers.reconcile(apply({ ...llm, computeMode: 'cpu' }))
		expect(r.started.sort()).toEqual(['llm', 'stt'])
		expect(spawns().at(-1)?.args).toContain('--no-gpu')
		expect(spawns(true).at(-1)?.args?.join(' ')).toContain('-ngl 0 -dev none')
	})

	it('drops a load that a newer choice made useless', async () => {
		fakeEnv({ FAKE_LOAD_MS: '5000' })
		const first = servers.reconcile(apply())
		await sleep(400)
		fakeEnv({ FAKE_LOAD_MS: '0' })
		const t = Date.now()
		const second = await servers.reconcile(
			apply({ localStt: { model: 'large-v3-turbo-q5_0' } }),
		)
		expect(Date.now() - t).toBeLessThan(3000)
		expect(second.started).toEqual(['stt'])
		expect((await first).failed).toEqual([]) // superseded, not failed
	})
})

describe('a dictation in flight', () => {
	it('finishes before its server is switched', async () => {
		fakeEnv({ FAKE_INFER_MS: '1500' })
		await servers.reconcile(apply())
		const dictation = transcribe(wav)
		await sleep(300)
		const swap = servers.reconcile(
			apply({ localStt: { model: 'large-v3-turbo-q5_0' } }),
		)
		expect(await dictation).toBe('SPOKEN')
		expect((await swap).started).toEqual(['stt'])
	})

	it('is cut off only after the drain limit', async () => {
		servers.timing.drainMs = 300
		fakeEnv({ FAKE_INFER_MS: '5000' })
		await servers.reconcile(apply({ computeMode: 'cpu' }))
		const dictation = transcribe(wav).catch((e: Error) => e)
		await sleep(300)
		const t = Date.now()
		await servers.reconcile(
			apply({ computeMode: 'cpu', localStt: { model: 'large-v3-turbo-q5_0' } }),
		)
		expect(Date.now() - t).toBeLessThan(2500)
		expect(await dictation).toBeInstanceOf(Error)
	})
})

describe('GPU failures', () => {
	it('loads on CPU when the GPU load runs out of memory', async () => {
		fakeEnv({
			FAKE_EXIT: '1',
			FAKE_GPU_ONLY: '1',
			FAKE_ONLY: 'llama',
			FAKE_STDERR:
				'ggml_vulkan: vk::Device::allocateMemory: ErrorOutOfDeviceMemory\n',
		})
		const r = await servers.reconcile(
			apply({ localLlm: { enabled: true, model: 'gemma-4-e2b' } }),
		)
		expect(r.failed).toEqual([])
		expect(r.started).toContain('llm')
		expect(servers.cpuFallback().llm).toStartWith('memory:')
		expect(spawns(true).map((e) => e.gpu)).toEqual([true, false])
		servers.retryGpu()
		expect(servers.cpuFallback().llm).toBeUndefined()
	})

	it('runs the dictation again on CPU when the GPU server dies under it', async () => {
		fakeEnv({ FAKE_CRASH: '1', FAKE_GPU_ONLY: '1', FAKE_ONLY: 'whisper' })
		await servers.reconcile(apply())
		expect(await transcribe(wav)).toBe('SPOKEN')
		expect(servers.cpuFallback().stt).toBeDefined()
		expect(spawns().map((e) => e.gpu)).toEqual([true, false])
	})
})

describe('idle release', () => {
	it('stops an idle server, never one with a dictation in flight', async () => {
		fakeEnv({ FAKE_INFER_MS: '900' })
		await servers.reconcile(apply({ localIdleMinutes: 0.005 })) // 300 ms
		expect(await transcribe(wav)).toBe('SPOKEN') // outlives the idle time
		const pid = spawns()[0]?.pid as number
		expect(alive(pid)).toBe(true)
		await sleep(1200)
		expect(alive(pid)).toBe(false)
		expect(await transcribe(wav)).toBe('SPOKEN') // loads again on demand
	})
})

describe('local post-processing', () => {
	it('asks with thinking off and a token cap', async () => {
		const settings = apply({
			localLlm: { enabled: true, model: 'gemma-4-e2b' },
		})
		expect(await postProcess('hello there', settings)).toBe('CLEAN')
		const asked = log().filter((e) => e.body && e.body.max_tokens !== 1) // not the warm-up
		expect(asked).toHaveLength(1)
		expect(asked[0]?.body?.chat_template_kwargs).toEqual({
			enable_thinking: false,
		})
		expect(asked[0]?.body?.max_tokens).toBe(512)
	})
})

describe('crash leftovers', () => {
	const pidFile = path.join(userData, 'servers.json')

	it('stops a leftover server, never a foreign process that took its PID', async () => {
		// Plain bun, not the fake server: BUN_OPTIONS would turn it into one.
		const foreign = spawn(
			process.execPath,
			['-e', 'setInterval(() => {}, 1000)'],
			{ env: { ...process.env, BUN_OPTIONS: '' } },
		)
		await servers.reconcile(apply())
		const ours = spawns()[0]?.pid as number
		fs.writeFileSync(
			pidFile,
			JSON.stringify([
				{ name: path.basename(exes.whisper), pid: ours },
				{ name: path.basename(exes.whisper), pid: foreign.pid },
				foreign.pid, // malformed: no name
			]),
		)
		await servers.killStale()
		await sleep(300)
		expect(alive(ours)).toBe(false)
		expect(alive(foreign.pid as number)).toBe(true)
		foreign.kill()
	})
})

describe('deleting an engine', () => {
	it('stops the server running from it first', async () => {
		await servers.reconcile(apply())
		const pid = spawns()[0]?.pid as number
		await servers.releaseEngine(path.dirname(exes.whisper))
		expect(alive(pid)).toBe(false)
		await servers.releaseEngine(path.dirname(exes.llama)) // other engine: no-op
	})
})
