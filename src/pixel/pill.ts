import { bayer, noise, type Rgb, step, themeRgb } from './engine'

// The recording pill's pixel art: the Breathe icon (14 × 14 cells) and the effects
// strip (100 × 19 cells), both drawn at 2 px. Unlike the other boards the stronger
// stroke wins a cell, and there are five colours.

export type PillIcon = 'rec' | 'think' | 'note' | 'err'

/** 0 muted, 1 light, 2 primary, 3 red, 4 violet. */
export const pillColors = (el: Element): Rgb[] =>
	[
		'--muted-foreground',
		'--card-foreground',
		'--primary',
		'--destructive',
		'--chart-2',
	].map((name) => themeRgb(el, name))

// The icon's colour per state: the dot's core is always light.
const ICON_COLOR: Record<PillIcon, number> = {
	err: 3,
	note: 2,
	rec: 2,
	think: 4,
}

export class PillPainter {
	private readonly rgb: Rgb[]

	constructor(rgb: Rgb[]) {
		this.rgb = rgb
	}

	/** One cell at opacity a (dithered to 4 levels); a cell keeps its strongest stroke. */
	// biome-ignore lint/complexity/useMaxParams: called once per cell per frame; an options object would allocate in the hot loop
	px(img: ImageData, x: number, j: number, a: number, ci: number) {
		const i = Math.round(x)
		if (a <= 0.01 || i < 0 || j < 0 || i >= img.width || j >= img.height) return
		const q = Math.min(1, a) * 4
		let level = Math.floor(q)
		if (q - level > bayer(i, j)) level++
		const k = (j * img.width + i) * 4
		const d = img.data
		const alpha = Math.round(level * 63.75)
		if (level <= 0 || (d[k + 3] as number) >= alpha) return
		const c = this.rgb[ci] as Rgb
		d[k] = c[0]
		d[k + 1] = c[1]
		d[k + 2] = c[2]
		d[k + 3] = alpha
	}

	// The icon: one soft dot that swells with the voice (rec), breathes while thinking,
	// stays still and dim for a notice (note) and flashes on an error.
	breathe(
		img: ImageData,
		{ state, t, level }: { state: PillIcon; t: number; level: number },
	) {
		const flash = 0.3 + 0.7 * (0.5 + 0.5 * Math.cos((t * Math.PI * 2) / 0.9))
		const r =
			state === 'err'
				? 4
				: state === 'think'
					? 3.4 + 1.3 * Math.sin(t * 2.4)
					: state === 'note'
						? 3
						: 1.8 + 4 * level
		const strength = state === 'err' ? flash : state === 'note' ? 0.75 : 1
		for (let j = 0; j < 14; j++)
			for (let i = 0; i < 14; i++) {
				const d = Math.hypot(i + 0.5 - 7, j + 0.5 - 7)
				const a = Math.min(1, r - d + 0.5)
				if (a <= 0) continue
				const ci = state === 'err' ? 3 : d < r * 0.45 ? 1 : ICON_COLOR[state]
				// Whole quarter steps of opacity, so the icon's pixels stay clean.
				this.px(img, i, j, Math.round(strength * a * 4) / 4, ci)
			}
	}

	// Recording: three strands, as on the Home card, their height following the voice.
	wave(img: ImageData, t: number, level: number) {
		const x0 = 19
		const x1 = 68
		const mid = (img.height - 1) / 2
		const on = 0.22 + 0.78 * step(0.03, 0.25, level)
		const W = [
			[0.34, 6.5, 0, 0.42, 1],
			[0.23, -4.2, 2, 0.3, 0.75],
			[0.52, 9, 4, 0.2, 0.55],
		] as const
		for (let i = x0; i <= x1; i++) {
			const taper = Math.sin(((i - x0) / (x1 - x0)) * Math.PI) ** 0.7
			const env = level * taper * (0.55 + 0.45 * noise(i * 0.13, t * 2.4, 2))
			const c = W.map(
				(w) =>
					mid + w[3] * img.height * env * Math.sin(i * w[0] + t * w[1] + w[2]),
			)
			for (let j = 0; j < img.height; j++) {
				let best = 0
				let n = 0
				for (let k = 0; k < 3; k++) {
					const d = (j - (c[k] as number)) / (0.7 + 0.6 * env)
					const val = Math.exp(-d * d) * (W[k] as (typeof W)[number])[4]
					if (val > best) {
						best = val
						n = k
					}
				}
				if (best > 0.1)
					this.px(
						img,
						i,
						j,
						Math.min(1, best * 1.15) * on * (0.35 + 0.65 * taper),
						n === 2 ? 0 : best > 0.82 ? 1 : 2,
					)
			}
		}
	}

	// Thinking: a violet chain with a bright packet travelling along it.
	think(img: ImageData, t: number) {
		const x0 = 19
		const x1 = 96
		const mid = (img.height - 1) / 2
		const n = x1 - x0
		const head = x0 + ((t * 0.7) % 1.5) * n * 1.2 - n * 0.2
		for (let i = x0; i <= x1; i++) {
			const taper = Math.sin(((i - x0) / n) * Math.PI) ** 0.7
			const y = mid + Math.sin(i * 0.35 + t * 2.4) * img.height * 0.22 * taper
			const glow = Math.exp(-(((i - head) / 5) ** 2))
			for (let j = 0; j < img.height; j++) {
				const base = Math.max(0, 1.2 - Math.abs(j - y))
				if (base > 0)
					this.px(
						img,
						i,
						j,
						Math.min(1, base * (0.35 + 0.75 * glow)) * (0.4 + 0.6 * taper),
						glow > 0.5 ? 1 : 4,
					)
			}
		}
	}
}
