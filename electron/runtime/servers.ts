import { type ChildProcess, execFile, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { app } from 'electron'
import { broadcast } from '../ipc/broadcast'
import { loadSettings, type Settings } from '../store/settings'
import { config } from '../utils/config'
import * as engines from './engines'
import { DEFAULT_MODEL, type Kind, pathFor } from './models'
import { classify, missingVcRuntime } from './serverError'

interface Spec {
	binary: string | null
	model: string
	/** Everything but --host/--port: same args = same server, reused as is. */
	args: string[]
	gpu: boolean
	readyPath: string
	readyOk: (code?: number) => boolean
	/** First inference, run before the server counts as loaded. */
	warm: (baseUrl: string) => Promise<unknown>
}

interface RunningServer {
	child: ChildProcess
	binary: string
	key: string
	model: string
	port: number
	gpu: boolean
	ready: Promise<void>
	/** Answered and warmed: only now may a newer request stop it without waiting. */
	loaded: boolean
	killed: boolean
	exitCode?: number | null
	exited: Promise<void>
	stderr: string
	/** Requests in flight (use()); the server is not stopped while this is > 0. */
	busy: number
	drained: Array<() => void>
	idleTimer?: NodeJS.Timeout
}

const HOST = '127.0.0.1'

// Bounds a test can shorten; the defaults are what users get.
export const timing = {
	/** A dictation still running when its server has to go: finish it, up to this long. */
	drainMs: 60_000,
	/** large-v3 / Gemma load + weights mmap, slow when cold. */
	readyMs: 90_000,
}

const noop = () => undefined

const dirHas = (dir: string, pred: (name: string) => boolean): boolean => {
	try {
		return fs.readdirSync(dir).some(pred)
	} catch {
		return false
	}
}

// Microsoft Basic Render Driver: the software adapter every Windows lists.
const MICROSOFT_VENDOR = 0x14_14

const detect = async (): Promise<string[]> => {
	try {
		const platform = engines.osKey()
		if (platform === 'win') {
			// Chromium has enumerated the adapters for its GPU process already: ~30 ms,
			// off the main thread. Asking PowerShell instead would block the whole app for
			// up to 8 s.
			const info = (await app.getGPUInfo('basic')) as {
				gpuDevice?: Array<{ deviceString?: string; vendorId?: number }>
			}
			return (info.gpuDevice ?? []).flatMap((d) =>
				d.deviceString && d.vendorId !== MICROSOFT_VENDOR
					? [d.deviceString]
					: [],
			)
		}
		if (platform === 'linux') {
			const icdDirs = [
				'/usr/share/vulkan/icd.d',
				'/etc/vulkan/icd.d',
				path.join(config.xdg.dataHome, 'vulkan', 'icd.d'),
			]
			const icds = (pred: (name: string) => boolean) =>
				icdDirs.some((dir) => dirHas(dir, pred))
			const hasVulkan =
				icds((name) => name.startsWith('nvidia')) ||
				(icds(
					(name) => name.endsWith('.json') && !/^(?:lvp|dzn)_/u.test(name),
				) &&
					dirHas('/dev/dri', (name) => name.startsWith('renderD')))
			return hasVulkan ? ['Vulkan'] : []
		}
		return [] // macOS: Metal always; no vendor branch.
	} catch {
		return []
	}
}

let gpus: Promise<string[]> | null = null
export const detectGpus = (): Promise<string[]> => {
	gpus ??= detect()
	return gpus
}

let host: engines.HostCtx | null = null
export const hostCtx = async (): Promise<engines.HostCtx> => {
	const list = await detectGpus()
	host = {
		// Only Linux catalog entries consult accel; harmless elsewhere.
		accel: list.includes('Vulkan') ? 'vulkan' : 'cpu',
		hasNvidia: list.some((name) => /nvidia/iu.test(name)),
	}
	return host
}

const variantFor = (kind: Kind, ctx: engines.HostCtx) =>
	engines.selectVariant(kind === 'llm' ? 'llama' : 'whisper', ctx)
const modelIdFor = (kind: Kind, settings: Settings): string =>
	kind === 'llm'
		? settings.localLlm?.model || DEFAULT_MODEL.llm
		: settings.localStt?.model || DEFAULT_MODEL.stt
const modelPathFor = (kind: Kind, settings: Settings): string =>
	pathFor(kind, modelIdFor(kind, settings))

// Why a server runs on CPU against the user's GPU choice: a load that failed on the
// GPU (out of VRAM, driver crash) or a GPU server that died mid-request. Sticky until
// restart, a compute-mode change or "Retry GPU" (Handy, OpenWhispr).
const gpuFallback: Partial<Record<Kind, string>> = {}
export const cpuFallback = () => ({ ...gpuFallback })
export const retryGpu = () => {
	gpuFallback.llm = undefined
	gpuFallback.stt = undefined
}

// 1 s of 16 kHz mono silence as a WAV buffer — smallest valid STT input.
export const silentWav = () => {
	const rate = 16_000
	const samples = rate // 1 s
	const buf = Buffer.alloc(44 + samples * 2)
	buf.write('RIFF', 0)
	buf.writeUInt32LE(36 + samples * 2, 4)
	buf.write('WAVE', 8)
	buf.write('fmt ', 12)
	buf.writeUInt32LE(16, 16)
	buf.writeUInt16LE(1, 20)
	buf.writeUInt16LE(1, 22)
	buf.writeUInt32LE(rate, 24)
	buf.writeUInt32LE(rate * 2, 28)
	buf.writeUInt16LE(2, 32)
	buf.writeUInt16LE(16, 34)
	buf.write('data', 36)
	buf.writeUInt32LE(samples * 2, 40)
	return buf
}

const warmSignal = () => AbortSignal.timeout(timing.readyMs)

const specFor = (
	kind: Kind,
	settings: Settings,
	ctx: engines.HostCtx,
): Spec => {
	const variant = variantFor(kind, ctx)
	const binary = variant && engines.serverPath(variant.id)
	const model = modelPathFor(kind, settings)
	const gpu = settings.computeMode !== 'cpu' && !gpuFallback[kind]

	if (kind === 'llm') {
		return {
			// -ngl 99 offloads every layer the device takes. CPU needs -dev none too:
			// -ngl 0 alone still opens the Vulkan device and holds ~100 MB of VRAM.
			args: [
				'-m',
				model,
				'-c',
				'4096',
				'--no-webui',
				...(gpu ? ['-ngl', '99'] : ['-ngl', '0', '-dev', 'none']),
			],
			binary,
			gpu,
			model,
			readyOk: (code) => code === 200, // llama-server 503 while loading
			readyPath: '/health',
			warm: (baseUrl) =>
				fetch(`${baseUrl}/v1/chat/completions`, {
					body: JSON.stringify({
						chat_template_kwargs: { enable_thinking: false },
						max_tokens: 1,
						messages: [{ content: 'Hi', role: 'user' }],
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST',
					signal: warmSignal(),
				}),
		}
	}
	return {
		// whisper-server runs 4 threads by default; 10 transcribe twice as fast on a
		// 12-core CPU. One per physical core, 4–10.
		args: [
			'-m',
			model,
			'-t',
			String(
				Math.min(10, Math.max(4, Math.floor(os.availableParallelism() / 2))),
			),
			...(gpu ? [] : ['--no-gpu']),
		],
		binary,
		gpu,
		model,
		readyOk: (code) => (code ?? 0) > 0,
		// whisper-server binds port only after model load: any HTTP response on '/'
		// = ready.
		readyPath: '/',
		warm: (baseUrl) => {
			const form = new FormData()
			form.append(
				'file',
				new Blob([silentWav() as Uint8Array<ArrayBuffer>], {
					type: 'audio/wav',
				}),
				'warm.wav',
			)
			return fetch(`${baseUrl}/inference`, {
				body: form,
				method: 'POST',
				signal: warmSignal(),
			})
		},
	}
}
const keyOf = (spec: Spec) => [spec.binary, ...spec.args].join('\0')

const servers: Record<Kind, RunningServer | null> = { llm: null, stt: null }

const isAvailable = (kind: Kind, settings: Settings, ctx: engines.HostCtx) => {
	try {
		const variant = variantFor(kind, ctx)
		return (
			variant !== null &&
			engines.isInstalled(variant.id) &&
			fs.existsSync(modelPathFor(kind, settings))
		)
	} catch {
		return false
	}
}

// A port nobody listens on right now, from the OS. Never a fixed one: Windows lets a
// second server bind a port that is already taken, and then either process may answer.
const freePort = (): Promise<number> =>
	new Promise((resolve, reject) => {
		const probe = net.createServer()
		probe.on('error', reject)
		probe.listen(0, HOST, () => {
			const { port } = probe.address() as net.AddressInfo
			probe.close(() => resolve(port))
		})
	})

// The status decides, the body is never read. No answer within 2 s = not ready.
const probe = async (port: number, spec: Spec): Promise<boolean> => {
	try {
		const res = await fetch(`http://${HOST}:${port}${spec.readyPath}`, {
			signal: AbortSignal.timeout(2000),
		})
		await res.body?.cancel()
		return spec.readyOk(res.status)
	} catch {
		return false
	}
}

// A newer request replaced this server while it loaded: not a failure, nothing to show.
const SUPERSEDED = 'local: superseded during startup'

// Poll until server answers. `state` bails immediately when this server was
// killed/replaced mid-load ('gone' — model/backend switch), throws when process
// crashed itself (corrupt model, OOM, …); no polling dead port for full 90 s.
const waitUntilReady = async (
	port: number,
	spec: Spec,
	deadline: number,
	state: () => 'ok' | 'gone',
): Promise<void> => {
	while (true) {
		const s = state()
		if (s === 'gone') throw new Error(SUPERSEDED)
		if (await probe(port, spec)) return
		if (Date.now() > deadline)
			throw new Error('timeout: local engine not ready in time')
		await sleep(500)
	}
}

// Stop server for `kind` now, resolve on real process exit (frees its VRAM before
// the next load). 3 s fallback if 'exit' never fires.
const kill = (kind: Kind): Promise<void> => {
	const s = servers[kind]
	servers[kind] = null
	if (!s) return Promise.resolve()
	s.killed = true
	clearTimeout(s.idleTimer)
	try {
		s.child.kill()
	} catch {
		return Promise.resolve()
	}
	return Promise.race([s.exited, sleep(3000)])
}

// Stop server for `kind` once its requests are done: a model switch, a stop or a
// delete never cuts a dictation off, and never waits on one for more than
// timing.drainMs (OpenWhispr waits on /slots the same way).
const retire = async (kind: Kind): Promise<void> => {
	const s = servers[kind]
	if (!s) return
	if (s.busy > 0)
		await Promise.race([
			new Promise<void>((resolve) => s.drained.push(resolve)),
			sleep(timing.drainMs),
		])
	if (servers[kind] === s) await kill(kind)
}

export const killAll = async (): Promise<void> => {
	await Promise.all([kill('llm'), kill('stt')])
}

// Released from memory after the user's idle time (Handy, OpenWhispr): the process
// exits, so its RAM and VRAM really go back. The next dictation loads it again, and
// pressing the shortcut starts that load before the user has finished speaking.
const armIdle = (kind: Kind, s: RunningServer) => {
	clearTimeout(s.idleTimer)
	const minutes = Number(loadSettings().localIdleMinutes)
	if (!(minutes > 0) || servers[kind] !== s) return
	s.idleTimer = setTimeout(() => {
		if (servers[kind] !== s || s.busy > 0) return
		kill(kind)
		runtimeDone({ stopped: [kind] })
	}, minutes * 60_000)
	s.idleTimer.unref()
}

const desired = (
	settings: Settings,
	ctx: engines.HostCtx,
): Record<Kind, boolean> => {
	const localMode = settings.backend === 'local'
	return {
		llm:
			localMode &&
			Boolean(settings.localLlm?.enabled) &&
			isAvailable('llm', settings, ctx),
		stt: localMode && isAvailable('stt', settings, ctx),
	}
}

// What `reconcile(settings)` is about to do, for the Local tab's "Loading models…" /
// "Releasing memory…": nothing when every wanted server already runs as asked.
export const pending = async (
	settings: Settings,
): Promise<{ load: Kind[]; release: Kind[] }> => {
	const ctx = await hostCtx()
	const want = desired(settings, ctx)
	const kinds = ['stt', 'llm'] as const
	return {
		load: kinds.filter(
			(kind) =>
				want[kind] &&
				servers[kind]?.key !== keyOf(specFor(kind, settings, ctx)),
		),
		release: kinds.filter((kind) => !want[kind] && servers[kind]),
	}
}

export interface ReconcileResult {
	/** Servers that actually came up for a new model: nothing claimed on a failure. */
	started: Kind[]
	stopped: Kind[]
	failed: Array<{ kind: Kind; error: string }>
}

/** A finished 'local-runtime' event that reports only `patch`. */
export const runtimeDone = (
	patch: Partial<ReconcileResult> & { error?: string } = {},
) =>
	broadcast('local-runtime', {
		failed: [],
		phase: 'done',
		started: [],
		stopped: [],
		...patch,
	})

export const reconcile = async (
	settings: Settings,
): Promise<ReconcileResult> => {
	const ctx = await hostCtx()
	const want = desired(settings, ctx)
	const stopped = (['stt', 'llm'] as const).filter(
		(kind) => !want[kind] && servers[kind],
	)
	// Unwanted servers go first (once idle): frees VRAM before anything loads.
	await Promise.all(stopped.map((kind) => locked(kind, () => retire(kind))))
	const kinds = (['stt', 'llm'] as const).filter((kind) => want[kind])
	const fresh = kinds.filter(
		(kind) => servers[kind]?.key !== keyOf(specFor(kind, settings, ctx)),
	)
	const results = await Promise.all(
		kinds.map((kind) =>
			ensure(kind, settings).then(
				() => ({ kind }),
				(e: Error) => ({ error: e.message || 'local', kind }),
			),
		),
	)
	const started: Kind[] = []
	const failed: ReconcileResult['failed'] = []
	for (const r of results) {
		if (!('error' in r)) {
			if (fresh.includes(r.kind)) started.push(r.kind)
		} else if (r.error !== SUPERSEDED) failed.push(r) // the newer sync reports
	}
	return { failed, started, stopped }
}

// Per-kind mutex: no two callers spawn/stop the same server at once. Without it, an
// in-flight model load (30+ s) and a model switch would spawn two servers at once.
const ensureLocks: Record<Kind, Promise<unknown>> = {
	llm: Promise.resolve(),
	stt: Promise.resolve(),
}
const locked = <T>(kind: Kind, run: () => Promise<T>): Promise<T> => {
	const result = ensureLocks[kind].then(run)
	ensureLocks[kind] = result.catch(noop) // a failed run must not poison the chain
	return result
}

// A load still running for another spec will never be used: stop it now instead of
// waiting out up to 90 s of it under the lock. Nothing runs on a server that has not
// loaded yet.
const dropStaleLoad = (kind: Kind, settings: Settings) => {
	const s = servers[kind]
	if (s && !s.loaded && host && s.key !== keyOf(specFor(kind, settings, host)))
		kill(kind)
}

const ensure = (kind: Kind, settings: Settings): Promise<RunningServer> => {
	dropStaleLoad(kind, settings)
	return locked(kind, async () => {
		const s = await spawnOrReuse(kind, settings)
		armIdle(kind, s)
		return s
	})
}

// Runs one request against the server for `kind`. The server cannot be stopped while
// `request` runs (model switch, delete, idle release wait for it). A GPU server that
// dies under the request is replaced by a CPU one and the request runs once more.
// The model is the one selected when the request gets its server, not when the
// dictation began: an older choice must not throw out the one loading now.
export const use = async <T>(
	kind: Kind,
	request: (baseUrl: string) => Promise<T>,
): Promise<T> => {
	for (let attempt = 0; ; attempt++) {
		const s = await locked(kind, async () => {
			const server = await spawnOrReuse(kind, loadSettings())
			server.busy += 1
			clearTimeout(server.idleTimer)
			return server
		}).catch((e: Error) => {
			// Replaced while loading for this request: run it on whatever is chosen now.
			if (e.message !== SUPERSEDED || attempt > 0) throw e
			return null
		})
		if (!s) continue
		try {
			return await request(`http://${HOST}:${s.port}`)
		} catch (e) {
			if (attempt > 0 || !(await diedOnGpu(kind, s))) throw e
		} finally {
			s.busy -= 1
			if (s.busy === 0) {
				for (const resolve of s.drained.splice(0)) resolve()
				armIdle(kind, s)
			}
		}
	}
}

const diedOnGpu = async (kind: Kind, s: RunningServer): Promise<boolean> => {
	if (!s.gpu || s.killed) return false
	// The failed request can land before the process's exit event.
	await Promise.race([s.exited, sleep(1000)])
	if (s.exitCode === undefined || s.killed) return false
	gpuFallback[kind] =
		`${classify(s.exitCode, s.stderr)}: GPU server crashed during a request (${s.exitCode})`
	// The Local tab re-reads its status on every runtime event: shows the fallback.
	runtimeDone()
	return true
}

// Stop server holding `modelPath` open (if any) so file can be deleted: Windows
// refuses to unlink a file a running process mapped; models.remove() would swallow
// that error, leaving GBs behind.
export const releaseModel = (kind: Kind, modelPath: string): Promise<void> =>
	locked(kind, () =>
		servers[kind]?.model === modelPath ? retire(kind) : Promise.resolve(),
	)

// Same for an engine: Windows refuses to delete the folder of a running exe (EPERM),
// and the server would go on running from it.
export const releaseEngine = (dir: string): Promise<unknown> =>
	Promise.all(
		(['stt', 'llm'] as const).map((kind) =>
			locked(kind, () =>
				servers[kind]?.binary.startsWith(dir)
					? retire(kind)
					: Promise.resolve(),
			),
		),
	)

const spawnOrReuse = async (
	kind: Kind,
	settings: Settings,
): Promise<RunningServer> => {
	await reaping
	const ctx = await hostCtx()
	const spec = specFor(kind, settings, ctx)
	if (!spec.binary)
		throw new Error('engine: no local engine variant for this device')
	if (!fs.existsSync(spec.binary))
		throw new Error('engine: local engine not installed')
	if (!fs.existsSync(spec.model))
		throw new Error('model: local model not installed')

	if (servers[kind] && servers[kind]?.key !== keyOf(spec)) await retire(kind)
	const current = servers[kind]
	// Loading (released while idle, a new model, still loading from the press): a
	// dictation waiting on it says so on the pill instead of spinning silently.
	if (!current?.loaded) broadcast('model-loading')
	if (current) {
		await current.ready
		return current
	}
	try {
		return await start(kind, spec)
	} catch (e) {
		const message = (e as Error).message
		const fault = message.split(':')[0]
		if (
			!spec.gpu ||
			message === SUPERSEDED ||
			!(fault === 'memory' || fault === 'local')
		)
			throw e
		gpuFallback[kind] = message
		return start(kind, specFor(kind, settings, ctx))
	}
}

const start = async (kind: Kind, spec: Spec): Promise<RunningServer> => {
	const binary = spec.binary as string
	const port = await freePort()
	// stdout is never read: a full pipe would stall the server. stderr is read
	// continuously, its tail kept to explain a failed start.
	const child = spawn(
		binary,
		[...spec.args, '--host', HOST, '--port', String(port)],
		{ stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
	)
	const exited = Promise.withResolvers<void>()
	const s: RunningServer = {
		binary,
		busy: 0,
		child,
		drained: [],
		exited: exited.promise,
		gpu: spec.gpu,
		key: keyOf(spec),
		killed: false,
		loaded: false,
		model: spec.model,
		port,
		ready: Promise.resolve(),
		stderr: '',
	}
	// spawn() itself can fail (binary missing / not executable): surface THAT error,
	// not a ready-wait timeout blaming the model.
	let spawnError: Error | null = null
	child.stderr?.on('data', (d) => {
		s.stderr = (s.stderr + d.toString()).slice(-4000)
	})
	child.on('exit', (code) => {
		s.exitCode = code
		// Clear slot on ANY exit (0 included): a stale entry would hand out the URL
		// of a dead process.
		if (servers[kind] === s) servers[kind] = null
		clearTimeout(s.idleTimer)
		savePids()
		exited.resolve()
	})
	child.on('error', (e) => {
		spawnError = e
	})

	// Register BEFORE the ready check: its first state() runs synchronously and would
	// see a foreign slot as "superseded".
	servers[kind] = s
	savePids()
	const state = (): 'ok' | 'gone' => {
		if (spawnError) throw new Error(`engine: ${spawnError.message}`)
		if (s.killed) return 'gone' // replaced/stopped on purpose
		// Classified from the whole tail: the cause (an allocation failure) can sit
		// well above the last lines.
		if (s.exitCode !== undefined) {
			const fault = classify(s.exitCode, s.stderr)
			const code =
				fault === 'engine' &&
				process.platform === 'win32' &&
				missingVcRuntime().length > 0
					? 'vcredist'
					: fault
			throw new Error(
				`${code}: local engine exited (${s.exitCode})${s.stderr.trim() ? ` — ${s.stderr.slice(-400).trim()}` : ''}`,
			)
		}
		return servers[kind] === s ? 'ok' : 'gone'
	}
	s.ready = (async () => {
		await waitUntilReady(port, spec, Date.now() + timing.readyMs, state)
		// First inference compiles GPU kernels / shaders: up to 30 s once per model.
		// Paid here, not by the user's first dictation.
		try {
			await spec.warm(`http://${HOST}:${port}`)
		} catch {
			/* a failed warm-up only makes the first dictation slower */
		}
		// …unless the server died of it: then the load failed (a GPU driver crash
		// falls back to CPU like any other GPU load failure).
		await Promise.race([s.exited, sleep(50)])
		if (state() === 'gone') throw new Error(SUPERSEDED)
		s.loaded = true
	})().catch((e) => {
		if (servers[kind] === s) kill(kind)
		throw e
	})
	await s.ready
	return s
}

// Our live servers, so a crash's leftovers can be stopped on the next start. Lazy:
// userData may still be redirected (--fresh-user-data) at import time.
const pidFile = () => path.join(app.getPath('userData'), 'servers.json')
let quitting = false
const savePids = () => {
	if (quitting) return
	const live = Object.values(servers).flatMap((s) =>
		s?.child.pid ? [{ name: path.basename(s.binary), pid: s.child.pid }] : [],
	)
	try {
		if (live.length > 0) fs.writeFileSync(pidFile(), JSON.stringify(live))
		else fs.rmSync(pidFile(), { force: true })
	} catch {
		/* userData unwritable: orphans survive till next model switch */
	}
}

// Image name of a running process, null when the PID is gone.
const processName = (pid: number): Promise<string | null> => {
	const win = process.platform === 'win32'
	return new Promise((resolve) => {
		execFile(
			win ? 'tasklist' : 'ps',
			win
				? ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']
				: ['-p', String(pid), '-o', 'comm='],
			{ windowsHide: true },
			(err, stdout) => {
				const out = err ? '' : String(stdout).trim()
				// tasklist: "whisper-server.exe","1234",…  ps: /path/to/whisper-server
				resolve(
					(win ? /^"([^"]+)"/u.exec(out)?.[1] : path.basename(out)) || null,
				)
			},
		)
	})
}

// A PID from the file is stopped only while it still runs our server binary: after a
// reboot Windows reuses PIDs and the file outlives them (OpenWhispr checks the name
// the same way). Every spawn waits for this to finish.
let reaping: Promise<void> = Promise.resolve()
export const killStale = (): Promise<void> => {
	reaping = (async () => {
		let leftovers: unknown
		try {
			leftovers = JSON.parse(fs.readFileSync(pidFile(), 'utf8'))
		} catch {
			return // no leftovers
		}
		fs.rmSync(pidFile(), { force: true })
		const entries = Array.isArray(leftovers) ? leftovers : []
		await Promise.all(
			entries.map(async (entry) => {
				// An entry without a name proves nothing: it is never killed.
				const { name, pid } = (entry ?? {}) as { name?: unknown; pid?: unknown }
				if (typeof pid !== 'number' || typeof name !== 'string') return
				const image = await processName(pid)
				if (image?.toLowerCase() !== name.toLowerCase()) return
				try {
					process.kill(pid)
				} catch {
					/* exited meanwhile */
				}
			}),
		)
	})().catch(noop) // never block every later spawn on a cleanup error
	return reaping
}

// Signals sent synchronously inside killAll(); pidfile is for crashes only, so drop it
// now rather than trust async exit handlers to run before exit.
app.on('before-quit', () => {
	quitting = true
	killAll()
	fs.rmSync(pidFile(), { force: true })
})
