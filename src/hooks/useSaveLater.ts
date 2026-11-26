import { useCallback, useEffect, useRef } from 'react'
import type { Api } from '../../electron/preload'

type Patch = Parameters<Api['saveSettings']>[0]

// Autosave for typed values (text fields, a slider drag). The caller shows the new
// value at once; this persists it `delay` ms after the last change, so a burst of
// keystrokes is one save — each save rewrites settings.json, re-encrypts the API
// key and pings the pill and the local runtime.
//
// A pending save must reach main before anything reads settings back from it, or
// the field snaps to the old value. So flush() runs on the field's blur (it fires
// before the click that blurred it, e.g. picking a mode, which answers with main's
// merged settings), on window blur (on refocus the settings window refetches
// settings from main) and on unmount (switching tabs).
export function useSaveLater(
	delay = 500,
): [(patch: Patch) => void, () => void] {
	const pending = useRef<Patch | null>(null)
	const timer = useRef<NodeJS.Timeout | undefined>(undefined)

	const flush = useCallback(() => {
		clearTimeout(timer.current)
		if (pending.current) window.electron.saveSettings(pending.current)
		pending.current = null
	}, [])

	useEffect(() => {
		window.addEventListener('blur', flush)
		return () => {
			window.removeEventListener('blur', flush)
			flush()
		}
	}, [flush])

	const saveLater = useCallback(
		(patch: Patch) => {
			pending.current = { ...pending.current, ...patch }
			clearTimeout(timer.current)
			timer.current = setTimeout(flush, delay)
		},
		[delay, flush],
	)
	return [saveLater, flush]
}
