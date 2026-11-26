// Live check against Groq, skipped unless LIVE_GROQ_KEY is set: runs daily in
// .github/workflows/groq-models.yml. Every shipped model gets the exact request a
// dictation sends, and Groq's deprecation list is read, so a shutdown reaches us when
// Groq announces it (2–8 weeks ahead), not when users' dictations start failing.
import { describe, expect, it } from 'bun:test'
import { silentWav } from '../runtime/servers'
import type { Settings } from '../store/settings'
import { requestCompletion, requestTranscription, STT_MODELS } from './cloud'
import { POST_PROCESS_MODELS, preparePostProcess } from './prompts'

const key = process.env.LIVE_GROQ_KEY ?? ''
const settings = { activeModeId: 'clean', language: 'en' } as Settings

// A failed reply shows up in the diff as Groq's own error text.
const refusal = async (res: Response) =>
	res.ok ? '' : `HTTP ${res.status} ${await res.text()}`

describe.skipIf(!key)('Groq serves every shipped model', () => {
	for (const model of STT_MODELS) {
		it(`${model} transcribes`, async () => {
			const audio = new Blob([silentWav()], { type: 'audio/wav' })
			const res = await requestTranscription(model, audio, settings, key)
			expect(await refusal(res)).toBe('')
		})
	}

	const prep = preparePostProcess('Hello, this is a dictation test.', settings)
	for (const model of POST_PROCESS_MODELS) {
		it(`${model} cleans up a dictation`, async () => {
			if (!prep) throw new Error('Clean mode prepared no request')
			const res = await requestCompletion(model, prep, key)
			expect(await refusal(res)).toBe('')
			const json = (await res.json()) as {
				choices?: Array<{
					finish_reason?: string
					message?: { content?: string }
				}>
			}
			expect(json.choices?.[0]?.message?.content?.trim()).toBeTruthy()
			// Reasoning counts toward the bound: a cut reply would paste raw.
			expect(json.choices?.[0]?.finish_reason).toBe('stop')
		})
	}

	it('Groq has announced no shutdown for a shipped model', async () => {
		const res = await fetch('https://console.groq.com/docs/deprecations.md')
		expect(await refusal(res)).toBe('')
		// Each announcement is a table: | deprecated model | shutdown | replacement |
		const shutdowns = new Map<string, string>()
		for (const line of (await res.text()).split('\n')) {
			if (!line.startsWith('|')) continue
			const [id = '', ...rest] = line
				.split('|')
				.slice(1, -1)
				.map((cell) => cell.replaceAll('`', '').trim())
			shutdowns.set(id, rest.join(' → '))
		}
		// A known past shutdown proves the rows still parse: a reshaped page fails
		// here, never passes by reading nothing.
		expect(shutdowns.has('llama-3.3-70b-versatile')).toBe(true)
		const announced = [...STT_MODELS, ...POST_PROCESS_MODELS]
			.filter((m) => shutdowns.has(m))
			.map((m) => `${m}: ${shutdowns.get(m)}`)
		expect(announced).toEqual([])
	})
})
