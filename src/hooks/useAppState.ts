import { useEffect, useState } from 'react'
import type { Api } from '../../electron/preload'
import { DEFAULT_LOCALE, setLocale } from '../i18n'

// Everything is optional until the snapshot lands, so each field doubles as its
// own "not loaded yet" marker: `undefined` is silence and never shows the wrong
// UI. Settings stay Partial even after loading, as in useAppSettings: tabs read
// them with `|| fallback`.
type Snapshot = Awaited<ReturnType<Api['getAppState']>>
type State = Partial<Omit<Snapshot, 'settings'>> & {
	settings: Partial<Snapshot['settings']>
}

// One round-trip for everything the settings window needs at mount, re-fetched
// on focus: autostart and the portal shortcut are OS state that can change
// behind our back. A failed fetch keeps the last snapshot.
export function useAppState(): [
	State,
	React.Dispatch<React.SetStateAction<State>>,
] {
	const [state, setState] = useState<State>({ settings: {} })

	useEffect(() => {
		const load = () =>
			window.electron
				.getAppState()
				.then((next) => {
					setLocale(next.settings.uiLanguage || DEFAULT_LOCALE)
					setState(next)
				})
				.catch(() => undefined)

		load()
		window.addEventListener('focus', load)
		// Before the snapshot lands there is no backend to attach a trigger to —
		// and it arrives with the current one anyway.
		const off = window.electron.on('shortcut-bound', (trigger) =>
			setState((s) =>
				s.shortcut ? { ...s, shortcut: { ...s.shortcut, trigger } } : s,
			),
		)
		// Settings changed by main itself (the local setup switches local mode on).
		const offSettings = window.electron.on('settings-changed', (settings) =>
			setState((s) => ({ ...s, settings })),
		)
		return () => {
			window.removeEventListener('focus', load)
			off()
			offSettings()
		}
	}, [])

	return [state, setState]
}
