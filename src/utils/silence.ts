// Leading/trailing silence trim for push-to-talk recordings.
//
// Why this exists: Whisper does not return an empty string for a silent stretch,
// it returns memorised subtitle boilerplate ("Thank you for watching."). Push-to-
// talk guarantees such a stretch on both ends — a few hundred ms pass between
// pressing the key and the first word, and again between the last word and the
// human releasing the key. Cutting those before upload removes the trigger at
// the source; pipeline/hallucination.ts is the second net for whatever slips through.
//
// Pure math on a Float32Array — no browser APIs — so it runs under plain node
// (see silence.test.ts) as well as in the renderer.

const FRAME = 320 // 20 ms @ 16 kHz — short enough to land between words
const PAD_SEC = 0.15 // keep 150 ms around speech: cutting a plosive onset
// ("k", "p", "t") costs more accuracy than the silence does
const ABS_FLOOR = 0.0015 // ≈ -56 dBFS. Absolute gate so a recording made in a
// dead-silent room doesn't have its own noise floor
// scaled up into "speech".

// Returns a subarray of `samples` with the silence at both ends removed, or
// `null` when the whole recording is silence (caller should not transcribe at
// all). Anything too short to analyse is returned unchanged.
export function trimSilence(
	samples: Float32Array,
	sampleRate = 16_000,
): Float32Array | null {
	const frames = Math.floor(samples.length / FRAME)
	if (frames < 3) return samples

	const rms = new Float32Array(frames)
	for (let f = 0; f < frames; f++) {
		const start = f * FRAME
		let sum = 0
		for (let i = start; i < start + FRAME; i++) {
			const s = samples[i] ?? 0
			sum += s * s
		}
		rms[f] = Math.sqrt(sum / FRAME)
	}

	// Percentiles rather than min/mean/max: robust both to how much of the clip is
	// speech and to a single click or dropout. Float32Array.sort() is numeric.
	const sorted = Float32Array.from(rms).sort()
	const noise = sorted[Math.floor(frames * 0.1)] ?? 0 // quiet end → the room
	const loud = sorted[Math.floor(frames * 0.9)] ?? 0 // loud end  → the voice
	if (loud < ABS_FLOOR) return null // no voice anywhere: pure silence

	// Capping at a quarter of the speech level matters when the user talks
	// continuously with no pauses: `noise` then sits at speech level and the raw
	// noise*4 gate would cut the entire recording. Real pauses are far below 25 %
	// of speech RMS, so the cap never weakens the trim on normal dictation.
	const threshold = Math.min(Math.max(noise * 4, ABS_FLOOR), loud * 0.25)

	let first = 0
	while ((rms[first] ?? threshold) < threshold) first++ // `loud` > threshold guarantees a hit

	let last = frames - 1
	while (last > first && (rms[last] ?? threshold) < threshold) last--

	const pad = Math.round((PAD_SEC * sampleRate) / FRAME)
	const from = Math.max(0, first - pad) * FRAME
	const to = Math.min(frames, last + 1 + pad) * FRAME
	return samples.subarray(from, to)
}
