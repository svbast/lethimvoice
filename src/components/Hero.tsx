import {
	type Fx,
	field,
	noise,
	px,
	step,
	usePixelCanvas,
} from '../pixel/engine'
import PixelMascot from './PixelMascot'
import { renderTemplate } from './renderTemplate'
import Switch from './Switch'

// Three slow voice waves behind the card, dimmed, soft at both ends and edges.
const WAVES = [
	{ a: 0.3, f: 0.037, k: 1, p: 0, s: 0.55, th: 3.2 },
	{ a: 0.22, f: 0.055, k: 0.75, p: 2.1, s: -0.4, th: 2.2 },
	{ a: 0.36, f: 0.021, k: 0.5, p: 4.2, s: 0.25, th: 5 },
]
const wave = (fx: Fx, t: number) => {
	const mid = (fx.rows - 1) / 2
	const half = fx.rows / 2
	for (let i = 0; i < fx.cols; i++) {
		const u = i / fx.cols
		const fade = step(0, 0.2, u) * (1 - step(0.8, 1, u))
		const env = 0.35 + 0.65 * noise(i * 0.03, t * 0.25, 1.5)
		const c = WAVES.map(
			(w) => mid + w.a * fx.rows * env * Math.sin(i * w.f + t * w.s + w.p),
		)
		for (let j = 0; j < fx.rows; j++) {
			let v = field(i * fx.size, j * fx.size, t * 0.6) * 0.18
			WAVES.forEach((w, n) => {
				const d = (j - (c[n] as number)) / (w.th * (0.6 + env))
				v = Math.max(v, Math.exp(-d * d) * w.k)
			})
			const edge = 1 - step(0.7, 1, Math.abs(j - mid) / half)
			px(fx, i, j, v * 0.9 * fade * edge, v > 0.8 ? 1 : v > 0.4 ? 2 : 0)
		}
	}
}

/** The plate on the right: a switch, key caps or a lit value. */
type Plate =
	| { kind: 'switch'; label: string; on: boolean; onToggle: () => void }
	| { kind: 'keys'; label: string; keys: string[] }
	| { kind: 'value'; label: string; value: string }

interface Props {
	/** Mascot loop(s): one name or several joined by commas. */
	anim: string
	title: string
	/** One line under the title; `{keys}` becomes key caps. */
	desc: string
	keys?: string[]
	badge: string
	/** live: tinted badge with a blinking dot; plain: tinted badge; muted: grey badge. */
	tone: 'live' | 'plain' | 'muted'
	plate: Plate
}

// The same top card on every tab: the mascot, a lit headline, one line of text, a
// badge, and a plate on the right. Only the words change.
export default function Hero({
	anim,
	title,
	desc,
	keys = [],
	badge,
	tone,
	plate,
}: Props) {
	const waveRef = usePixelCanvas(4, wave)
	return (
		<section className='card hero-card'>
			<canvas className='hero-wave' ref={waveRef} />
			<div className='hstack gap-6 hero-row'>
				<div className='hero-mascot'>
					<PixelMascot anim={anim} size={108} />
				</div>
				<div className='stack gap-1 grow'>
					<div className='hero-status hero-line'>{title}</div>
					<div className='muted hero-line'>
						{renderTemplate(desc, {
							keys: keys.map((k) => (
								<kbd className='kbd hero-key' key={k}>
									{k}
								</kbd>
							)),
						})}
					</div>
					<span
						className={
							tone === 'muted'
								? 'badge badge-muted hero-badge'
								: 'badge badge-secondary hero-badge'
						}
					>
						{tone === 'live' && <span className='dot dot-live' />}
						{badge}
					</span>
				</div>
				<div className='switch-plate'>
					<span>{plate.label}</span>
					{plate.kind === 'switch' && (
						<Switch
							aria-label={plate.label}
							on={plate.on}
							onToggle={plate.onToggle}
						/>
					)}
					{plate.kind === 'keys' && (
						<span className='hstack gap-1'>
							{plate.keys.map((k) => (
								<kbd className='kbd' key={k}>
									{k}
								</kbd>
							))}
						</span>
					)}
					{plate.kind === 'value' && <span className='lit'>{plate.value}</span>}
				</div>
			</div>
		</section>
	)
}
