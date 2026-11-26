import { notify } from '../i18n'
import { broadcast } from '../ipc/broadcast'
import { loadSettings, type Settings } from '../store/settings'
import * as stats from '../store/stats'
import { filterHallucinations } from './hallucination'
import {
	type ChatReply,
	chatMessages,
	POST_PROCESS_MODELS,
	type Prepared,
	preparePostProcess,
	reasoningBodyFor,
	replyText,
	temperatureFor,
	whisperForm,
} from './prompts'

const GROQ_API = 'https://api.groq.com/openai/v1'

const getApiKey = () => (loadSettings().apiKey || '').trim()

// Speech-to-text chain, preference order, same rule as POST_PROCESS_MODELS: the next
// model takes over the same recording when the one ahead fails. Full large-v3 first,
// not turbo: turbo cuts decoder layers 32→4 for ~4× speed, loses ~5–15% relative WER
// on non-English; Slavic dictation: accuracy beats the extra ~200–400 ms on Groq LPU
// hardware. Turbo is the backup: Groq's other production Whisper, same request
// fields, own daily budget — a retired or spent large-v3 costs accuracy, never the
// dictation. groq.live.test.ts checks both daily.
export const STT_MODELS = ['whisper-large-v3', 'whisper-large-v3-turbo']

// Models Groq reported shut down, skipped until restart: a retired id never comes
// back, and the STT chain would re-upload every recording to it first. Rate-limited
// models stay in play — their budgets refill continuously.
const retired = new Set<string>()
const isRetired = async (res: Response) => {
	if (res.status === 404) return true
	const body = (await res.json().catch(() => null)) as {
		error?: { code?: string }
	} | null
	const code = body?.error?.code
	return code === 'model_decommissioned' || code === 'model_not_found'
}

// What the Online tab shows per model: how the chain's last walk left it.
// 'standby' = not reached, a model ahead answered. Kept for this run only, like
// `retired`: before the first dictation nothing is known, and nothing is claimed.
type ModelState = 'active' | 'limited' | 'failed' | 'retired' | 'standby'
type Chain = 'stt' | 'llm'
const CHAINS: Record<Chain, string[]> = {
	llm: POST_PROCESS_MODELS,
	stt: STT_MODELS,
}
const lastWalk: Partial<
	Record<Chain, { at: number; states: Record<string, ModelState> }>
> = {}

export const modelStatus = () => {
	const out = {} as Record<
		Chain,
		{ at?: number; models: Array<{ id: string; state?: ModelState }> }
	>
	for (const chain of ['stt', 'llm'] as const) {
		const walk = lastWalk[chain]
		out[chain] = {
			at: walk?.at,
			models: CHAINS[chain].map((id) => ({
				id,
				state: retired.has(id)
					? 'retired'
					: walk && (walk.states[id] ?? 'standby'),
			})),
		}
	}
	return out
}

// Walks a model chain in preference order; `model` is set once one answers OK. Any
// failed reply hands the same request to the next model: 429 = that model's budget
// is spent; anything else (retired model, outage) is that model's too. A thrown
// network error ends the walk: the next model sits behind the same connection.
// `failed` = a model errored or is retired, not merely rate-limited.
// Known limit: a rate-limited model is re-probed every dictation until its budget
// refills (one wasted request, ~200 ms); add a cooldown if that ever shows up.
const askChain = async (
	chain: Chain,
	send: (model: string) => Promise<Response>,
): Promise<{ failed: boolean; model?: string; res?: Response }> => {
	let res: Response | undefined
	let failed = false
	const states: Record<string, ModelState> = {}
	try {
		for (const model of CHAINS[chain]) {
			if (retired.has(model)) {
				failed = true
				continue
			}
			states[model] = 'failed' // until the reply says otherwise; a throw keeps it
			res = await send(model)
			if (res.ok) {
				states[model] = 'active'
				return { failed, model, res }
			}
			if (res.status === 429) states[model] = 'limited'
			else failed = true
			if (await isRetired(res)) {
				// First shutdown this run: tell the user once. Dictation goes on via the
				// backup, but only an update brings the replacement model.
				if (retired.size === 0) notify('modelRetired')
				retired.add(model)
			}
		}
		return { failed, res }
	} finally {
		lastWalk[chain] = { at: Date.now(), states }
		broadcast('models-changed', modelStatus())
	}
}

// One Whisper request exactly as a dictation sends it; groq.live.test.ts sends it to
// every model in STT_MODELS.
export const requestTranscription = (
	model: string,
	audio: Blob,
	settings: Settings,
	apiKey: string,
) => {
	const formData = whisperForm(
		audio,
		`audio.${audio.type.split('/')[1] || 'webm'}`,
		settings,
		model,
	)
	// Hard timeout on WHOLE exchange, body read included. Without it a stalled
	// connection leaves this await pending forever — pill stuck on "thinking", nothing
	// left to hide it. 60 s far beyond any real Whisper turnaround; fires only on a
	// dead transfer.
	return fetch(`${GROQ_API}/audio/transcriptions`, {
		body: formData,
		headers: { Authorization: `Bearer ${apiKey}` },
		method: 'POST',
		signal: AbortSignal.timeout(60 * 1000),
	}).catch((e) => {
		throw new Error(`network: ${e.message || 'connection failed'}`)
	})
}

// HTTP status → the error code the pill localizes (errors.* in locales).
const errorCode = (status: number) =>
	status === 401 || status === 403
		? 'auth'
		: status === 429
			? 'quota'
			: status >= 500
				? 'server'
				: 'http'

export const transcribe = async (buffer: Buffer, mimeType = 'audio/webm') => {
	if (buffer.length === 0) throw new Error('empty: empty audio buffer')
	if (buffer.length < 1000)
		throw new Error(`short: audio too short (${buffer.length} bytes)`)

	const apiKey = getApiKey()
	if (!apiKey) throw new Error('auth: no api key configured')

	const settings = loadSettings()

	// DOM BlobPart rejects ArrayBufferLike; Node never hands out shared-backed buffers.
	const audio = new Blob([buffer as Uint8Array<ArrayBuffer>], {
		type: mimeType.split(';')[0] ?? mimeType,
	})

	const { res } = await askChain('stt', (model) =>
		requestTranscription(model, audio, settings, apiKey),
	)
	// Nothing left to ask: say "update", not a bare HTTP error.
	if (!res || STT_MODELS.every((m) => retired.has(m)))
		throw new Error('retired: every speech model shut down')

	// Every response carries key's remaining quota; record the answering model's (or
	// the last refusal's) before anything can throw — the Statistics tab shows what
	// the next dictation can still spend.
	stats.recordLimits('stt', res.headers)

	if (!res.ok) throw new Error(`${errorCode(res.status)}: HTTP ${res.status}`)

	return filterHallucinations(await res.json())
}

// Tell user ONCE per failure streak: dictation still works, no longer cleaned up.
// Not an error (transcript was pasted); must not hijack the pill. 'llmLimit' passes
// on its own; 'llmFail' may be a retired model only an update fixes — never hide it
// behind the limit message.
let notified = false
const notifyRawPaste = (kind: 'llmLimit' | 'llmFail') => {
	if (notified) return
	notified = true
	notify(kind)
}

// One chat request exactly as a dictation sends it; groq.live.test.ts sends it to
// every model in POST_PROCESS_MODELS. Same stalled-transfer guard as transcribe:
// hung LLM call falls back to raw transcript, never holds the paste hostage.
export const requestCompletion = (
	model: string,
	prep: Prepared,
	apiKey: string,
) =>
	fetch(`${GROQ_API}/chat/completions`, {
		body: JSON.stringify({
			max_completion_tokens: prep.maxTokens,
			messages: chatMessages(prep),
			model,
			temperature: temperatureFor(prep.mode.kind),
			...reasoningBodyFor(model),
		}),
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		method: 'POST',
		signal: AbortSignal.timeout(30 * 1000),
	})

// Falls back to raw transcript on ANY error and for 'raw'/deleted mode; recording
// never silently fails. Mode → messages logic shared via prompts.ts: cloud and local
// engines stay in lockstep.
export const postProcess = async (text: string, settings: Settings) => {
	const prep = preparePostProcess(text, settings)
	if (!prep) return text

	const apiKey = getApiKey()
	if (!apiKey) return text

	try {
		const { failed, model, res } = await askChain('llm', async (m) => {
			const reply = await requestCompletion(m, prep, apiKey)
			stats.recordLimits(`llm:${m}`, reply.headers)
			return reply
		})
		if (!(model && res)) {
			notifyRawPaste(failed ? 'llmFail' : 'llmLimit')
			return text
		}
		const json = (await res.json()) as ChatReply
		notified = false
		stats.recordLlm('cloud', json.usage, model)
		return replyText(json, text)
	} catch {
		// Timeout/network: next model would wait out another 30 s. Paste raw now.
		notifyRawPaste('llmFail')
		return text
	}
}

// Settings → Online "Test": any authenticated call proves the key; listing models is
// the cheapest.
export const testApiKey = async (apiKey: string) => {
	if (!apiKey?.trim()) return { error: 'empty', ok: false }
	try {
		const res = await fetch(`${GROQ_API}/models`, {
			headers: { Authorization: `Bearer ${apiKey.trim()}` },
			signal: AbortSignal.timeout(8000),
		})
		return res.ok ? { ok: true } : { error: `HTTP ${res.status}`, ok: false }
	} catch (e) {
		return {
			error:
				(e as Error).name === 'TimeoutError'
					? 'timeout'
					: (e as Error).message || 'network',
			ok: false,
		}
	}
}
