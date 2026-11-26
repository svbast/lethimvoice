import { describe, expect, it } from 'bun:test'
import { betterSpeechModel, type Machine, recommend } from './recommend'

const pc = (nvidiaVramGb: number | null, ramGb = 16): Machine => ({
	nvidiaVramGb,
	platform: 'win',
	ramGb,
})

describe('recommend', () => {
	it.each([
		// machine, language → what the setup installs
		[
			pc(8),
			'sk',
			{ grade: 'good', llm: 'gemma-4-e2b', stt: 'large-v3-turbo-q5_0' },
		],
		[pc(8), 'cs', { grade: 'good', llm: 'gemma-4-e2b', stt: 'large-v3' }],
		[pc(8), 'uk', { grade: 'good', llm: 'gemma-4-e2b', stt: 'large-v3' }],
		[
			pc(6),
			'cs',
			{ grade: 'good', llm: 'gemma-4-e2b', stt: 'large-v3-turbo-q5_0' },
		],
		[pc(4), 'pl', { grade: 'good', llm: null, stt: 'large-v3-turbo-q5_0' }],
		[pc(12, 4), 'en', { grade: 'good', llm: null, stt: 'large-v3-turbo-q5_0' }],
		[pc(null), 'sk', { grade: 'slow', llm: null, stt: 'large-v3-turbo-q5_0' }],
		[pc(null), 'en', { grade: 'good', llm: null, stt: 'base' }],
	] as const)('%o %s → %o', (machine, language, expected) => {
		expect(recommend(machine, language)).toMatchObject(expected)
	})

	it('says why cleanup is off', () => {
		expect(recommend(pc(4), 'sk').llmReason).toBe('memory')
		expect(recommend(pc(null), 'sk').llmReason).toBe('cpu')
		expect(recommend(pc(null, 4), 'sk').llmReason).toBe('memory')
	})

	it('offers nothing on macOS: no local speech engine there', () => {
		expect(recommend({ ...pc(null), platform: 'mac' }, 'sk')).toEqual({
			grade: 'unsupported',
			llm: null,
			stt: null,
		})
	})

	it('suggests a better speech model when English-only base meets another language', () => {
		const cpu = recommend(pc(null), 'sk')
		expect(betterSpeechModel('base', 'sk', cpu)).toBe('large-v3-turbo-q5_0')
		// English, a multilingual model, or nothing better to offer: no hint
		expect(
			betterSpeechModel('base', 'en', recommend(pc(null), 'en')),
		).toBeNull()
		expect(betterSpeechModel('large-v3-turbo-q5_0', 'sk', cpu)).toBeNull()
		expect(
			betterSpeechModel(
				'base',
				'sk',
				recommend({ ...pc(null), platform: 'mac' }, 'sk'),
			),
		).toBeNull()
		expect(betterSpeechModel(undefined, 'sk', cpu)).toBeNull()
	})
})
