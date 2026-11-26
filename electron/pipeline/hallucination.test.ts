import { expect, it } from 'bun:test'
import { filterHallucinations } from './hallucination'

const speech = {
	avg_logprob: -0.21,
	compression_ratio: 1.3,
	no_speech_prob: 0.02,
	text: ' I want to check it. ',
}
const silence = {
	avg_logprob: -0.72,
	compression_ratio: 1.1,
	no_speech_prob: 0.93,
	text: ' Thank you for watching. ',
}
const loop = {
	avg_logprob: -0.3,
	compression_ratio: 3.1,
	no_speech_prob: 0.05,
	text: ' ne ne ne ne ne ne ',
}

it('drops a trailing silence hallucination', () => {
	expect(
		filterHallucinations({
			segments: [speech, silence],
			text: 'I want to check it. Thank you for watching.',
		}),
	).toBe('I want to check it.')
})

it('drops a repetition loop', () => {
	expect(filterHallucinations({ segments: [speech, loop], text: 'x' })).toBe(
		'I want to check it.',
	)
})

it('passes clean audio through byte-identical (no re-joining of segments)', () => {
	expect(
		filterHallucinations({ segments: [speech], text: 'I want  to check it.' }),
	).toBe('I want  to check it.')
})

it('leaves text without segments untouched (plain json / older whisper.cpp)', () => {
	expect(filterHallucinations({ text: ' hello ' })).toBe('hello')
})

it('keeps everything when confidence fields are missing', () => {
	expect(
		filterHallucinations({
			segments: [{ text: 'a' }, { text: 'b' }],
			text: 'a b',
		}),
	).toBe('a b')
})

it('shortcut tapped, nothing said → paste nothing, not Whisper’s stand-in for silence', () => {
	expect(
		filterHallucinations({
			segments: [silence],
			text: 'Thank you for watching.',
		}),
	).toBe('')
	expect(filterHallucinations({ segments: [loop], text: 'ne ne ne' })).toBe('')
})
