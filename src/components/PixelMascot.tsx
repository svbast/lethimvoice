import { useEffect, useRef } from 'react'
import { MascotPlayer } from '../pixel/mascot'

// The pixel mascot (see pixel/mascot.js) on its 54 × 54 stage, scaled to `size` px.
// `anim` may change while it plays; the next frame follows. Decorative: the text
// beside it says what is going on.
export default function PixelMascot({
	anim,
	size,
	start = 0,
}: {
	anim: string
	size: number
	/** The clock of anim "splash" (performance.now() ms). */
	start?: number
}) {
	const ref = useRef<HTMLCanvasElement>(null)
	const player = useRef<MascotPlayer | null>(null)

	useEffect(() => {
		if (!ref.current) return
		const p = new MascotPlayer(ref.current, 'idle')
		p.t0 = start
		player.current = p
		p.start()
		return () => p.stop()
	}, [start])

	useEffect(() => {
		if (player.current) player.current.anim = anim
	}, [anim])

	return (
		<div style={{ height: size, width: size }}>
			<canvas className='mascot-canvas' height={54} ref={ref} width={54} />
		</div>
	)
}
