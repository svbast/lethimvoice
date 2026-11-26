import * as servers from '../runtime/servers'
import { loadSettings, type Settings } from '../store/settings'
import * as stats from '../store/stats'
import { filterHallucinations } from './hallucination'
import {
	type ChatReply,
	chatMessages,
	preparePostProcess,
	replyText,
	temperatureFor,
	whisperForm,
} from './prompts'

// whisper-server decodes via miniaudio (wav/flac/mp3, resamples itself); no
// opus/webm, so the renderer sends PCM WAV for local.
export const transcribe = async (buffer: Buffer, _mimeType?: string) => {
	if (!buffer || buffer.length < 44)
		throw new Error('empty: empty audio buffer')

	// whisper.cpp emits avg_logprob and no_speech_prob only (no compression_ratio),
	// and no_speech_prob is ~0 upstream (whisper.cpp PR #3945 unmerged); the
	// transcript filter treats missing fields as "keep".
	const form = whisperForm(
		// DOM BlobPart rejects ArrayBufferLike; Node buffers never shared-backed.
		new Blob([buffer as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }),
		'audio.wav',
		loadSettings(),
	)

	// Whole exchange bounded like the cloud path (cloud.ts): a wedged server would
	// otherwise leave the pill on "thinking" forever. Budget follows the audio, so a
	// 3 s dictation doesn't wait 5 min on a hung process: 1 min + 3× its length
	// (large-v3 on a slow CPU runs ~1× real time), at most 5 min.
	const audioMs = (buffer.length - 44) / 32 // 16 kHz mono 16-bit: 32 bytes/ms
	return await servers.use('stt', async (baseUrl) => {
		const res = await fetch(`${baseUrl}/inference`, {
			body: form,
			method: 'POST',
			signal: AbortSignal.timeout(Math.min(300_000, 60_000 + 3 * audioMs)),
		}).catch((e) => {
			throw new Error(
				`local: whisper request failed (${e.message || 'connection'})`,
			)
		})
		if (!res.ok) throw new Error(`local: whisper HTTP ${res.status}`)
		return filterHallucinations(await res.json())
	})
}

// Every local chat request goes out with thinking off at the chat template: Gemma 4
// and Qwen3 otherwise reason silently on every dictation, ~10× the tokens and time.
// max_tokens bounds a runaway reply.
const chatCompletion = (body: {
	max_tokens: number
	[field: string]: unknown
}) =>
	servers.use('llm', async (baseUrl) => {
		const res = await fetch(`${baseUrl}/v1/chat/completions`, {
			body: JSON.stringify({
				...body,
				chat_template_kwargs: { enable_thinking: false },
			}),
			headers: { 'Content-Type': 'application/json' },
			method: 'POST',
			signal: AbortSignal.timeout(30_000),
		}).catch((e: Error) => {
			throw new Error(
				e.name === 'TimeoutError'
					? 'timeout: local llm'
					: `local: llm request failed (${e.message})`,
			)
		})
		if (!res.ok) throw new Error(`local: llm HTTP ${res.status}`)
		return (await res.json()) as ChatReply
	})

export const postProcess = async (text: string, settings: Settings) => {
	const prep = preparePostProcess(text, settings)
	if (!prep) return text

	try {
		const model = settings.localLlm?.model || 'local'
		const json = await chatCompletion({
			max_tokens: prep.maxTokens,
			messages: chatMessages(prep),
			model,
			stream: false,
			temperature: temperatureFor(prep.mode.kind),
		})
		stats.recordLlm('local', json?.usage)
		return replyText(json, text)
	} catch {
		return text
	}
}

// Exercises the server spawn/model-load lifecycle plus inference; surfaces the same
// coded startup errors as a real dictation.
export const testStt = async () => {
	await transcribe(servers.silentWav())
}

export const testLlm = async () => {
	const json = await chatCompletion({
		max_tokens: 8,
		messages: [{ content: 'Reply with exactly: OK', role: 'user' }],
		model: 'test',
		stream: false,
		temperature: 0,
	})
	const raw = json?.choices?.[0]?.message?.content
	if (!raw?.trim()) throw new Error('local: empty test response')
}
