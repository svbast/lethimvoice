import { expect, it } from 'bun:test'
import { trimSilence } from './silence'

const RATE = 16_000
const PAD = 0.15 * RATE

const clip = new Float32Array(RATE * 3)
for (let i = RATE; i < RATE * 2; i++) {
	clip[i] = Math.sin((2 * Math.PI * 200 * i) / RATE) * 0.3
}

it('trims the silence, keeps the speech, leaves ~150 ms of context on each side', () => {
	const out = trimSilence(clip, RATE)
	expect(out).not.toBeNull()
	expect(out?.length).toBeGreaterThan(RATE)
	expect(out?.length).toBeLessThan(RATE + 2 * PAD + 640)
})

it('pure silence → null, so an accidental shortcut tap never reaches Whisper', () => {
	expect(trimSilence(new Float32Array(RATE), RATE)).toBeNull()
})

it('near-silent room noise is still silence', () => {
	const hiss = new Float32Array(RATE).map(() => (Math.random() - 0.5) * 0.0008)
	expect(trimSilence(hiss, RATE)).toBeNull()
})

it('continuous speech with no pauses is not cut (loud*0.25 cap on the noise floor)', () => {
	const continuous = trimSilence(clip.subarray(RATE, RATE * 2), RATE)
	expect(continuous).not.toBeNull()
	expect(continuous?.length).toBe(RATE)
})

it('too short to analyse → returned unchanged', () => {
	const tiny = new Float32Array(100)
	expect(trimSilence(tiny, RATE)).toBe(tiny)
})
