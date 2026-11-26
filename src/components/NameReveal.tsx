import { useRef } from 'react'
import { type Fx, hash, px, usePixelCanvas } from '../pixel/engine'

/** When the splash sweep takes the mascot and the name out (s); see pixel/mascot.js. */
const OUT = 2.1

interface Ink {
	i: number
	j: number
	/** 1 light (first word), 2 blue (the rest). */
	ci: number
	h: number
}

// The text drawn once into the pixel grid: every lit cell of it.
const letters = (fx: Fx, text: string): Ink[] => {
	const c = document.createElement('canvas')
	c.width = fx.cols
	c.height = fx.rows
	const g = c.getContext('2d')
	if (!g) return []
	const font = (n: number) => `${n}px "Jersey 20", monospace`
	let size = Math.floor(fx.rows * 0.78)
	g.font = font(size)
	const full = g.measureText(text).width
	if (full > fx.cols * 0.92) {
		size = Math.floor((size * fx.cols * 0.92) / full)
		g.font = font(size)
	}
	const width = g.measureText(text).width
	const left = (fx.cols - width) / 2
	const gap = text.indexOf(' ')
	const split =
		gap < 0
			? Number.POSITIVE_INFINITY
			: left + g.measureText(text.slice(0, gap)).width
	g.textBaseline = 'middle'
	g.fillStyle = '#fff'
	g.fillText(text, Math.round(left), Math.round(fx.rows / 2))
	const data = g.getImageData(0, 0, fx.cols, fx.rows).data
	const ink: Ink[] = []
	for (let j = 0; j < fx.rows; j++)
		for (let i = 0; i < fx.cols; i++) {
			if ((data[(j * fx.cols + i) * 4 + 3] as number) < 110) continue
			ink.push({ ci: i + 0.5 < split ? 1 : 2, h: hash(i, j, 3), i, j })
		}
	return ink
}

// The app name for the launch splash: one sweep across the window draws it in
// together with the mascot, each pixel with a white spark, and the same sweep takes it
// out at OUT. Fills the nearest positioned box; `start` is the clock the mascot uses too.
export default function NameReveal({
	text,
	start,
}: {
	text: string
	start: number
}) {
	const ink = useRef<{ key: string; pts: Ink[] }>({ key: '', pts: [] })
	const ref = usePixelCanvas(4, (fx) => {
		const ready = document.fonts.check('16px "Jersey 20"')
		const key = `${text}${fx.cols}x${fx.rows}${ready}`
		if (ink.current.key !== key) ink.current = { key, pts: letters(fx, text) }
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
		const p = reduce ? 1.5 : (performance.now() - start) / 1000
		// Where the canvas sits in the window, so its sweep lines up with the mascot's.
		const el = ref.current
		const root = el?.closest('.app')
		const x =
			el && root
				? el.getBoundingClientRect().left - root.getBoundingClientRect().left
				: 0
		const w = root instanceof HTMLElement ? root.offsetWidth || 960 : 960
		for (const d of ink.current.pts) {
			const on =
				1.1 * (0.92 * Math.min(1, (x + (d.i + 0.5) * fx.size) / w) + 0.08 * d.h)
			if (p < on || p >= OUT + on + 0.06) continue
			px(fx, d.i, d.j, 1, p - on < 0.06 || p >= OUT + on ? 1 : d.ci)
		}
	})
	return (
		<canvas aria-label={text} className='name-reveal' ref={ref} role='img' />
	)
}
