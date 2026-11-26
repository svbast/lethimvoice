import { afterAll, beforeAll, describe, expect, it, jest } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import en from '../../locales/en.json'
import { fake } from '../electron.mock'
import type * as SettingsModule from '../store/settings'
import type { Settings } from '../store/settings'
import type * as StatsModule from '../store/stats'
import type * as CloudModule from './cloud'
import type * as PromptsModule from './prompts'

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-test-'))
fake.userData = userData
// Through saveSettings, not the file: settings are cached for the whole bun process,
// so a file written here goes unread after an earlier test file loaded settings.
const store: typeof SettingsModule = require('../store/settings')
store.saveSettings({
	...store.loadSettings(),
	activeModeId: 'clean',
	apiKey: 'test-key',
	language: 'sk',
	uiLanguage: 'en',
})

interface Reply {
	status: number
	code?: string // Groq error.code, e.g. 'model_decommissioned'
	cut?: boolean // the reply ran into max_completion_tokens
}
let calls: string[] = []
let lastBody: FormData | Record<string, unknown> | null = null
let respond: (model: string) => Reply = () => ({ status: 200 })

// Restored in afterAll: test files share one process, and a later file may talk to a
// real local server (servers.test.ts).
const realFetch = global.fetch
global.fetch = (async (_url: string, { body }: { body: string | FormData }) => {
	const stt = body instanceof FormData
	lastBody = stt ? body : JSON.parse(body)
	const model = String(
		stt ? body.get('model') : (lastBody as Record<string, unknown>).model,
	)
	calls.push(model)
	const r = respond(model)
	const json =
		r.status === 200
			? stt
				? { text: 'SPOKEN' }
				: {
						choices: [
							{
								finish_reason: r.cut ? 'length' : 'stop',
								message: { content: 'CLEANED' },
							},
						],
						usage: { completion_tokens: 5, prompt_tokens: 10 },
					}
			: { error: { code: r.code, message: 'Request failed' } }

	const headers: Record<string, string> = {
		'x-ratelimit-limit-requests': '1000',
		'x-ratelimit-limit-tokens': '12000',
		'x-ratelimit-remaining-requests': '985',
		'x-ratelimit-remaining-tokens': '10500',
		'x-ratelimit-reset-requests': '21m36s',
		'x-ratelimit-reset-tokens': '7.5s',
	}
	return {
		headers: {
			get: (k: string) =>
				headers[k] === undefined ? null : String(headers[k]),
		},
		json: async () => json,
		ok: r.status === 200,
		status: r.status,
	}
}) as unknown as typeof fetch

const cloud: typeof CloudModule = require('./cloud')
const stats: typeof StatsModule = require('../store/stats')
const { POST_PROCESS_MODELS }: typeof PromptsModule = require('./prompts')
const [PRIMARY, FALLBACK] = POST_PROCESS_MODELS as [string, string]
const [STT_PRIMARY, STT_FALLBACK] = cloud.STT_MODELS as [string, string]

const settings = {
	activeModeId: 'clean',
	apiKey: 'test-key',
	language: 'sk',
} as Settings
// Online tab indicator: each model's state after the chain's last walk.
const states = (chain: 'stt' | 'llm') =>
	cloud.modelStatus()[chain].models.map((m) => m.state)
const reset = (r: (model: string) => Reply = () => ({ status: 200 })) => {
	calls = []
	lastBody = null
	respond = r
}

beforeAll(() => {
	jest.useFakeTimers()
	fake.notifications.length = 0
	reset()
})
afterAll(() => {
	fake.appHandlers['before-quit']?.()
	jest.useRealTimers()
	global.fetch = realFetch
	fs.rmSync(userData, { force: true, recursive: true })
})

describe('postProcess model fallback', () => {
	it('happy path uses the primary alone', async () => {
		// Nothing claimed before a dictation walked the chain.
		expect(states('llm')).toEqual([undefined, undefined])
		expect(await cloud.postProcess('raw', settings)).toBe('CLEANED')
		expect(calls).toEqual([PRIMARY])
		expect(states('llm')).toEqual(['active', 'standby'])
		expect(states('stt')).toEqual([undefined, undefined])
	})

	it('bounds the reply: a copy-edit by the dictation, an agent mode by a fixed budget', async () => {
		reset()
		await cloud.postProcess('raw', settings)
		expect(lastBody).toMatchObject({ max_completion_tokens: 512 })
		await cloud.postProcess('x'.repeat(1500), settings)
		expect(lastBody).toMatchObject({ max_completion_tokens: 750 })
		await cloud.postProcess('raw', { ...settings, activeModeId: 'assistant' })
		expect(lastBody).toMatchObject({ max_completion_tokens: 2048 })
	})

	it('a reply cut off by the bound → the raw transcript, never half of it', async () => {
		reset(() => ({ cut: true, status: 200 }))
		expect(await cloud.postProcess('raw', settings)).toBe('raw')
		expect(calls).toEqual([PRIMARY])
	})

	it('primary rate-limited → the same dictation is cleaned by the fallback', async () => {
		reset((m) => (m === PRIMARY ? { status: 429 } : { status: 200 }))
		expect(await cloud.postProcess('raw', settings)).toBe('CLEANED')
		expect(calls).toEqual([PRIMARY, FALLBACK])
		expect(states('llm')).toEqual(['limited', 'active'])
	})

	it('everything rate-limited → the raw transcript, notified once until a success', async () => {
		reset(() => ({ status: 429 }))
		expect(await cloud.postProcess('raw', settings)).toBe('raw')
		expect(calls).toEqual([PRIMARY, FALLBACK])
		expect(states('llm')).toEqual(['limited', 'limited'])
		expect(await cloud.postProcess('raw2', settings)).toBe('raw2')
		expect(fake.notifications).toEqual([en.notify.llmLimitBody])
		reset()
		await cloud.postProcess('raw', settings)
		reset(() => ({ status: 429 }))
		await cloud.postProcess('raw', settings)
		expect(fake.notifications).toHaveLength(2)
	})

	it('records rate-limit headers; remaining refills upward but never past the limit', async () => {
		reset()
		await cloud.postProcess('raw', settings)
		const live = stats.getStats().live[`llm:${PRIMARY}`]
		expect(live?.requests?.limit).toBe(1000)
		expect(live?.requests?.remaining).toBeGreaterThanOrEqual(985)
		expect(live?.requests?.remaining).toBeLessThanOrEqual(1000)
		expect(live?.tokens?.limit).toBe(12_000)
	})

	it('an empty transcript never reaches the LLM', async () => {
		reset()
		expect(await cloud.postProcess('', settings)).toBe('')
		expect(await cloud.postProcess('  \n ', settings)).toBe('  \n ')
		expect(calls).toEqual([])
	})

	it('primary erroring (outage) → the fallback cleans it; the primary is asked again next time', async () => {
		reset((m) => (m === PRIMARY ? { status: 500 } : { status: 200 }))
		expect(await cloud.postProcess('raw', settings)).toBe('CLEANED')
		expect(await cloud.postProcess('raw', settings)).toBe('CLEANED')
		expect(calls).toEqual([PRIMARY, FALLBACK, PRIMARY, FALLBACK])
		expect(states('llm')).toEqual(['failed', 'active'])
	})

	it('a dropped connection marks the model that was asked, pastes raw', async () => {
		fake.notifications.length = 0
		reset(() => {
			throw new Error('ECONNRESET')
		})
		expect(await cloud.postProcess('raw', settings)).toBe('raw')
		expect(calls).toEqual([PRIMARY])
		expect(states('llm')).toEqual(['failed', 'standby'])
		expect(fake.notifications).toEqual([en.notify.llmFailBody])
		reset()
		await cloud.postProcess('raw', settings) // ends the failure streak
	})

	it('a chain that failed, not just ran out, notifies the failure, never the limit', async () => {
		fake.notifications.length = 0
		reset((m) => (m === PRIMARY ? { status: 500 } : { status: 429 }))
		expect(await cloud.postProcess('raw', settings)).toBe('raw')
		expect(fake.notifications).toEqual([en.notify.llmFailBody])
		expect(states('llm')).toEqual(['failed', 'limited'])
	})

	// Retirement is remembered for the rest of the process: these run last.
	it('primary retired by Groq → the fallback cleans it; the primary is not asked again; the user is told once', async () => {
		fake.notifications.length = 0
		reset((m) =>
			m === PRIMARY
				? { code: 'model_decommissioned', status: 400 }
				: { status: 200 },
		)
		expect(await cloud.postProcess('raw', settings)).toBe('CLEANED')
		expect(await cloud.postProcess('raw', settings)).toBe('CLEANED')
		expect(calls).toEqual([PRIMARY, FALLBACK, FALLBACK])
		expect(fake.notifications).toEqual([en.notify.modelRetiredBody])
		expect(states('llm')).toEqual(['retired', 'active'])
	})

	it('a skipped retired primary still counts as a failure, never the limit', async () => {
		fake.notifications.length = 0
		reset(() => ({ status: 429 }))
		expect(await cloud.postProcess('raw', settings)).toBe('raw')
		expect(calls).toEqual([FALLBACK])
		expect(fake.notifications).toEqual([en.notify.llmFailBody])
		expect(states('llm')).toEqual(['retired', 'limited'])
	})
})

describe('transcribe model fallback', () => {
	const audio = Buffer.alloc(2000)

	it('personal preferences prime Whisper, with the selected language, greedy', async () => {
		reset()
		const send = (personalPreferences: string) =>
			cloud.requestTranscription(
				STT_PRIMARY,
				new Blob([audio], { type: 'audio/wav' }),
				{ ...settings, personalPreferences },
				'test-key',
			)
		await send(' Kubernetes, PostgreSQL ')
		const form = lastBody as FormData
		expect(form.get('prompt')).toBe('Kubernetes, PostgreSQL')
		expect(form.get('language')).toBe('sk')
		expect(form.get('temperature')).toBe('0')
		await send('  ')
		expect((lastBody as FormData).has('prompt')).toBe(false)
	})

	it('happy path uses the primary alone', async () => {
		reset()
		expect(await cloud.transcribe(audio)).toBe('SPOKEN')
		expect(calls).toEqual([STT_PRIMARY])
		expect(states('stt')).toEqual(['active', 'standby'])
	})

	it('primary rate-limited → the same recording goes to the fallback; the primary is asked again next time', async () => {
		reset((m) => (m === STT_PRIMARY ? { status: 429 } : { status: 200 }))
		expect(await cloud.transcribe(audio)).toBe('SPOKEN')
		expect(await cloud.transcribe(audio)).toBe('SPOKEN')
		expect(calls).toEqual([
			STT_PRIMARY,
			STT_FALLBACK,
			STT_PRIMARY,
			STT_FALLBACK,
		])
		expect(states('stt')).toEqual(['limited', 'active'])
	})

	it('every model refusing → the last refusal as a coded error', async () => {
		reset(() => ({ status: 429 }))
		await expect(cloud.transcribe(audio)).rejects.toThrow('quota: HTTP 429')
		expect(calls).toEqual([STT_PRIMARY, STT_FALLBACK])
	})

	// Retirement is remembered for the rest of the process: runs last.
	it('primary retired by Groq → the fallback takes the recording; the primary is not asked again', async () => {
		reset((m) =>
			m === STT_PRIMARY
				? { code: 'model_not_found', status: 404 }
				: { status: 200 },
		)
		expect(await cloud.transcribe(audio)).toBe('SPOKEN')
		expect(await cloud.transcribe(audio)).toBe('SPOKEN')
		expect(calls).toEqual([STT_PRIMARY, STT_FALLBACK, STT_FALLBACK])
	})

	it('every speech model retired → "update" error, Groq not asked again, no second notice', async () => {
		fake.notifications.length = 0
		reset(() => ({ code: 'model_decommissioned', status: 400 }))
		await expect(cloud.transcribe(audio)).rejects.toThrow('retired:')
		await expect(cloud.transcribe(audio)).rejects.toThrow('retired:')
		expect(calls).toEqual([STT_FALLBACK])
		expect(fake.notifications).toEqual([])
		expect(states('stt')).toEqual(['retired', 'retired'])
		expect(Object.hasOwn(en.errors, 'retired')).toBe(true)
	})
})
