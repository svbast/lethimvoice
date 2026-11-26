import { type RefObject, useRef } from 'react'
import { type Fx, field, px, usePixelCanvas } from './engine'

// The Local tab's pixel art, verbatim from the design boards: the model tile's
// field (LocalSetup board) and the download row's bar (Local board).

/** What a model tile shows: waiting, queued, downloading, on disk. */
export type TileFx = 'idle' | 'queue' | 'dl' | 'done'

// The board's cell opacity: density v under mask m.
const alpha = (v: number, m: number) => (0.04 + 0.55 * v) * m

const paint = (
	fx: Fx,
	t: number,
	{ state, p, q }: { state: TileFx; p: number; q: number },
) => {
	if (state === 'idle') calm(fx, t, 0.45, false)
	else if (state === 'queue') calm(fx, t, 0.5 + 0.15 * Math.sin(t * 3), false)
	else if (state === 'dl') flow(fx, t, p)
	else finish(fx, t, q)
}

// The resting field: grey while it waits, blue once it is done.
const calm = (fx: Fx, t: number, m: number, blue: boolean) => {
	for (let j = 0; j < fx.rows; j++)
		for (let i = 0; i < fx.cols; i++) {
			const v = field(i * fx.size + fx.size / 2, j * fx.size + fx.size / 2, t)
			px(fx, i, j, alpha(v, m), blue && v > 0.55 ? 2 : 0)
		}
}

// Downloading: the part already down flows in blue, the edge sparkles.
const flow = (fx: Fx, t: number, p: number) => {
	const edge = p * fx.w
	for (let j = 0; j < fx.rows; j++) {
		const y = j * fx.size + fx.size / 2
		for (let i = 0; i < fx.cols; i++) {
			const x = i * fx.size + fx.size / 2
			const dist = (x - edge) / fx.size
			if (Math.abs(dist) < 1.2) px(fx, i, j, alpha(1, 2), 1)
			else if (dist < 0) {
				const v = Math.min(1, field(x, y, t) * 0.9 + Math.exp(dist / 5) * 0.45)
				px(fx, i, j, alpha(v, 1.25), v > 0.45 ? 2 : 1)
			} else px(fx, i, j, alpha(field(x, y, t), 0.7), 0)
		}
	}
}

interface Pt {
	x: number
	y: number
}
// Distance from p to segment ab (length len), and how far along it the foot lies.
const near = (p: Pt, a: Pt, b: Pt, len: number) => {
	const u = Math.max(
		0,
		Math.min(
			1,
			((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len),
		),
	)
	return {
		d: Math.hypot(p.x - a.x - u * (b.x - a.x), p.y - a.y - u * (b.y - a.y)),
		u,
	}
}

// Done: a light band runs across, the field settles to a calm blue and a pixel
// check draws itself. q: seconds since it turned done.
const finish = (fx: Fx, t: number, q: number) => {
	calm(fx, t, 0.85, true)
	if (q < 0.6) {
		const band = (q / 0.6) * (fx.cols + 8) - 4
		for (let j = 0; j < fx.rows; j++)
			for (let i = 0; i < fx.cols; i++) {
				const d = Math.abs(i - band)
				if (d < 1.5) px(fx, i, j, alpha(1, 2), 1)
				else if (d < 5) px(fx, i, j, alpha(1, 0.9 * (1 - d / 5)), 1)
			}
	}
	const k = fx.rows / 16
	const cx = fx.cols / 2
	const cy = fx.rows / 2 + 0.5 * k
	const p0 = { x: cx - 7 * k, y: cy }
	const p1 = { x: cx - 2.5 * k, y: cy + 4.5 * k }
	const p2 = { x: cx + 7.5 * k, y: cy - 5.5 * k }
	const l1 = Math.hypot(p1.x - p0.x, p1.y - p0.y)
	const l2 = Math.hypot(p2.x - p1.x, p2.y - p1.y)
	const drawn = Math.max(0, Math.min(1, (q - 0.3) / 0.45)) * (l1 + l2)
	const thick = Math.max(0.6, 1.3 * k)
	for (let j = 0; j < fx.rows; j++)
		for (let i = 0; i < fx.cols; i++) {
			const p = { x: i + 0.5, y: j + 0.5 }
			const s1 = near(p, p0, p1, l1)
			const s2 = near(p, p1, p2, l2)
			// The nearer stroke; a tie stays on the first, as on the board.
			const first = s1.d <= s2.d
			const best = first ? s1.d : s2.d
			const along = first ? s1.u * l1 : l1 + s2.u * l2
			if (along <= drawn) {
				if (best < thick) px(fx, i, j, alpha(1, 2), 1)
				else if (best < thick + 1.4) px(fx, i, j, alpha(1, 0.5), 2)
			}
		}
}

/**
 * A model tile's canvas. `p`: download fraction 0..1; `n`: grid position, which
 * offsets the field so neighbours differ. A tile that turns done on screen runs
 * the band and draws its check; one that already was shows the check at once.
 */
export function useTileCanvas(
	state: TileFx,
	p: number,
	n: number,
): RefObject<HTMLCanvasElement | null> {
	const last = useRef<TileFx | null>(null)
	// When the tile turned done on screen; -99: it already was, no band or drawing.
	const doneAt = useRef(-99)
	return usePixelCanvas(4, (fx, time) => {
		if (state === 'done' && last.current !== null && last.current !== 'done')
			doneAt.current = matchMedia('(prefers-reduced-motion: reduce)').matches
				? -99
				: time
		last.current = state
		paint(fx, time + n * 11, { p, q: time - doneAt.current, state })
	})
}

// The download row's bar (the Local board's `flow`): the downloaded part flows,
// the next segment blinks.
const flowBar = (fx: Fx, t: number, pct: number) => {
	const edge = Math.round((pct / 100) * fx.cols)
	const on = Math.floor(t * 2.5) % 2 === 0
	for (let i = 0; i < fx.cols; i++)
		if (i % 3 !== 2)
			for (let j = 0; j < fx.rows; j++) {
				if (i < edge) {
					const v = field(i * fx.size * 2 - t * 60, j * fx.size * 2, t)
					px(fx, i, j, 0.65 + 0.35 * v, v > 0.72 ? 1 : 2)
				} else if (i < edge + 3) px(fx, i, j, on ? 1 : 0.3, 1)
				else px(fx, i, j, 0.22, 0)
			}
}

/** The download row's canvas at `pct` percent. */
export const useFlowBar = (pct: number): RefObject<HTMLCanvasElement | null> =>
	usePixelCanvas(3, (fx, t) => flowBar(fx, t, pct))
