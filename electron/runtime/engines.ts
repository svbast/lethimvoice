import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import { config } from '../utils/config'
import {
	downloadJobs,
	downloadVerified,
	ensureSpace,
	type ProgressFn,
} from './downloader'

const { llamaTag, releases, whisperTag } = config.engines

type EngineName = 'llama' | 'whisper'

interface EngineVariant {
	id: string
	engine: EngineName
	platform: 'win' | 'mac' | 'linux'
	arch: 'x64' | 'arm64'
	accel: 'vulkan' | 'cuda' | 'cpu' | 'metal'
	server: string
	bytes: number
	label: string
	url: string
	sha256: string
}

export interface HostCtx {
	platform?: 'win' | 'mac' | 'linux'
	arch?: 'x64' | 'arm64'
	hasNvidia?: boolean
	accel?: 'vulkan' | 'cpu'
}

interface EngineStatus {
	engine: string
	supported: boolean
	id?: string
	label?: string
	accel?: string
	bytes?: number
	installed?: boolean
	downloading?: boolean
}

// `bytes`/`sha256`: exact GitHub release asset metadata (api/repos/…/releases/tags/
// <tag>: size + digest). Executables: archive verified against pinned hash before
// extraction; new tag: refresh both from API. `id` and `server` follow from the rest.
const VARIANTS: Omit<EngineVariant, 'id' | 'server'>[] = [
	{
		accel: 'vulkan',
		arch: 'x64',
		bytes: 32_153_933,
		engine: 'llama',
		label: 'llama.cpp (Vulkan)',
		platform: 'win',
		sha256: '53fa4415d9562d380395060f6b46e96710313f830fa11bc37256d21653dac3cc',
		url: `${releases}/llama.cpp/releases/download/${llamaTag}/llama-${llamaTag}-bin-win-vulkan-x64.zip`,
	},
	{
		accel: 'cuda',
		arch: 'x64',
		bytes: 677_887_125,
		engine: 'whisper',
		label: 'whisper.cpp (NVIDIA CUDA)',
		platform: 'win',
		sha256: '106a2030eff8998e4ef320fe72e263a78449e9040386ee27c41ea80b001b601b',
		url: `${releases}/whisper.cpp/releases/download/${whisperTag}/whisper-cublas-12.4.0-bin-x64.zip`,
	},
	{
		accel: 'cpu',
		arch: 'x64',
		bytes: 20_769_031,
		engine: 'whisper',
		label: 'whisper.cpp (CPU)',
		platform: 'win',
		sha256: '3c319eab3e87f85883e1ff3d14426c0a1986c661c5eb5985e8af431ed9c4f71f',
		url: `${releases}/whisper.cpp/releases/download/${whisperTag}/whisper-blas-bin-x64.zip`,
	},

	{
		accel: 'vulkan',
		arch: 'x64',
		bytes: 31_206_889,
		engine: 'llama',
		label: 'llama.cpp (Vulkan)',
		platform: 'linux',
		sha256: '86ef0222f496a21bdbb8e7d24bab8115226f4e28a227b9ae1aafdcac16d2c7fd',
		url: `${releases}/llama.cpp/releases/download/${llamaTag}/llama-${llamaTag}-bin-ubuntu-vulkan-x64.tar.gz`,
	},
	{
		accel: 'cpu',
		arch: 'x64',
		bytes: 15_856_175,
		engine: 'llama',
		label: 'llama.cpp (CPU)',
		platform: 'linux',
		sha256: '0771ce4accfb6e18c2b02cf0ca15b194b5f3f3dcd0a897b981d82b8dcdb01ed7',
		url: `${releases}/llama.cpp/releases/download/${llamaTag}/llama-${llamaTag}-bin-ubuntu-x64.tar.gz`,
	},
	{
		accel: 'vulkan',
		arch: 'arm64',
		bytes: 25_502_424,
		engine: 'llama',
		label: 'llama.cpp (Vulkan)',
		platform: 'linux',
		sha256: '58826ce2ad8d44403195f6f6f509da82b1d561f87c4c33bbd9455e19d28bfd34',
		url: `${releases}/llama.cpp/releases/download/${llamaTag}/llama-${llamaTag}-bin-ubuntu-vulkan-arm64.tar.gz`,
	},
	{
		accel: 'cpu',
		arch: 'arm64',
		bytes: 12_857_136,
		engine: 'llama',
		label: 'llama.cpp (CPU)',
		platform: 'linux',
		sha256: '62f4bb9f28ca5c117b4bf33ca103e8d23472a6b6038ef9c2ef5ba202db7eb646',
		url: `${releases}/llama.cpp/releases/download/${llamaTag}/llama-${llamaTag}-bin-ubuntu-arm64.tar.gz`,
	},
	{
		accel: 'cpu',
		arch: 'x64',
		bytes: 9_379_235,
		engine: 'whisper',
		label: 'whisper.cpp (CPU)',
		platform: 'linux',
		sha256: 'f3bf3b4369a99b54665b0f19b88483b30de27f25963b0414235dea03198515c5',
		url: `${releases}/whisper.cpp/releases/download/${whisperTag}/whisper-bin-ubuntu-x64.tar.gz`,
	},
	{
		accel: 'cpu',
		arch: 'arm64',
		bytes: 4_555_819,
		engine: 'whisper',
		label: 'whisper.cpp (CPU)',
		platform: 'linux',
		sha256: 'e0b66cd551ff6f2a28fabe3c6e89691eea037bb76833493abb9a71ca788994b3',
		url: `${releases}/whisper.cpp/releases/download/${whisperTag}/whisper-bin-ubuntu-arm64.tar.gz`,
	},
	{
		accel: 'metal',
		arch: 'arm64',
		bytes: 11_131_258,
		engine: 'llama',
		label: 'llama.cpp (Metal)',
		platform: 'mac',
		sha256: '62b807ab91a18cf802a19b622127f0799cb815271e5965fd47e8fab32198efd8',
		url: `${releases}/llama.cpp/releases/download/${llamaTag}/llama-${llamaTag}-bin-macos-arm64.tar.gz`,
	},
	{
		accel: 'metal',
		arch: 'x64',
		bytes: 11_444_684,
		engine: 'llama',
		label: 'llama.cpp (Metal, Intel)',
		platform: 'mac',
		sha256: '1ef070dfe19c518ff68b0fa321b9aca9c88af5a1dd75637504c6338deb24d0b0',
		url: `${releases}/llama.cpp/releases/download/${llamaTag}/llama-${llamaTag}-bin-macos-x64.tar.gz`,
	},
]

export const CATALOG: EngineVariant[] = VARIANTS.map((v) => ({
	...v,
	id: `${v.engine}-${v.platform}-${v.arch}-${v.accel}`,
	server: `${v.engine}-server${v.platform === 'win' ? '.exe' : ''}`,
}))

export const osKey = (): 'win' | 'mac' | 'linux' => {
	if (process.platform === 'win32') return 'win'
	if (process.platform === 'darwin') return 'mac'
	if (process.platform === 'linux') return 'linux'
	throw new Error(`unsupported platform: ${process.platform}`)
}

const get = (id: string): EngineVariant | null =>
	CATALOG.find((b) => b.id === id) || null

// Pick variant from OS/arch/GPU. llama → Vulkan (win, capable Linux), CPU (other
// Linux), Metal (mac). whisper → CUDA on win + NVIDIA (that variant also runs CPU via
// --no-gpu, so NVIDIA users need only it), else CPU (win/Linux); mac has no whisper
// variant at all, so selection returns null there and the UI reports unsupported.
// computeMode is NOT part of variant selection: only toggles -ngl / --no-gpu at spawn.
// Returns catalog entry, or null when no variant covers the platform.
export const selectVariant = (
	engine: EngineName,
	ctx: HostCtx,
): EngineVariant | null => {
	const platform = ctx.platform || osKey()
	const arch = ctx.arch || (process.arch === 'arm64' ? 'arm64' : 'x64')
	let accel: EngineVariant['accel']
	if (engine === 'llama') {
		if (platform === 'mac') accel = 'metal'
		else if (platform === 'linux')
			accel = ctx.accel === 'vulkan' ? 'vulkan' : 'cpu'
		else accel = 'vulkan'
	} else if (platform === 'mac') {
		accel = 'metal'
	} else if (platform === 'linux') {
		accel = 'cpu'
	} else {
		accel = ctx.hasNvidia ? 'cuda' : 'cpu'
	}
	return get(`${engine}-${platform}-${arch}-${accel}`)
}

const enginesDir = (): string => path.join(app.getPath('userData'), 'engines')

const installedDir = (id: string): string => path.join(enginesDir(), id)

export const serverPath = (id: string): string | null => {
	const b = get(id)
	return b ? path.join(installedDir(id), b.server) : null
}

export const isInstalled = (id: string): boolean => {
	const p = serverPath(id)
	return p !== null && fs.existsSync(p)
}

const jobs = downloadJobs()

// Downloads go through Chromium's downloader (downloader.ts says why). Archive verified
// FROM DISK against pinned SHA256 before extraction — these are executables we run,
// and a GitHub release asset can be replaced by the repo owner anytime; pin makes that
// a hard failure, not silent.
export const download = (
	id: string,
	onProgress?: ProgressFn,
): Promise<void> => {
	const running = jobs.running(id)
	if (running) return running
	const b = get(id)
	if (!b) return Promise.reject(new Error('unknown engine variant'))
	if (isInstalled(id)) return Promise.resolve()
	return jobs.start(id, (signal) => install(id, b, signal, onProgress))
}

const install = async (
	id: string,
	b: EngineVariant,
	signal: AbortSignal,
	onProgress?: ProgressFn,
): Promise<void> => {
	fs.mkdirSync(enginesDir(), { recursive: true })
	const isTar = /\.tar\.gz$|\.tgz$/u.test(b.url)
	const archivePath = path.join(
		enginesDir(),
		`${id}.${isTar ? 'tar.gz' : 'zip'}.part`,
	)
	try {
		// Archive + extracted copy side by side, until the archive is deleted.
		ensureSpace(enginesDir(), b.bytes * 2.2)
		await downloadVerified(b.url, archivePath, b, { onProgress, signal })

		const dir = installedDir(id)
		fs.rmSync(dir, { force: true, recursive: true })
		fs.mkdirSync(dir, { recursive: true })
		await extractFlat(archivePath, dir)
		fs.rmSync(archivePath, { force: true })
		// A cancel made while extracting lands here, before anything installs.
		if (signal.aborted) {
			fs.rmSync(dir, { force: true, recursive: true })
			signal.throwIfAborted()
		}

		if (!fs.existsSync(path.join(dir, b.server))) {
			throw new Error(`build: ${b.server} not found in archive`)
		}
		// macOS: tar keeps mode bits and the arm64 linker already ad-hoc signed every
		// Mach-O; the only thing Gatekeeper can still trip on is a quarantine flag.
		if (osKey() === 'mac')
			await promisify(execFile)('xattr', [
				'-dr',
				'com.apple.quarantine',
				dir,
			]).catch(() => undefined)
	} catch (e) {
		fs.rmSync(archivePath, { force: true })
		throw e
	}
}

// Extract archive, flatten every file into destDir by basename (Release/, build/bin/
// collapse — server expects its DLLs/dylibs alongside it). No zip library: OS ships
// one. `tar -xf` auto-detects zip AND tar.gz; macOS /usr/bin/tar, Linux GNU tar,
// Windows System32\tar.exe since Win10 17063 (Electron requires a later build).
// Streams in C, so 650 MB CUDA archive never sits in memory. Absolute path on Windows
// is load-bearing: Git for Windows / MSYS put GNU tar earlier on PATH, and GNU tar
// CANNOT read zip. Gated on win32: Linux builds are .tar.gz upstream, so plain GNU
// `tar` is correct there; System32 libarchive only needed for Windows ZIPs.
const TAR =
	process.platform === 'win32'
		? path.join(config.systemRoot, 'System32', 'tar.exe')
		: 'tar'

const extractFlat = async (archivePath: string, destDir: string) => {
	const tmp = `${destDir}.x`
	fs.rmSync(tmp, { force: true, recursive: true })
	fs.mkdirSync(tmp, { recursive: true })
	try {
		await promisify(execFile)(TAR, ['-xf', archivePath, '-C', tmp])
		for (const ent of fs.readdirSync(tmp, {
			recursive: true,
			withFileTypes: true,
		}))
			if (!ent.isDirectory())
				fs.renameSync(
					path.join(ent.parentPath, ent.name),
					path.join(destDir, ent.name),
				)
	} finally {
		fs.rmSync(tmp, { force: true, recursive: true })
	}
}

export const cancel = (id: string): void => {
	jobs.cancel(id)
}

export const remove = (id: string): void => {
	fs.rmSync(installedDir(id), { force: true, recursive: true })
}

export const status = (ctx: HostCtx): Record<string, EngineStatus> => {
	const out: Record<string, EngineStatus> = {}
	for (const engine of ['llama', 'whisper'] as const) {
		const b = selectVariant(engine, ctx)
		if (!b) {
			out[engine] = { engine, supported: false }
			continue
		}
		out[engine] = {
			accel: b.accel,
			bytes: b.bytes,
			downloading: Boolean(jobs.running(b.id)),
			engine,
			id: b.id,
			installed: isInstalled(b.id),
			label: b.label,
			supported: true,
		}
	}
	return out
}
