import * as fs from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'
import {
	downloadJobs,
	downloadVerified,
	ensureSpace,
	type ProgressFn,
} from './downloader'

export type Kind = 'stt' | 'llm'

// What a fresh install uses (store/settings.ts) and what a setting without a model
// falls back to (servers.ts).
export const DEFAULT_MODEL: Record<Kind, string> = {
	llm: 'gemma-4-e2b',
	stt: 'large-v3-turbo-q5_0',
}

interface ModelEntry {
	id: string
	bytes: number
	sha256: string
	url: string
	label: string
	note: string
}

interface ModelStatus {
	id: string
	label: string
	note: string
	bytes: number
	installed: boolean
	downloading: boolean
}

// `bytes`/`sha256`: exact Hugging Face LFS metadata (api/models/<repo>/tree); every
// download verified against both before install. Saved under the URL's file name.
const CATALOG: Record<Kind, ModelEntry[]> = {
	llm: [
		{
			bytes: 3_349_516_256,
			id: 'gemma-4-e2b',
			label: 'Gemma 4 E2B (QAT q4)',
			note: 'default',
			sha256:
				'fa401b55b07ee70a54c6dae3903c783a6e65064312529ea57175cb5f8dec6634',
			url: 'https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf/resolve/main/gemma-4-E2B_q4_0-it.gguf',
		},
	],
	stt: [
		{
			bytes: 3_095_033_483,
			id: 'large-v3',
			label: 'Large v3',
			note: 'best',
			sha256:
				'64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2',
			url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin',
		},
		{
			bytes: 574_041_195,
			id: 'large-v3-turbo-q5_0',
			label: 'Large v3 Turbo (q5)',
			note: 'small',
			sha256:
				'394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
			url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
		},
		{
			bytes: 147_951_465,
			id: 'base',
			label: 'Base',
			note: 'English only',
			sha256:
				'60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
			url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
		},
	],
}

const modelsDir = (): string => path.join(app.getPath('userData'), 'models')
const fileOf = (m: ModelEntry): string =>
	path.join(modelsDir(), path.basename(m.url))

const entry = (kind: Kind, id: string): ModelEntry | null =>
	CATALOG[kind].find((m) => m.id === id) || null

// Unknown ids treated as raw filenames so servers.ts can still resolve them.
export const pathFor = (kind: Kind, id: string): string => {
	const e = entry(kind, id)
	return e ? fileOf(e) : path.join(modelsDir(), id)
}

const jobs = downloadJobs()

// Exact size, not mere existence: a truncated or foreign file under the model's name
// is not a model. The app only ever installs files it hashed.
const isInstalled = (m: ModelEntry): boolean => {
	try {
		return fs.statSync(fileOf(m)).size === m.bytes
	} catch {
		return false
	}
}
const dlKey = (kind: Kind, id: string) => `${kind}:${id}`

export const status = (): Record<Kind, ModelStatus[]> => {
	const out = {} as Record<Kind, ModelStatus[]>
	for (const kind of Object.keys(CATALOG) as Kind[]) {
		out[kind] = CATALOG[kind].map((m) => ({
			bytes: m.bytes,
			downloading: Boolean(jobs.running(dlKey(kind, m.id))),
			id: m.id,
			installed: isInstalled(m),
			label: m.label,
			note: m.note,
		}))
	}
	return out
}

// Chromium writes the file: Node streams corrupted large downloads. Verify exact size
// and SHA256 from disk before install; failed attempts restart clean, no .part reuse.
export const download = (
	kind: Kind,
	id: string,
	onProgress?: ProgressFn,
): Promise<void> => {
	const e = entry(kind, id)
	if (!e) return Promise.reject(new Error('unknown model'))
	const key = dlKey(kind, id)
	const running = jobs.running(key)
	if (running) return running
	// A wrong-sized file under the name is not the model: downloaded over.
	if (isInstalled(e)) return Promise.resolve()

	return jobs.start(key, async (signal) => {
		fs.mkdirSync(modelsDir(), { recursive: true })
		const dest = fileOf(e)
		const part = `${dest}.part`
		try {
			// 10 % headroom: the .part and the filesystem's own slack.
			ensureSpace(modelsDir(), e.bytes * 1.1)
			await downloadVerified(e.url, part, e, { onProgress, signal })
			fs.renameSync(part, dest)
		} catch (err) {
			fs.rmSync(part, { force: true })
			throw err
		}
	})
}

export const cancel = (kind: Kind, id: string): void => {
	jobs.cancel(dlKey(kind, id))
}

export const remove = (kind: Kind, id: string): void => {
	const e = entry(kind, id)
	if (!e) return
	for (const f of [fileOf(e), `${fileOf(e)}.part`]) {
		try {
			fs.unlinkSync(f)
		} catch {
			/* not there */
		}
	}
}
