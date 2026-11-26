import { useEffect, useRef, useState } from 'react'
import {
	type Notice,
	type RecordingStatus,
	useRecording,
} from '../hooks/useRecording'
import { type Key, useT } from '../i18n'
import { type PillIcon, PillPainter, pillColors } from '../pixel/pill'

type Phase = 'idle' | 'entering' | 'visible' | 'exiting'

const ENTER_MS = 220
const EXIT_MS = 180
// A dictation still processing after this long says so (cloud usually takes 1–2 s).
const SLOW_MS = 6000

// The recording pill shown while the shortcut is held: a small status screen with
// the Breathe icon (see pixel/pill.ts) and the state in words where it helps.
export default function RecordingPill() {
	const rec = useRecording()
	const phase = useWindowAnimations()
	useShortcut(rec)
	const wait = useWaitNotice(rec.status)
	const view = pillView(rec.status, rec.errorMessage, rec.notice ?? wait)
	return (
		<div className={`pill-window pill-${phase}`}>
			<PillScreen
				analyserRef={rec.analyserRef}
				recording={rec.status === 'recording'}
				running={phase !== 'idle'}
				startedAtRef={rec.startedAtRef}
				view={view}
			/>
		</div>
	)
}

type Recording = ReturnType<typeof useRecording>

// Shortcut IPC from main.ts. Callbacks go through a ref because useRecording
// returns new function objects on every render — depending on them would drop
// and re-add the IPC listener on every render. Both refs are stable, so this
// subscribes exactly once.
function useShortcut({ cancel, start, stop, statusRef }: Recording) {
	const cbs = useRef({ cancel, start, stop })
	useEffect(() => {
		cbs.current = { cancel, start, stop }
	})
	useEffect(() => {
		const off = window.electron.on('shortcut', (state) => {
			// 'pressed' is the only one gated on status. The mic takes ~110 ms to open
			// and status is still 'ready' for all of it, so gating release would
			// swallow the release of a short tap and leave a recording nobody can
			// stop — with the mic held open. useRecording's stop()/cancel() already
			// ignore a call with nothing to stop, so letting those through costs
			// nothing.
			if (state === 'released') cbs.current.stop()
			else if (state === 'aborted') cbs.current.cancel()
			else if (statusRef.current === 'ready') cbs.current.start()
		})
		return () => off()
	}, [statusRef])
}

// The status screen: the effects strip, the icon, the timer while recording, or the
// state in words.
function PillScreen({
	analyserRef,
	recording,
	running,
	startedAtRef,
	view,
}: {
	analyserRef: React.RefObject<AnalyserNode | null>
	recording: boolean
	running: boolean
	startedAtRef: React.RefObject<number>
	view: PillView
}) {
	const t = useT()
	const iconRef = useRef<HTMLCanvasElement>(null)
	const fxRef = useRef<HTMLCanvasElement>(null)
	const timeRef = useRef<HTMLSpanElement>(null)
	usePillPaint({
		analyserRef,
		fxRef,
		iconRef,
		running,
		startedAtRef,
		timeRef,
		view,
	})
	const { icon, text } = view
	return (
		<div className='sunk-frame fp-pill'>
			<div className='sunk-screen fp-screen'>
				{view.fx && (
					<canvas
						className={`fp-fx fp-${icon}`}
						height={19}
						ref={fxRef}
						width={100}
					/>
				)}
				<canvas
					className={`fp-ic fp-${icon}`}
					height={14}
					ref={iconRef}
					width={14}
				/>
				{recording && !text && (
					<div className='fp-meta'>
						<span className='fp-led' />
						<span className='fp-time' ref={timeRef}>
							0:00
						</span>
					</div>
				)}
				{text && (
					<span
						className={`fp-text fp-${icon}`}
						title={text.key ? undefined : text.raw}
					>
						{text.key ? t(text.key) : text.raw}
					</span>
				)}
			</div>
		</div>
	)
}

interface PillView {
	icon: PillIcon
	/** The effects strip: the voice while recording, the chain while thinking. */
	fx: 'wave' | 'think' | null
	text: { key?: Key; raw?: string } | null
}

// What the pill shows: an error first, then a notice or a wait worth explaining,
// else the live effect of the current step.
function pillView(
	status: RecordingStatus,
	errorMessage: string,
	said: Notice | 'loading' | 'slow' | null,
): PillView {
	if (status === 'error' && errorMessage)
		return { fx: null, icon: 'err', text: { raw: errorMessage } }
	if (said === 'loading' || said === 'slow')
		return { fx: null, icon: 'think', text: { key: `pill.${said}` } }
	if (said) return { fx: null, icon: 'note', text: { key: `pill.${said}` } }
	if (status === 'thinking') return { fx: 'think', icon: 'think', text: null }
	return { fx: status === 'recording' ? 'wave' : null, icon: 'rec', text: null }
}

// What the pill says while a dictation is processing, only when it has to wait: a
// local model that must load first (servers.use announces it) or a result slower
// than usual. A quick dictation shows the thinking chain alone.
function useWaitNotice(status: RecordingStatus): 'loading' | 'slow' | null {
	const [wait, setWait] = useState<'loading' | 'slow' | null>(null)
	useEffect(() => {
		if (status !== 'thinking') return
		const off = window.electron.on('model-loading', () => setWait('loading'))
		const timer = setTimeout(() => setWait((w) => w ?? 'slow'), SLOW_MS)
		return () => {
			off()
			clearTimeout(timer)
			setWait(null)
		}
	}, [status])
	return wait
}

// Drives the pill's enter/exit animation via a small phase machine:
//   idle → entering → visible → exiting → idle
//
// The `idle` phase is the important one: while the window is hidden the pill is
// held at opacity 0, so the buffered frame the OS compositor keeps is blank.
// Without it, the last frame before hide is a fully-visible pill, which the
// compositor flashes for one frame on the next show() — before the `window-shown`
// IPC arrives to start the fade-in — producing a visible blink on appear.
function useWindowAnimations(): Phase {
	const [phase, setPhase] = useState<Phase>('idle')

	useEffect(() => {
		const offShown = window.electron.on('window-shown', () =>
			setPhase('entering'),
		)
		const offHide = window.electron.on('should-hide', () => setPhase('exiting'))
		return () => {
			offShown()
			offHide()
		}
	}, [])

	// Each phase that ends on its own owns its timer; a new phase cancels it (a
	// re-press inside the fade-out turns it back into a fade-in).
	useEffect(() => {
		if (phase !== 'entering' && phase !== 'exiting') return
		const entering = phase === 'entering'
		const id = setTimeout(
			() => {
				if (entering) return setPhase('visible')
				// Go blank first, then hide — so the frame left in the buffer is empty.
				setPhase('idle')
				window.electron.hideWindow()
			},
			entering ? ENTER_MS : EXIT_MS,
		)
		return () => clearTimeout(id)
	}, [phase])

	return phase
}

// The mic level, 0..1, from the voice band (~200 Hz – 3 kHz) of the analyser.
const micLevel = (
	analyser: AnalyserNode | null,
	data: Uint8Array<ArrayBuffer>,
): number => {
	if (!analyser) return 0
	analyser.getByteFrequencyData(data)
	const lo = Math.floor(data.length * 0.04)
	const hi = Math.floor(data.length * 0.38)
	let sum = 0
	for (let i = lo; i < hi; i++) sum += data[i] as number
	return Math.min(1, (sum / Math.max(1, hi - lo) / 255) * 2)
}

// Paints the icon, the effects strip and the timer about 30 times a second, only
// while the pill is on screen (the hidden pill window is never backgrounded, see
// main.ts, so an idle loop would burn CPU). Reduced motion: time stands still.
function usePillPaint({
	analyserRef,
	fxRef,
	iconRef,
	running,
	startedAtRef,
	timeRef,
	view,
}: {
	analyserRef: React.RefObject<AnalyserNode | null>
	fxRef: React.RefObject<HTMLCanvasElement | null>
	iconRef: React.RefObject<HTMLCanvasElement | null>
	running: boolean
	startedAtRef: React.RefObject<number>
	timeRef: React.RefObject<HTMLSpanElement | null>
	view: PillView
}) {
	const viewRef = useRef(view)
	useEffect(() => {
		viewRef.current = view
	})

	useEffect(() => {
		if (!running) return
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
		const t0 = performance.now()
		const icon = new ImageData(14, 14)
		const fx = new ImageData(100, 19)
		const data = new Uint8Array(64)
		let painter: PillPainter | null = null
		let level = 0
		let last = -1000
		let raf = 0
		const loop = (now: number) => {
			raf = requestAnimationFrame(loop)
			if (now - last < (reduce ? 500 : 33)) return
			last = now
			const ic = iconRef.current
			if (!ic) return
			painter ??= new PillPainter(pillColors(ic))
			const v = viewRef.current
			const t = reduce ? 7.4 : (now - t0) / 1000
			// Quick to rise, slow to fall, like a level meter.
			const r = v.fx === 'wave' ? micLevel(analyserRef.current, data) : 0
			level += (r > level ? 0.5 : 0.14) * (r - level)
			icon.data.fill(0)
			painter.breathe(icon, { level, state: v.icon, t })
			ic.getContext('2d')?.putImageData(icon, 0, 0)
			const f = fxRef.current
			if (f && v.fx) {
				fx.data.fill(0)
				if (v.fx === 'wave') painter.wave(fx, t, level)
				else painter.think(fx, t)
				f.getContext('2d')?.putImageData(fx, 0, 0)
			}
			const el = timeRef.current
			if (el) {
				const s = Math.floor(
					Math.max(0, Date.now() - startedAtRef.current) / 1000,
				)
				const label = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
				if (el.textContent !== label) el.textContent = label
			}
		}
		raf = requestAnimationFrame(loop)
		return () => cancelAnimationFrame(raf)
	}, [running, analyserRef, fxRef, iconRef, startedAtRef, timeRef])
}
