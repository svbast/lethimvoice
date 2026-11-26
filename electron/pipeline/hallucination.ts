// Whisper can decode silence around speech as memorized subtitle closings.
// verbose_json confidence fields reject those segments; missing fields = "keep":
// Groq sends all three, whisper.cpp only avg_logprob + a ~0 no_speech_prob.

// Reference-decoder thresholds (OpenAI whisper: no_speech_threshold 0.6,
// compression_ratio_threshold 2.4). logprob tightened from reference -1.0 to
// -0.4: subtitle boilerplate decodes fluently, sails past the looser bar. Both
// conditions must hold to drop a segment; quiet-but-real speech stays safe.
const NO_SPEECH_PROB = 0.6
const AVG_LOGPROB = -0.4
const COMPRESSION_RATIO = 2.4

interface Segment {
	text?: string
	no_speech_prob?: number
	avg_logprob?: number
	compression_ratio?: number
}

interface VerboseJson {
	text?: string
	segments?: Segment[]
}

const num = (v: unknown) => (typeof v === 'number' ? v : 0)

const isHallucinated = (seg: Segment) =>
	// silence → memorised subtitle boilerplate
	(num(seg.no_speech_prob) > NO_SPEECH_PROB &&
		num(seg.avg_logprob) < AVG_LOGPROB) ||
	// greedy decode stuck in a loop → repeated words/phrases
	num(seg.compression_ratio) > COMPRESSION_RATIO

// With segments: rebuild from survivors only; json.text fallback when all are
// rejected would paste boilerplate from a silent recording. No segments:
// nothing to judge, preserve json.text.
export const filterHallucinations = (json: unknown) => {
	const j = json as VerboseJson | null
	const full = j && typeof j.text === 'string' ? j.text.trim() : ''
	const segments = j && Array.isArray(j.segments) ? j.segments : null
	if (!segments || segments.length === 0) return full

	const kept: string[] = []
	const dropped: string[] = []
	for (const s of segments) {
		if (!s) continue
		;(isHallucinated(s) ? dropped : kept).push(String(s.text || '').trim())
	}
	if (dropped.length === 0) return full
	return kept.filter(Boolean).join(' ').trim()
}
