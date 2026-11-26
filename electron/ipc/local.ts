import * as path from 'node:path'
import { app } from 'electron'
import { applySettings, scheduleRuntimeSync } from '../applySettings'
import * as localEngine from '../pipeline/local'
import type { ProgressFn } from '../runtime/downloader'
import * as engines from '../runtime/engines'
import * as models from '../runtime/models'
import {
	betterSpeechModel,
	describeMachine,
	freeDiskGb,
	recommend,
} from '../runtime/recommend'
import * as servers from '../runtime/servers'
import { createSetup, type SetupAsset, type SetupPart } from '../runtime/setup'
import { loadSettings, type Settings } from '../store/settings'
import type { Handler } from '.'
import { type Asset, broadcast, type Events } from './broadcast'

// Every window hears the progress: the asset's row shows it whichever tab started
// the download (its own button, a model choice, the setup). Anything but a cancel
// becomes the reason string the Local tab shows verbatim.
const fetchAsset = async (
	kind: Asset,
	id: string,
	onProgress?: ProgressFn,
): Promise<{ ok: boolean; error?: string }> => {
	const tell = (payload: Omit<Events['progress'], 'id' | 'kind'>) =>
		broadcast('progress', { id, kind, ...payload })
	const progress: ProgressFn = (received, total, phase) => {
		tell({ phase, received, total })
		onProgress?.(received, total, phase)
	}
	let error: string | undefined
	try {
		await (kind === 'engine'
			? engines.download(id, progress)
			: models.download(kind, id, progress))
	} catch (err) {
		error =
			err && (err as Error).name === 'AbortError'
				? 'cancelled'
				: (err as Error).message || 'failed'
	}
	tell({ done: true, error, received: 0, total: 0 })
	// In local mode a new file can complete what the chosen models need: load it
	// now, not at the first dictation.
	if (!error && loadSettings().backend === 'local')
		scheduleRuntimeSync(loadSettings())
	return error ? { error, ok: false } : { ok: true }
}

const cancelAsset = (kind: Asset, id: string) =>
	kind === 'engine' ? engines.cancel(id) : models.cancel(kind, id)

const machineNow = async () => describeMachine(await servers.detectGpus())

const setup = createSetup({
	cancel: ({ kind, id }) => cancelAsset(kind, id),
	download: ({ kind, id }, onProgress) => fetchAsset(kind, id, onProgress),
	publish: (state) => broadcast('local-setup', state),
})

interface TestLine {
	ok: boolean
	skipped?: boolean
	error?: string
}
const check = (test: () => Promise<void>): Promise<TestLine> =>
	test().then(
		() => ({ ok: true }),
		(e: Error) => ({ error: e.message || 'failed', ok: false }),
	)

// A change made here, not in the Settings window: every window has to hear it.
const apply = (patch: Partial<Settings>) =>
	broadcast('settings-changed', applySettings(patch))

// The recommendation for this machine and language, minus what is already on disk.
const setupParts = async (): Promise<SetupPart[]> => {
	const rec = recommend(await machineNow(), loadSettings().language)
	const { stt, llm } = rec
	if (!stt) return []
	const variants = engines.status(await servers.hostCtx())
	const onDisk = models.status()
	const missing = (kind: models.Kind, id: string): SetupAsset[] => {
		const engine = variants[kind === 'stt' ? 'whisper' : 'llama']
		const model = onDisk[kind].find((m) => m.id === id)
		return [
			engine?.id && !engine.installed
				? { bytes: engine.bytes ?? 0, id: engine.id, kind: 'engine' as const }
				: null,
			model && !model.installed ? { bytes: model.bytes, id, kind } : null,
		].filter((a) => a !== null)
	}
	const parts: SetupPart[] = [
		{
			apply: () => apply({ backend: 'local', localStt: { model: stt } }),
			assets: missing('stt', stt),
			step: 'stt',
		},
	]
	if (llm)
		parts.push({
			apply: () => apply({ localLlm: { enabled: true, model: llm } }),
			assets: missing('llm', llm),
			step: 'llm',
		})
	return parts
}

export const handlers = {
	// One handler per verb, keyed by asset kind: engines and models differ only in
	// which store owns the file.
	'cancel-download': (_e, kind: Asset, id: string) => cancelAsset(kind, id),

	'delete-asset': async (_e, kind: Asset, id: string) => {
		if (kind === 'engine') {
			const exe = engines.serverPath(id)
			if (exe) await servers.releaseEngine(path.dirname(exe))
			return engines.remove(id)
		}
		// Running server holding this model open: stop first; else Windows refuses
		// unlink and multi-GB file silently stays on disk.
		await servers.releaseModel(kind, models.pathFor(kind, id))
		models.remove(kind, id)
	},

	'download-asset': (_e, kind: Asset, id: string) => fetchAsset(kind, id),

	'get-local-status': async () => {
		// One source of truth for variant selection (incl. Linux Vulkan probe): same
		// ctx the servers use, so UI never reports CPU while the server picked Vulkan.
		const gpus = await servers.detectGpus()
		const machine = await describeMachine(gpus)
		const settings = loadSettings()
		const recommendation = recommend(machine, settings.language)
		return {
			cpuFallback: servers.cpuFallback(),
			engines: {
				gpus,
				variants: engines.status(await servers.hostCtx()),
			},
			freeGb: freeDiskGb(app.getPath('userData')),
			/** A speech model that suits the dictation language better than the chosen one. */
			languageHint: betterSpeechModel(
				settings.localStt?.model,
				settings.language,
				recommendation,
			),
			machine,
			models: models.status(),
			recommendation,
			setup: setup.state(),
		}
	},

	'local-setup': async (_e, action: 'start' | 'cancel' | 'dismiss') => {
		if (action === 'cancel') setup.cancel()
		else if (action === 'dismiss') setup.dismiss()
		else if (setup.state().phase !== 'running') setup.start(await setupParts())
	},

	// Speech first, then cleanup: each line is ok, the failure, or skipped.
	'test-local': async (): Promise<Record<'stt' | 'llm', TestLine>> => {
		const settings = loadSettings()
		const stt = await check(localEngine.testStt)
		const llm = settings.localLlm?.enabled
			? await check(localEngine.testLlm)
			: { ok: false, skipped: true }
		return { llm, stt }
	},
} satisfies Record<string, Handler>
