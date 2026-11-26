// Audio conversion + silence trim, on the way from MediaRecorder to whichever
// engine transcribes. whisper.cpp needs 16 kHz mono 16-bit PCM WAV and the
// recorder produces webm/opus, so we decode + resample in the renderer with the
// Web Audio API (no ffmpeg to bundle) and hand a WAV buffer to the main process.
//
// Both backends go through here: decoding is what makes the silence trim possible,
// and the silence at the ends of a push-to-talk clip is what makes Whisper
// hallucinate subtitle boilerplate (see silence.ts).
// The cost is payload — 16 kHz mono PCM is ~32 kB/s against opus@32 kbps's 4 kB/s,
// so a 5 s dictation uploads ~160 kB instead of ~20 kB. On any normal connection
// that is well under 100 ms, and the trim gives part of it back.
// Known limit: plain PCM upload; only worth revisiting if slow-uplink users complain
// (would need a WASM opus/flac encoder to keep the trim AND the small payload).

import { trimSilence } from './silence'

const WHISPER_SAMPLE_RATE = 16_000 // whisper.cpp native rate

// Encode a mono Float32 sample array as a 16-bit PCM WAV (44-byte header + data).
function encodeWav16BitPCM(
	samples: Float32Array,
	sampleRate = WHISPER_SAMPLE_RATE,
): ArrayBuffer {
	const numChannels = 1
	const bytesPerSample = 2
	const blockAlign = numChannels * bytesPerSample
	const byteRate = sampleRate * blockAlign
	const dataSize = samples.length * bytesPerSample

	const buffer = new ArrayBuffer(44 + dataSize)
	const view = new DataView(buffer)
	let o = 0
	const writeStr = (s: string): void => {
		for (let i = 0; i < s.length; i++) view.setUint8(o++, s.charCodeAt(i))
	}
	const writeU32 = (v: number): void => {
		view.setUint32(o, v, true)
		o += 4
	}
	const writeU16 = (v: number): void => {
		view.setUint16(o, v, true)
		o += 2
	}

	// RIFF header
	writeStr('RIFF')
	writeU32(36 + dataSize)
	writeStr('WAVE')
	// fmt chunk (PCM)
	writeStr('fmt ')
	writeU32(16)
	writeU16(1)
	writeU16(numChannels)
	writeU32(sampleRate)
	writeU32(byteRate)
	writeU16(blockAlign)
	writeU16(16)
	// data chunk
	writeStr('data')
	writeU32(dataSize)
	// samples: clamp float [-1,1] → signed 16-bit
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i] ?? 0))
		view.setInt16(o, s < 0 ? s * 0x80_00 : s * 0x7f_ff, true)
		o += 2
	}
	return buffer
}

// Decode a recorded audio Blob (webm/opus etc.), cut the silence off both ends
// and return a 16 kHz mono 16-bit WAV ArrayBuffer — or `null` when the clip
// turned out to be silence only, in which case the caller must not transcribe at
// all. Uses AudioContext.decodeAudioData to decode and an OfflineAudioContext to
// resample + downmix to mono. Browser-only.
export async function blobToWav16kMono(
	blob: Blob,
): Promise<ArrayBuffer | null> {
	const arrayBuffer = await blob.arrayBuffer()

	const decodeCtx = new AudioContext()
	let decoded: AudioBuffer
	try {
		// slice(0) → decodeAudioData detaches the buffer; keep the original intact.
		decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0))
	} finally {
		decodeCtx.close()
	}

	const length = Math.max(1, Math.ceil(decoded.duration * WHISPER_SAMPLE_RATE))
	const offline = new OfflineAudioContext(1, length, WHISPER_SAMPLE_RATE)
	const source = offline.createBufferSource()
	source.buffer = decoded
	source.connect(offline.destination) // multi-channel → mono downmix per spec
	source.start(0)
	const rendered = await offline.startRendering()

	const speech = trimSilence(rendered.getChannelData(0), WHISPER_SAMPLE_RATE)
	if (!speech) return null // pure silence — nothing to transcribe
	return encodeWav16BitPCM(speech, WHISPER_SAMPLE_RATE)
}
