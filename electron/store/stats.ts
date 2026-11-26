import path from 'node:path'
import { app } from 'electron'
import { type ChatReply, POST_PROCESS_MODELS } from '../pipeline/prompts'
import { dayKey } from '../utils/day'
import { readJson, writeJson } from '../utils/jsonFile'

// Groq free-tier daily limits, console.groq.com/docs/rate-limits (2026-10):
//   whisper-large-v3:     7 200 audio-sec/hour, 28 800 audio-sec/day, 2 000 req/day
//   whisper-large-v3-turbo: same, own budget; STT backup, 'stt' bars show whichever
//                         model answered last
//   openai/gpt-oss-120b:  8 000 tok/min, 200 000 tok/day, 1 000 req/day
//   qwen/qwen3.8-27b:     8 000 tok/min, 200 000 tok/day, 1 000 req/day
//
// LLM limits PER MODEL: post-processing falls back to a second model when the first
// is rate-limited or fails; budgets separate. Combined bar meaningless: same token
// count, different ceiling per spending model.
//
// NOTE budgets do NOT reset at midnight. Groq refills continuously at
// limit ÷ 1440 per minute; "used today" approximates a rolling window — enough
// for a bar, never a fallback basis (pipeline/cloud.ts chains on Groq's reply).
// Every model of the cleanup chain has the same limits.
const GROQ_LIMITS = {
	llm: Object.fromEntries(
		POST_PROCESS_MODELS.map((model) => [
			model,
			{ reqPerDay: 1000, tokPerDay: 200_000 },
		]),
	),
	sttAudioSecPerDay: 28_800,
	sttReqPerDay: 2000,
}

const SAVE_DEBOUNCE_MS = 2000

type DayRecord = Record<string, number>

type LimitKind = 'requests' | 'tokens' | 'audio-seconds'
interface LimitSnapshot {
	limit: number
	remaining: number
	resetMs: number
}
type LiveSnapshot = { at: number } & Partial<Record<LimitKind, LimitSnapshot>>

interface StatsData {
	days: Record<string, DayRecord>
	live?: Record<string, LiveSnapshot>
}

let _data: StatsData | null = null
let _saveTimer: NodeJS.Timeout | null = null

const statsPath = () => path.join(app.getPath('userData'), 'stats.json')

const load = (): StatsData => {
	if (_data) return _data
	const parsed = readJson(statsPath()) as StatsData | null | undefined
	_data =
		parsed && typeof parsed.days === 'object' && parsed.days
			? parsed
			: { days: {} }
	return _data
}

// Never throws: from the timer or before-quit nothing would catch it, so Electron
// shows its error dialog, and the quit handlers after this one do not run.
const save = () => {
	_saveTimer = null
	try {
		writeJson(statsPath(), _data)
	} catch {
		/* disk full or file held by another program: the next save writes it all */
	}
}

const scheduleSave = () => {
	if (_saveTimer) clearTimeout(_saveTimer)
	_saveTimer = setTimeout(save, SAVE_DEBOUNCE_MS)
}

const bump = (fields: Record<string, number>) => {
	const days = load().days
	const key = dayKey(new Date())
	let day = days[key]
	if (!day) {
		day = {}
		days[key] = day
	}
	for (const [k, v] of Object.entries(fields)) {
		if (v) day[k] = (day[k] || 0) + v
	}
	scheduleSave()
}

// Recorded duration = what Groq bills against ASD limit when STT ran on cloud.
export const recordRecording = ({
	durationMs,
	cloudStt,
}: {
	durationMs?: unknown
	cloudStt?: boolean
}) => {
	const ms = Number(durationMs) > 0 ? Math.round(Number(durationMs)) : 0
	bump({
		cloudSttReq: cloudStt ? 1 : 0,
		cloudSttSec: cloudStt ? Math.ceil(ms / 1000) : 0,
		ms,
		n: 1,
	})
}

export const recordLlm = (
	provider: string,
	usage?: ChatReply['usage'] | null,
	model?: string,
) => {
	const inTok = (usage && Number(usage.prompt_tokens)) || 0
	const outTok = (usage && Number(usage.completion_tokens)) || 0
	if (provider === 'cloud') {
		bump({ cloudLlmIn: inTok, cloudLlmOut: outTok })
		if (model) {
			// Per-model day keys, prefixed: never collide with fixed field names the
			// Statistics tab aggregates; readable in stats.json.
			bump({ [`llm:${model}:tok`]: inTok + outTok, [`llm:${model}:req`]: 1 })
		}
	} else {
		bump({ localLlmIn: inTok, localLlmOut: outTok })
	}
}

// Groq reports remaining quota on EVERY response: costs nothing, strictly better
// than local counting — reflects the KEY, not the app. Requests the app never made
// (another tool on same key, a crashed run) are invisible locally, present here.
//
// Header coverage (docs + verified against live responses):
//   x-ratelimit-*-requests        requests per DAY   (both endpoints)
//   x-ratelimit-*-tokens          tokens per MINUTE  (chat only)
//   x-ratelimit-*-audio-seconds   audio seconds per HOUR (transcription only)
// No header for tokens per day — approximated by the per-model day counter
// `llm:<model>:tok` that recordLlm writes (StatsTab reads it).
//
// `reset` stored so a stale snapshot carries forward exactly instead of guessed:
// Groq refills continuously, `used` drains to zero in exactly `reset`, so refill
// rate is used/reset, no hardcoded window.
const LIMIT_KINDS: LimitKind[] = ['requests', 'tokens', 'audio-seconds']

// Only `get` used: fetch Headers and test stub both fit.
type HeadersLike = Pick<Headers, 'get'>

const readLimits = (headers: HeadersLike) => {
	const out: Partial<Record<LimitKind, LimitSnapshot>> = {}
	for (const kind of LIMIT_KINDS) {
		const limit = Number(headers.get(`x-ratelimit-limit-${kind}`))
		const remaining = Number(headers.get(`x-ratelimit-remaining-${kind}`))
		if (!(Number.isFinite(limit) && Number.isFinite(remaining)) || limit <= 0)
			continue
		out[kind] = {
			limit,
			remaining,
			resetMs: parseDuration(headers.get(`x-ratelimit-reset-${kind}`)),
		}
	}
	return out
}

// Groq writes durations as concatenated units: "500ms", "43.2s", "2m52.8s".
// Try `ms` before `m` or "500ms" parses as 500 minutes.
const UNIT_MS: Record<string, number> = {
	h: 3_600_000,
	m: 60_000,
	ms: 1,
	s: 1000,
}
export const parseDuration = (value: unknown) => {
	let total = 0
	for (const m of String(value ?? '').matchAll(/([\d.]+)(ms|h|m|s)/gu))
		total += Number(m[1]) * (UNIT_MS[m[2] as string] ?? 0)
	return total
}

// Store newest snapshot per API surface ('stt' or 'llm:<model>'). Persisted so the
// Statistics tab shows real numbers at launch, not blanks until first dictation.
export const recordLimits = (key: string, headers: HeadersLike) => {
	const parsed = readLimits(headers)
	if (Object.keys(parsed).length === 0) return
	const d = load()
	if (!d.live || typeof d.live !== 'object') d.live = {}
	d.live[key] = { at: Date.now(), ...parsed }
	scheduleSave()
}

// `live` carries header snapshots forward to now: renderer gets a drawable number
// and never needs to know how Groq refills. `used` drains to zero in exactly
// `resetMs`; refill rate used/resetMs, no window constant anywhere.
export const getStats = () => {
	const d = load()
	const now = Date.now()
	interface LiveLimit {
		limit: number
		remaining: number
	}
	const live: Record<string, Partial<Record<LimitKind, LiveLimit>>> = {}
	for (const [key, snap] of Object.entries(d.live || {})) {
		const elapsed = now - (snap.at || 0)
		const out: Partial<Record<LimitKind, LiveLimit>> = {}
		for (const kind of LIMIT_KINDS) {
			const s = snap[kind]
			if (!s) continue
			const used = s.limit - s.remaining
			const refilled = s.resetMs > 0 ? (used * elapsed) / s.resetMs : used
			out[kind] = {
				limit: s.limit,
				remaining: Math.min(s.limit, s.remaining + refilled),
			}
		}
		live[key] = out
	}
	return { days: d.days, limits: GROQ_LIMITS, live }
}

// Flush pending debounced write on quit: last dictations not lost.
app.on('before-quit', () => {
	if (_saveTimer) {
		clearTimeout(_saveTimer)
		save()
	}
})
