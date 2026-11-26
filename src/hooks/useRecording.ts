import { useEffect, useRef, useState } from 'react'
import { errorHint } from '../i18n'
import { blobToWav16kMono } from '../utils/wav'
import { useAppSettings } from './useAppSettings'

export type RecordingStatus =
	| 'ready'
	| 'recording'
	| 'thinking'
	| 'error'
	| 'disabled'

// A hold whose release never arrives must not record forever, mic open (OpenWhispr
// caps at 5 min too). Where the OS can tell, the shortcut's key-state watch
// (electron/shortcuts/keystate.ts) ends such a hold far sooner.
const MAX_RECORDING_MS = 5 * 60_000
// How long the pill shows the outcome of a dictation that pasted nothing.
const NOTICE_MS = 2000
/** nothing: no speech in the recording. clipboard: no paste could be sent. */
export type Notice = 'clipboard' | 'nothing'
interface ErrorLike {
	message?: string
}

// Owns: MediaRecorder, AudioContext analyser, and the transcribe→paste IPC flow.
// Exposes: status, analyserRef (for visualisations), imperative start/stop/cancel.
// Follows the mic device and the enabled flag from settings itself.
//
// The mic is opened in start() (shortcut pressed) and fully released on stop — never
// held while idle. Holding a ready stream would start recording ~110 ms sooner, but
// it keeps the OS "microphone in use" indicator lit for as long as the app runs
// (Windows tray, macOS orange dot), which reads as "this app is always listening".
// The delay is not silently lost audio: the pill only turns to 'recording' once the
// mic is genuinely live, so the cue you speak to is honest.
export function useRecording() {
	const [status, setStatus] = useState<RecordingStatus>('ready')
	const [errorMessage, setErrorMessage] = useState<string>('') // human-readable hint shown on the pill
	const [notice, setNotice] = useState<Notice | null>(null)
	const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	)

	const statusRef = useRef<RecordingStatus>('ready')
	const selectedDeviceRef = useRef<string>('default')
	const isRecordingRef = useRef<boolean>(false)
	// Set when a hold is cancelled mid-recording (a modifier-only shortcut turned into
	// a chord) so handleStop throws the audio away instead of transcribing it.
	const abortedRef = useRef<boolean>(false)

	// Recording clock: startedAtRef drives the pill's live timer (read by an
	// interval, not React state — no re-render per tick); durationMsRef is fixed
	// at stop() and sent with the transcribe call for usage statistics.
	const startedAtRef = useRef<number>(0)
	const durationMsRef = useRef<number>(0)
	const capRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

	const mediaRecorderRef = useRef<MediaRecorder | null>(null)
	const chunksRef = useRef<Blob[]>([])
	const streamRef = useRef<MediaStream | null>(null)

	const audioCtxRef = useRef<AudioContext | null>(null)
	const analyserRef = useRef<AnalyserNode | null>(null)

	// Non-null while start() is waiting for the mic to open. A hold can end inside
	// that ~110 ms window, and the release must not be dropped: stop()/cancel() clear
	// the token, and start() — finding it changed — throws its stream away instead of
	// leaving behind a recorder nobody can stop and a mic nobody closes. A second
	// press inside the window replaces the token, which discards the first stream too.
	const startTokenRef = useRef<object | null>(null)
	// Guards async setState/IPC after the component unmounts (e.g. window hidden
	// mid-transcribe).
	const mountedRef = useRef<boolean>(true)

	useEffect(() => {
		statusRef.current = status
	}, [status])

	useEffect(
		() => () => {
			mountedRef.current = false
			startTokenRef.current = null
			clearTimeout(capRef.current)
			clearTimeout(noticeTimerRef.current)
			for (const track of streamRef.current?.getTracks() ?? []) {
				track.stop()
			}
			audioCtxRef.current?.close()
		},
		[],
	)

	// Mic device and enabled flag from settings, live. The device is only recorded: the
	// mic opens for a hold and closes after (see above), so this can't light the OS
	// "microphone in use" indicator. Cloud and local get the same 16 kHz mono WAV, so
	// the backend doesn't matter here.
	const [settings] = useAppSettings({ live: true })
	useEffect(() => {
		selectedDeviceRef.current = settings.inputDevice || 'default'
		if (settings.enabled === false && statusRef.current === 'ready')
			setStatus('disabled')
		if (settings.enabled !== false && statusRef.current === 'disabled')
			setStatus('ready')
	}, [settings.inputDevice, settings.enabled])

	function startAnalyser(stream: MediaStream): void {
		try {
			const audioCtx = new AudioContext()
			const source = audioCtx.createMediaStreamSource(stream)
			const analyser = audioCtx.createAnalyser()
			analyser.fftSize = 128
			analyser.smoothingTimeConstant = 0.75
			source.connect(analyser)
			audioCtxRef.current = audioCtx
			analyserRef.current = analyser
		} catch {
			/* no AudioContext ⇒ no level meter; recording itself still works */
		}
	}

	function stopAnalyser(): void {
		if (audioCtxRef.current) {
			audioCtxRef.current.close()
			audioCtxRef.current = null
		}
		analyserRef.current = null
	}

	async function start(): Promise<void> {
		// A new hold during an outcome notice: the pill is the recording's again.
		clearTimeout(noticeTimerRef.current)
		setNotice(null)
		const token = {}
		startTokenRef.current = token
		let live = false // true once this start owns the recorder and the pill
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: buildAudioConstraints(selectedDeviceRef.current),
			})
			// The hold ended, a newer one began, or the pill went away while the mic was
			// opening — nobody is waiting for this stream, so close it right back.
			if (!mountedRef.current || startTokenRef.current !== token) {
				for (const track of stream.getTracks()) {
					track.stop()
				}
				return
			}
			startTokenRef.current = null
			live = true
			streamRef.current = stream
			chunksRef.current = []
			startAnalyser(stream)

			const mr = createRecorder(stream)
			mediaRecorderRef.current = mr
			mr.ondataavailable = (e) => {
				if (e.data.size > 0) chunksRef.current.push(e.data)
			}

			// Bind onstop BEFORE start() — guards against ultra-short recordings firing stop first.
			mr.onstop = handleStop(mr)

			// No timeslice — Chromium emits one whole WebM chunk at stop().
			// Sliced fragments are rejected by Whisper.
			mr.start()
			isRecordingRef.current = true
			startedAtRef.current = Date.now()
			setStatus('recording')
			clearTimeout(capRef.current)
			capRef.current = setTimeout(stop, MAX_RECORDING_MS)
		} catch (e) {
			// Report only if this start still owns the pill. A hold released mid-open has
			// already been cleaned up by cancelPendingStart, and a start replaced by a
			// newer press would otherwise blank the recording that took over.
			if (!live && startTokenRef.current !== token) return
			startTokenRef.current = null
			const error = e as ErrorLike
			showError(`mic: ${error.message || ''}`)
		}
	}

	function handleStop(mr: MediaRecorder): () => Promise<void> {
		return async () => {
			// However it ended (stop, cancel, the device going away): no cap left armed
			// to cut a later recording short.
			clearTimeout(capRef.current)
			for (const track of streamRef.current?.getTracks() ?? []) {
				track.stop()
			}
			// Aborted mid-hold (a chord like ⌘C ran) — discard the audio, don't transcribe.
			if (abortedRef.current) {
				abortedRef.current = false
				return
			}
			try {
				const mimeType = mr.mimeType || 'audio/webm'
				const blob = new Blob(chunksRef.current, { type: mimeType })
				if (blob.size === 0) {
					if (mountedRef.current) finish('nothing')
					return
				}

				// Both backends get 16 kHz mono WAV: local Whisper requires it, and the
				// decode step is what lets us cut the leading/trailing silence that makes
				// Whisper hallucinate ("Thank you for watching."). If the decode fails we
				// fall back to raw webm — worse input beats no transcription.
				let payload: ArrayBuffer
				let sendMime: string
				try {
					const wav = await blobToWav16kMono(blob)
					if (!wav) {
						if (mountedRef.current) finish('nothing')
						return
					}
					payload = wav
					sendMime = 'audio/wav'
				} catch {
					payload = await blob.arrayBuffer()
					sendMime = mimeType
				}
				const text = (await window.electron.transcribe(
					payload,
					sendMime,
					durationMsRef.current,
				)) as string
				if (!mountedRef.current) return
				if (!text?.trim()) return finish('nothing')
				// Pasted: the paste-text handler (ipc/dictation.ts) hides the pill.
				const pasted = await window.electron.pasteText(text.trim())
				if (!mountedRef.current) return
				if (pasted) setStatus('ready')
				else finish('clipboard')
			} catch (e) {
				const error = e as ErrorLike
				if (mountedRef.current) showError(error.message)
			}
		}
	}

	// The hold ended before the mic finished opening. There is no audio to keep or
	// throw away yet — just undo the pending start and put the pill back.
	function cancelPendingStart(): void {
		startTokenRef.current = null
		setStatus('ready')
		window.electron.hideWindow()
	}

	// The pill window is SHOWN by main.ts on every keydown, but hiding it is
	// entirely this hook's job. So a keyup with nothing to stop must still put the
	// window away — otherwise any hold where recording never began (disabled state,
	// a mic that failed and already reported, a stray keyup) leaves the pill
	// stranded on screen forever. 'thinking'/'error' are left alone on purpose:
	// an in-flight pipeline and the error toast own their hide already.
	function dismissIfIdle(): void {
		if (statusRef.current === 'ready' || statusRef.current === 'disabled') {
			window.electron.hideWindow()
		}
	}

	function stop(): void {
		clearTimeout(capRef.current)
		if (startTokenRef.current) {
			cancelPendingStart()
			return
		}
		if (!(mediaRecorderRef.current && isRecordingRef.current)) {
			dismissIfIdle()
			return
		}
		isRecordingRef.current = false
		durationMsRef.current = Date.now() - startedAtRef.current
		stopAnalyser()
		setStatus('thinking')
		mediaRecorderRef.current.stop()
	}

	// Cancel an in-progress recording WITHOUT transcribing — used when a modifier-only
	// push-to-talk hold turns out to be a shortcut (e.g. Right-⌘ then C). Discards the
	// audio (via abortedRef, read in handleStop), resets to ready and hides the pill.
	function cancel(): void {
		clearTimeout(capRef.current)
		if (startTokenRef.current) {
			cancelPendingStart()
			return
		}
		if (!(mediaRecorderRef.current && isRecordingRef.current)) {
			dismissIfIdle()
			return
		}
		isRecordingRef.current = false
		abortedRef.current = true
		stopAnalyser()
		setStatus('ready')
		try {
			mediaRecorderRef.current.stop()
		} catch {
			/* already stopped */
		}
		window.electron.hideWindow()
	}

	// The dictation ended without a paste: say why on the pill, then put it away.
	function finish(n: Notice): void {
		setStatus('ready')
		setNotice(n)
		clearTimeout(noticeTimerRef.current)
		noticeTimerRef.current = setTimeout(() => {
			setNotice(null)
			window.electron.hideWindow()
		}, NOTICE_MS)
	}

	function showError(rawMessage: unknown): void {
		stopAnalyser()
		setErrorMessage(errorHint(rawMessage))
		setStatus('error')
		setTimeout(() => {
			setStatus('ready')
			setErrorMessage('')
			window.electron.hideWindow()
		}, 4000)
	}

	return {
		analyserRef,
		cancel,
		errorMessage,
		notice,
		start,
		startedAtRef,
		status,
		statusRef,
		stop,
	}
}

// Audio constraints tuned for Whisper:
//   • sampleRate 16000 — Whisper's native rate. Browser does a higher-quality
//     downsample than Whisper's internal one, preserving more speech detail.
//     This matters most for Slavic languages (palatalized consonants, vowel
//     length distinctions live in the upper bands that get smeared by cheap
//     downsamplers).
//   • channelCount 1 — mono is all Whisper uses anyway; halves the payload.
//   • noiseSuppression OFF — Chromium's NS is tuned for VoIP intelligibility,
//     not for ASR. It is spectral subtraction: it introduces musical-noise
//     artifacts and eats high-band energy, which is exactly where fricatives and
//     palatalized consonants live (as in Slavic languages). Less acoustic evidence means
//     Whisper leans harder on its language prior, and that is what turns a
//     mis-heard word into a confidently invented one. Whisper was trained on raw
//     noisy audio and handles it better than it handles NS artifacts.
//   • autoGainControl OFF — AGC ramps the gain up during pauses, lifting room
//     noise to speech level. That is what makes silence look like speech and
//     triggers the subtitle-boilerplate hallucination; it also fights the RMS
//     silence trim in utils/silence.ts.
//   • echoCancellation ON — kept: it stops speaker output being dictated back in,
//     and unlike NS it does not touch the speech spectrum when nothing is playing.
// All values are HINTS — if the device doesn't support 16 kHz natively, the
// browser picks the closest supported rate and resamples; recording still works.
function buildAudioConstraints(deviceId: string): MediaTrackConstraints {
	const base = {
		autoGainControl: false,
		channelCount: 1,
		echoCancellation: true,
		noiseSuppression: false,
		sampleRate: 16_000,
	}
	if (!deviceId || deviceId === 'default') return base
	return { ...base, deviceId: { exact: deviceId } }
}

// Prefer audio/webm;codecs=opus @ 32 kbps — speech-grade quality, ~4× smaller
// upload than Chromium's default 128 kbps. Whisper transcribes both identically.
// Fall back to bare defaults if the browser rejects the explicit type so we
// never break recording on unusual platforms.
function createRecorder(stream: MediaStream): MediaRecorder {
	const preferred = 'audio/webm;codecs=opus'
	try {
		if (
			typeof MediaRecorder !== 'undefined' &&
			MediaRecorder.isTypeSupported &&
			MediaRecorder.isTypeSupported(preferred)
		) {
			return new MediaRecorder(stream, {
				audioBitsPerSecond: 32_000,
				mimeType: preferred,
			})
		}
	} catch {
		/* constructor rejected the explicit type — fall through to defaults */
	}
	return new MediaRecorder(stream)
}
