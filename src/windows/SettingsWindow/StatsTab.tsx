import { Fragment, useEffect, useState } from 'react'
import { dayKey } from '../../../electron/utils/day'
import Hero from '../../components/Hero'
import PixelIcon, { type IconName } from '../../components/PixelIcon'
import { getLocale, type Key, useT } from '../../i18n'
import { fmtDur } from './HistoryData'

type StatsData = Awaited<ReturnType<Window['electron']['getStats']>>
type Days = StatsData['days']
type LiveLimit = NonNullable<StatsData['live'][string]['requests']>
interface Aggregate {
	n: number
	ms: number
	cloudSttSec: number
	cloudSttReq: number
	cloudLlmIn: number
	cloudLlmOut: number
	localLlmIn: number
	localLlmOut: number
}
interface Total extends Aggregate {
	/** Typing time the dictation saved, ms. */
	saved: number
}
interface HeatmapCell {
	key: string
	ms: number
	n: number
	level: number
}
interface Heatmap {
	cells: Array<HeatmapCell | null>
	months: Array<{ col: number; key: string }>
}
interface Bar {
	key: string
	ms: number
	n: number
	pct?: number
}
interface BarChart {
	bars: Bar[]
	max: number
}
interface LimitRowProps {
	label: string
	/** This app's own count for today, shown until Groq's headers arrive. */
	used: number
	max?: number
	/** Groq's own snapshot from its response headers, when one exists. */
	live?: LiveLimit
	fmt: (value: number) => string
}

// Time saved is an estimate. Dictation is about 3–4× faster than typing
// (speaking ≈150 wpm, typing ≈40 wpm), so typing the same words is taken to last
// 3.5× the spoken time. Keep the "3–4×" wording in locales/*.json
// (stats.saved.note, stats.heroDesc) in sync with this factor.
const TYPING_FACTOR = 3.5

// One heatmap week column: a 9 px cell plus the 3 px gap (.heat in theme.css).
const COL_PX = 12

// The "At a glance" rows; each formats one period's total.
const ROWS: Array<{
	cls: string
	icon: IconName
	label: Key
	value: (a: Total) => string
}> = [
	{
		cls: 'st-v st-v1',
		icon: 'zap',
		label: 'stats.row.saved',
		value: (a) => fmtDur(a.saved),
	},
	{
		cls: 'st-v st-v2',
		icon: 'mic',
		label: 'stats.row.spoken',
		value: (a) => fmtDur(a.ms),
	},
	{
		cls: 'st-v st-v3',
		icon: 'record',
		label: 'stats.row.recordings',
		value: (a) => num(a.n),
	},
	{
		cls: 'st-v st-v3',
		icon: 'coin',
		label: 'stats.row.tokens',
		value: (a) => fmtTok(tok(a)),
	},
]

// Statistics tab — visualizes the per-day usage aggregates from electron/store/stats.ts:
// time saved per period, a GitHub-style activity heatmap (12 months), a 30-day bar
// chart and today's Groq free-tier usage. All charts are plain CSS — no chart library.
export default function StatsTab(): React.ReactElement {
	const t = useT()
	const locale = getLocale() // for Intl-formatted axis labels (month / weekday / date)
	const [data, setData] = useState<StatsData | null>(null)

	useEffect(() => {
		window.electron
			.getStats()
			.then(setData)
			.catch(() => {
				// stats unavailable (main process not answering) — panels stay empty
			})
	}, [])

	const days = data?.days || {}
	const limits = data?.limits
	// Remaining quota read from Groq's response headers, already carried forward to
	// now by the main process.
	const live = data?.live || {}

	// A period is the days whose key starts with that much of today's "YYYY-MM-DD":
	// all of it matches today alone, none of it matches every day.
	const todayKey = dayKey(new Date())
	const today = total(days, todayKey)
	const all = total(days, '')
	const cols: Array<[Key, Total]> = [
		['common.today', today],
		['stats.thisMonth', total(days, todayKey.slice(0, 7))],
		['stats.thisYear', total(days, todayKey.slice(0, 4))],
		['stats.allTime', all],
	]
	// Per-model keys ("llm:<model>:tok") are dynamic, so they are not in FIELDS and
	// total() does not sum them. The limit rows only need today anyway.
	const todayRaw = days[todayKey] || {}
	const hasData = all.n > 0
	const heatmap = buildHeatmap(days)
	const chart = buildBars(days, 30)

	return (
		<>
			<Hero
				anim='charts'
				badge={t('stats.heroBadge', { n: today.n })}
				desc={t('stats.heroDesc')}
				plate={{
					kind: 'value',
					label: t('stats.allTime'),
					value: fmtDur(all.saved),
				}}
				title={t('stats.hero', { d: fmtDur(today.saved) })}
				tone={today.n > 0 ? 'live' : 'muted'}
			/>

			{/* ── At a glance: one aligned table, a column per period ── */}
			<section className='stack gap-3'>
				<div className='hstack between gap-4'>
					<h2 className='section-title stats-title'>{t('stats.glance')}</h2>
					<span className='text-xs muted'>{t('stats.saved.note')}</span>
				</div>
				<div className='card st-sum'>
					<div className='st-grid'>
						<span />
						{cols.map(([label]) => (
							<span className='st-h' key={label}>
								{t(label)}
							</span>
						))}
						{ROWS.map((row) => (
							<Fragment key={row.label}>
								<span className='st-label'>
									<PixelIcon className='pxi-sm' name={row.icon} />
									{t(row.label)}
								</span>
								{cols.map(([label, a]) => (
									<span className={row.cls} key={label}>
										{row.value(a)}
									</span>
								))}
							</Fragment>
						))}
					</div>
					<p className='st-foot text-xs muted'>
						{t('stats.foot', {
							avg: fmtDur(all.n ? all.ms / all.n : 0),
							cloud: fmtTok(all.cloudLlmIn + all.cloudLlmOut),
							local: fmtTok(all.localLlmIn + all.localLlmOut),
						})}
					</p>
				</div>
			</section>

			{/* ── Activity heatmap (last 12 months): Y = weekday, X = month ── */}
			<section className='card card-pad stack gap-3'>
				<h2 className='card-title'>{t('stats.activity')}</h2>
				{hasData ? (
					<div className='stack gap-2'>
						<div className='text-xs muted stats-months'>
							{heatmap.months.map((m) => (
								<span key={m.col} style={{ left: m.col * COL_PX }}>
									{monthShort(m.key, locale)}
								</span>
							))}
						</div>
						<div className='hstack gap-2 stats-heat-row'>
							<div className='stack text-xs muted stats-days'>
								{[0, 1, 2, 3, 4, 5, 6].map((r) => (
									<span key={r}>
										{r % 2 === 0 && r < 6 ? weekdayShort(r, locale) : ''}
									</span>
								))}
							</div>
							<div className='stats-heat'>
								<span aria-hidden='true' className='scan' />
								<div
									aria-label={t('stats.heatLabel')}
									className='heat'
									role='img'
								>
									{/* biome-ignore-start lint/suspicious/noArrayIndexKey: leading padding cells hold no data; the grid offset is fixed for a render */}
									{heatmap.cells.map((cell, i) =>
										cell ? (
											<span
												className={
													cell.level ? `cell cell-${cell.level}` : 'cell'
												}
												key={cell.key}
												title={`${cell.key} · ${cell.n} · ${fmtDur(cell.ms)}`}
											/>
										) : (
											<span className='cell cell-pad' key={i} />
										),
									)}
									{/* biome-ignore-end lint/suspicious/noArrayIndexKey: padding cells only */}
								</div>
							</div>
						</div>
						<div className='hstack gap-1 text-xs muted stats-legend'>
							<span className='stats-less'>{t('stats.less')}</span>
							{[0, 1, 2, 3, 4].map((l) => (
								<span className={l ? `cell cell-${l}` : 'cell'} key={l} />
							))}
							<span className='stats-more'>{t('stats.more')}</span>
						</div>
					</div>
				) : (
					<p className='desc'>{t('stats.noData')}</p>
				)}
			</section>

			{/* ── Last 30 days bar chart: Y = duration, X = date ── */}
			{hasData && (
				<section className='card card-pad stack gap-3'>
					<h2 className='card-title'>{t('stats.last30')}</h2>
					<div className='hstack gap-3 stats-chart'>
						<div className='stack between text-xs muted tabular stats-y'>
							<span>{fmtDur(chart.max)}</span>
							<span>0s</span>
						</div>
						<div className='stack gap-2 grow'>
							<div
								aria-label={t('stats.barsLabel')}
								className='bars'
								role='img'
							>
								{chart.bars.map((b) => (
									<span
										className={b.ms > 0 ? 'bar' : 'bar bar-empty'}
										key={b.key}
										style={{ height: `${b.pct}%` }}
										title={`${b.key} · ${b.n} · ${fmtDur(b.ms)}`}
									/>
								))}
							</div>
							<div className='hstack between text-xs muted'>
								<span>
									{chart.bars[0] ? shortDate(chart.bars[0].key, locale) : ''}
								</span>
								<span>{t('common.today')}</span>
							</div>
						</div>
					</div>
				</section>
			)}

			{/* ── Today's Groq free-tier usage ── */}
			<section className='card card-pad stack gap-3'>
				<div className='row-text'>
					<h2 className='card-title'>{t('stats.limit.title')}</h2>
					<p className='card-desc'>{t('stats.limit.note')}</p>
				</div>
				<div className='lim-grid'>
					{/* Rows backed by Groq's own response headers are marked live; tokens per
					    day, which Groq sends no header for, is marked as an estimate. Only a
					    measured number is the key's true state and can be acted on, so the
					    two never look alike. */}
					<LimitRow
						fmt={(v: number) => fmtDur(v * 1000)}
						label={t('stats.limit.sttAudio')}
						live={live.stt?.['audio-seconds']}
						max={limits?.sttAudioSecPerDay}
						used={today.cloudSttSec}
					/>
					<LimitRow
						fmt={num}
						label={t('stats.limit.sttRequests')}
						live={live.stt?.requests}
						max={limits?.sttReqPerDay}
						used={today.cloudSttReq}
					/>

					{/* One pair of rows per LLM model: the post-processing step falls back to a
					    second model when Groq rate-limits the first, and their daily budgets are
					    separate — a combined row would hold one model's spend against another
					    model's ceiling. */}
					{Object.entries(limits?.llm || {}).map(([model, lim]) => (
						<Fragment key={model}>
							<LimitRow
								fmt={fmtTok}
								label={t('stats.limit.llmTok', { m: shortModel(model) })}
								max={lim.tokPerDay}
								used={todayRaw[`llm:${model}:tok`] || 0}
							/>
							<LimitRow
								fmt={num}
								label={t('stats.limit.llmReq', { m: shortModel(model) })}
								live={live[`llm:${model}`]?.requests}
								max={lim.reqPerDay}
								used={todayRaw[`llm:${model}:req`] || 0}
							/>
						</Fragment>
					))}
				</div>
			</section>
		</>
	)
}

// One row of the limits grid: name, badge, LED bar, value; a full limit turns red.
// Backed by Groq's own headers when a snapshot exists, and by the local count until
// the first API call of the session lands. The two are labelled differently on
// purpose — the measured one is the key's true state (it counts requests this app
// never made), the fallback is only what this app remembers.
function LimitRow({
	label,
	used,
	max,
	live,
	fmt,
}: LimitRowProps): React.ReactElement {
	const t = useT()
	const u = live ? live.limit - live.remaining : used
	const m = live ? live.limit : max
	const pct = m ? Math.min(100, (u / m) * 100) : 0
	const full = pct >= 100
	return (
		<>
			<span className='lim-name'>{label}</span>
			<span>
				<span
					className={
						live ? 'badge badge-outline lim-tag' : 'badge badge-muted lim-tag'
					}
				>
					{t(live ? 'stats.limit.live' : 'stats.limit.estimated')}
				</span>
			</span>
			<span>
				<span className={full ? 'progress progress-full' : 'progress'}>
					<span className='progress-bar' style={{ width: `${pct}%` }} />
				</span>
			</span>
			<span className={full ? 'lim-val lim-full' : 'lim-val'}>
				{fmt(u || 0)} / {m ? fmt(m) : '—'}
			</span>
		</>
	)
}

// ── data helpers ──

// "YYYY-MM-DD" → local Date (avoids the UTC shift of new Date(string)).
function keyToDate(key: string): Date {
	const [y = 0, m = 1, d = 1] = key.split('-').map(Number)
	return new Date(y, m - 1, d)
}
// Localized axis labels via Intl — no per-language name tables needed.
function monthShort(key: string, locale: string): string {
	return keyToDate(key).toLocaleDateString(locale, { month: 'short' })
}
function shortDate(key: string, locale: string): string {
	return keyToDate(key).toLocaleDateString(locale, {
		day: 'numeric',
		month: 'short',
	})
}
// rowIdx 0=Mon … 6=Sun. 2024-01-01 was a Monday — a stable reference week.
function weekdayShort(rowIdx: number, locale: string): string {
	return new Date(2024, 0, 1 + rowIdx).toLocaleDateString(locale, {
		weekday: 'short',
	})
}

// Model id → what fits on a row label. Drops the vendor prefix and the size/date
// suffix that make Groq ids long ("openai/gpt-oss-120b" → "gpt-oss").
function shortModel(id: string): string {
	const name = String(id).split('/').at(-1) ?? id
	return (
		name.replace(
			/-(?:\d+(?:\.\d+)*b?|versatile|instant|latest|\d{8})$/giu,
			'',
		) || name
	)
}

const ZERO: Aggregate = {
	cloudLlmIn: 0,
	cloudLlmOut: 0,
	cloudSttReq: 0,
	cloudSttSec: 0,
	localLlmIn: 0,
	localLlmOut: 0,
	ms: 0,
	n: 0,
}
const FIELDS = Object.keys(ZERO) as Array<keyof Aggregate>

// Sums every day whose key starts with `prefix`. Time saved = spoken time ×
// (TYPING_FACTOR − 1): how much longer typing the same words would have taken.
function total(days: Days, prefix: string): Total {
	const out = { ...ZERO, saved: 0 }
	for (const [key, d] of Object.entries(days)) {
		if (!key.startsWith(prefix)) continue
		for (const f of FIELDS) out[f] += d[f] || 0
	}
	out.saved = out.ms * (TYPING_FACTOR - 1)
	return out
}

function tok(a: Aggregate): number {
	return a.cloudLlmIn + a.cloudLlmOut + a.localLlmIn + a.localLlmOut
}

// GitHub-style grid: columns are weeks (Mon-first), rows are weekdays. Covers the
// last ~12 months ending today; leading cells before the range are null padding.
function buildHeatmap(days: Days): Heatmap {
	const end = new Date()
	const start = new Date(end)
	start.setDate(start.getDate() - 364)
	const mondayOffset = (start.getDay() + 6) % 7 // Sun=0 → Mon-first index
	const cells: Array<HeatmapCell | null> = new Array(mondayOffset).fill(null)
	for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
		const key = dayKey(d)
		const rec = days[key]
		const ms = rec?.ms || 0
		cells.push({ key, level: level(ms), ms, n: rec?.n || 0 })
	}
	// Month labels for the X axis: one per column where the month first changes.
	const cols = Math.ceil(cells.length / 7)
	const months: Array<{ col: number; key: string }> = []
	let lastMonth = -1
	for (let c = 0; c < cols; c++) {
		let rep: HeatmapCell | null | undefined = null
		for (let r = 0; r < 7 && !rep; r++) rep = cells[c * 7 + r]
		if (!rep) continue
		const mo = keyToDate(rep.key).getMonth()
		if (mo !== lastMonth) {
			months.push({ col: c, key: rep.key })
			lastMonth = mo
		}
	}
	// A label under 3 columns from the next would overlap it: that is the partial
	// month the range starts in, so it gives way.
	return {
		cells,
		months: months.filter(
			(m, i) => (months[i + 1]?.col ?? Number.POSITIVE_INFINITY) - m.col >= 3,
		),
	}
}

// Fixed thresholds suit dictation sessions: any use → 1, 5/15/40+ min → 2/3/4.
function level(ms: number): number {
	const min = ms / 60_000
	if (ms <= 0) return 0
	if (min < 5) return 1
	if (min < 15) return 2
	if (min < 40) return 3
	return 4
}

function buildBars(days: Days, count: number): BarChart {
	const out: Bar[] = []
	let max = 0
	for (let i = count - 1; i >= 0; i--) {
		const d = new Date()
		d.setDate(d.getDate() - i)
		const key = dayKey(d)
		const rec = days[key]
		const ms = rec?.ms || 0
		max = Math.max(max, ms)
		out.push({ key, ms, n: rec?.n || 0 })
	}
	// Honest height: real fraction of the peak. Non-zero days that round to 0% are
	// still made visible by the bar's CSS min-height (empty days are transparent),
	// so a bar's height never overstates a day against the Y axis.
	for (const b of out) b.pct = max ? Math.round((b.ms / max) * 100) : 0
	return { bars: out, max }
}

// ── formatting ──

function fmtTok(n: number): string {
	const v = Math.round(n || 0)
	if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
	if (v >= 10_000) return `${Math.round(v / 1000)}k`
	if (v >= 1000) return `${(v / 1000).toFixed(1)}k`
	return String(v)
}

// Counts in the user's locale: "1,320", "1 320".
function num(n: number): string {
	return n.toLocaleString(getLocale())
}
