import { type RefObject, useEffect, useRef } from 'react'

// The pixel engine: every animated board draws into a small
// image, one pixel per cell, and scales it up without smoothing. Opacity is dithered
// to four levels, so the result reads as pixel art, not as a blurred bitmap.

/** One canvas, ready to draw: its cell grid, the cell image and three colours. */
export interface Fx {
	ctx: CanvasRenderingContext2D
	w: number
	h: number
	size: number
	cols: number
	rows: number
	small: HTMLCanvasElement
	sctx: CanvasRenderingContext2D
	image: ImageData
	buf: Uint8ClampedArray
	/** 0 muted, 1 light, 2 primary: the theme's colours as RGB. */
	rgb: Rgb[]
}

export type Rgb = [number, number, number]

// A 2-D context only for its colour parser: assigning any CSS colour to fillStyle
// reads back as "#rrggbb" (or rgba() when translucent). The theme's colours reach the
// engine in whatever form the CSS minifier wrote them (hex in the build).
let probe: CanvasRenderingContext2D | null = null

/** A theme colour (`--primary`…) of `el`, as RGB; light grey if it can't be read. */
export const themeRgb = (el: Element, name: string): Rgb => {
	probe ??= document.createElement('canvas').getContext('2d')
	if (!probe) return [200, 200, 200]
	probe.fillStyle = '#c8c8c8'
	probe.fillStyle =
		getComputedStyle(el).getPropertyValue(name).trim() || '#c8c8c8'
	const v = String(probe.fillStyle)
	if (v.startsWith('#'))
		return [1, 3, 5].map((i) => Number.parseInt(v.slice(i, i + 2), 16)) as Rgb
	const m = v.match(/\d+(\.\d+)?/gu)
	return m && m.length >= 3
		? [Number(m[0]), Number(m[1]), Number(m[2])]
		: [200, 200, 200]
}

export const step = (a: number, b: number, x: number): number => {
	const s = Math.max(0, Math.min(1, (x - a) / (b - a)))
	return s * s * (3 - 2 * s)
}

/** A stable pseudo-random number in 0..1 for an integer point. */
export const hash = (x: number, y: number, z: number): number => {
	let n =
		(Math.imul(x, 374_761_393) +
			Math.imul(y, 668_265_263) +
			Math.imul(z, 1_274_126_177)) |
		0
	n = Math.imul(n ^ (n >>> 13), 1_274_126_177)
	return ((n ^ (n >>> 16)) >>> 0) / 4_294_967_295
}

/** Smooth 3-D value noise in 0..1. */
export const noise = (x: number, y: number, z: number): number => {
	const xi = Math.floor(x)
	const yi = Math.floor(y)
	const zi = Math.floor(z)
	let u = x - xi
	let v = y - yi
	let w = z - zi
	u = u * u * (3 - 2 * u)
	v = v * v * (3 - 2 * v)
	w = w * w * (3 - 2 * w)
	const a = hash(xi, yi, zi)
	const b = hash(xi + 1, yi, zi)
	const c = hash(xi, yi + 1, zi)
	const d = hash(xi + 1, yi + 1, zi)
	const e = hash(xi, yi, zi + 1)
	const f = hash(xi + 1, yi, zi + 1)
	const g = hash(xi, yi + 1, zi + 1)
	const k = hash(xi + 1, yi + 1, zi + 1)
	const x1 = a + (b - a) * u
	const x2 = c + (d - c) * u
	const x3 = e + (f - e) * u
	const x4 = g + (k - g) * u
	const y1 = x1 + (x2 - x1) * v
	const y2 = x3 + (x4 - x3) * v
	return y1 + (y2 - y1) * w
}

/** Slow domain-warped noise for soft drifting backgrounds, 0..1. */
export const field = (x: number, y: number, t: number): number => {
	const q = noise(x * 0.0058, y * 0.0058, t * 0.12)
	const f =
		0.65 * noise(x * 0.0075 + q * 3, y * 0.0075 - q * 2, t * 0.18) +
		0.35 * noise(x * 0.018 + q, y * 0.019, t * 0.3 + 7)
	return step(0.22, 0.78, f)
}

const setup = (canvas: HTMLCanvasElement, size: number): Fx | null => {
	const w = canvas.clientWidth
	const h = canvas.clientHeight
	if (!(w && h)) return null
	const dpr = Math.min(2, window.devicePixelRatio || 1)
	canvas.width = Math.round(w * dpr)
	canvas.height = Math.round(h * dpr)
	const ctx = canvas.getContext('2d')
	const small = document.createElement('canvas')
	const cols = Math.ceil(w / size)
	const rows = Math.ceil(h / size)
	small.width = cols
	small.height = rows
	const sctx = small.getContext('2d')
	if (!(ctx && sctx)) return null
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
	const rgb = (name: string) => themeRgb(canvas, name)
	const image = sctx.createImageData(cols, rows)
	return {
		buf: image.data,
		cols,
		ctx,
		h,
		image,
		rgb: [
			rgb('--muted-foreground'),
			rgb('--card-foreground'),
			rgb('--primary'),
		],
		rows,
		sctx,
		size,
		small,
		w,
	}
}

// 4 × 4 Bayer matrix: which cells round up between two opacity levels.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
/** The cell's dither threshold, 0..1: a fraction above it rounds up a level. */
export const bayer = (i: number, j: number): number =>
	(BAYER[(j & 3) * 4 + (i & 3)] as number) / 16

/** One cell at opacity `a` (0..1, dithered to 4 levels) in colour `ci`. */
// biome-ignore lint/complexity/useMaxParams: called once per cell per frame; an options object would allocate in the hot loop
export const px = (fx: Fx, i: number, j: number, a: number, ci: number) => {
	if (a <= 0.01 || i < 0 || j < 0 || i >= fx.cols || j >= fx.rows) return
	const q = Math.min(1, a) * 4
	let level = Math.floor(q)
	if (q - level > bayer(i, j)) level++
	if (level <= 0) return
	const k = (j * fx.cols + i) * 4
	const c = fx.rgb[ci] as [number, number, number]
	fx.buf[k] = c[0]
	fx.buf[k + 1] = c[1]
	fx.buf[k + 2] = c[2]
	fx.buf[k + 3] = Math.round(level * 63.75)
}

/**
 * Draws `draw(fx, seconds)` into the returned canvas about 15 times a second while
 * it is on screen. With reduced motion the time stays at 2 s. `size` is the cell
 * size in CSS pixels. The latest `draw` is used, so it may close over props.
 */
export function usePixelCanvas(
	size: number,
	draw: (fx: Fx, t: number) => void,
): RefObject<HTMLCanvasElement | null> {
	const ref = useRef<HTMLCanvasElement>(null)
	const drawRef = useRef(draw)
	useEffect(() => {
		drawRef.current = draw
	})

	useEffect(() => {
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
		const start = performance.now()
		let fx: Fx | null = null
		let visible = true
		let last = -1000
		let raf = 0
		let io: IntersectionObserver | undefined
		const loop = (now: number) => {
			raf = requestAnimationFrame(loop)
			const el = ref.current
			if (!el) return
			if (!fx) {
				fx = setup(el, size)
				if (!fx) return
				io = new IntersectionObserver((entries) => {
					visible = entries[0]?.isIntersecting ?? true
				})
				io.observe(el)
			}
			// Reduced motion: time stands still, but a slow redraw still shows new content.
			if (!visible || now - last < (reduce ? 500 : 66)) return
			last = now
			fx.buf.fill(0)
			drawRef.current(fx, reduce ? 2 : (now - start) / 1000)
			fx.sctx.putImageData(fx.image, 0, 0)
			fx.ctx.clearRect(0, 0, fx.w, fx.h)
			fx.ctx.imageSmoothingEnabled = false
			fx.ctx.drawImage(fx.small, 0, 0, fx.cols * fx.size, fx.rows * fx.size)
		}
		raf = requestAnimationFrame(loop)
		return () => {
			cancelAnimationFrame(raf)
			io?.disconnect()
		}
	}, [size])

	return ref
}
