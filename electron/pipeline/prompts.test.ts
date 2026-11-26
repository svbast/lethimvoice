import { describe, expect, it } from 'bun:test'
import type { Settings } from '../store/settings'
import { BUILTIN_MODES, filterOutput, preparePostProcess } from './prompts'

// `$&` and `$1` would be expanded by a string replace(): user text must stay verbatim.
const VOCAB = 'Kubernetes, PostgreSQL, Mária $& $1'
const BLOCK = `<CUSTOM_VOCABULARY>\n${VOCAB}\n</CUSTOM_VOCABULARY>`
const sk = (patch: Partial<Settings>) =>
	({ activeModeId: 'clean', language: 'sk', ...patch }) as Settings

describe('personal preferences', () => {
	it('reach every mode that calls the LLM, verbatim, as reference material', () => {
		for (const mode of BUILTIN_MODES) {
			const prep = preparePostProcess(
				'text',
				sk({ activeModeId: mode.id, personalPreferences: `  ${VOCAB}\n` }),
			)
			if (mode.kind === 'raw') expect(prep).toBeNull()
			else expect(prep?.systemPrompt).toContain(BLOCK)
		}
	})

	it('reach an own mode too; empty or blank ones add no block in any mode', () => {
		const modes = [{ id: 'mine', promptText: 'Summarize.', title: 'Mine' }]
		const own = sk({ activeModeId: 'mine', modes, personalPreferences: VOCAB })
		expect(preparePostProcess('text', own)?.systemPrompt).toContain(BLOCK)
		for (const { id } of [...BUILTIN_MODES, { id: 'mine' }])
			for (const personalPreferences of ['', '  \n '])
				expect(
					preparePostProcess(
						'text',
						sk({ activeModeId: id, modes, personalPreferences }),
					)?.systemPrompt ?? '',
				).not.toContain('# Custom Vocabulary')
	})
})

describe('filterOutput', () => {
	it.each([
		['Hello.', 'Hello.'],
		['<think>plan</think>Hello.', 'Hello.'],
		['<thinking>a\nb</thinking>\nHello.', 'Hello.'],
		['Hello.<reasoning>x</reasoning> World.', 'Hello. World.'],
		// cut off by max_tokens: no closing tag
		['Hello.<think>still reasoning', 'Hello.'],
		// template opened <think> in the prompt: only the closing tag comes back
		['reasoning here</think>Hello.', 'Hello.'],
		// Gemma 4's own thought channel
		['<|channel>thought\nplan it<channel|>Hello.', 'Hello.'],
		['<|channel>thought\nstill going', 'RAW'],
		['plan it<channel|>Hello.', 'Hello.'],
	])('%j → %j', (raw, clean) => {
		expect(filterOutput(raw, 'RAW')).toBe(clean)
	})

	it('falls back when nothing but reasoning is left', () => {
		expect(filterOutput('<think>only this', 'RAW')).toBe('RAW')
		expect(filterOutput('   ', 'RAW')).toBe('RAW')
	})
})
