import { useEffect, useState } from 'react'
import type { Settings as StoredSettings } from '../../electron/store/settings'
import { DEFAULT_LOCALE, setLocale } from '../i18n'

interface Props {
	live?: boolean
}

// Mirrors the main process type exactly (type-only import — nothing from
// electron/ ends up in the renderer bundle). Partial because the renderer starts
// empty and fills in from IPC on mount.
type Settings = Partial<StoredSettings>

// Single source of truth for default values is electron/store/settings.ts (main
// process). The renderer never hard-codes its own copy: it starts empty and
// the real settings arrive via IPC on mount. The few values read before that
// resolves are guarded by `|| fallback` at each call site.
const INITIAL: Settings = {}

// Loads settings once and (optionally) keeps in sync with changes broadcast
// from the settings window via the 'settings-changed' IPC channel.
//
// Pass `live: true` in windows that need to react to changes made elsewhere
// (recording pill). The settings window itself owns the form state and only
// needs the initial load.
//
// Side effect: keeps the i18n runtime in sync with `settings.uiLanguage`
// for every consumer, so any window that reads settings also gets correct
// translations automatically.
export function useAppSettings({
	live = false,
}: Props = {}): [Settings, React.Dispatch<React.SetStateAction<Settings>>] {
	const [settings, setSettings] = useState<Settings>(INITIAL)

	useEffect(() => {
		window.electron.getSettings().then((next) => {
			setLocale(next.uiLanguage || DEFAULT_LOCALE)
			setSettings(next)
		})
	}, [])

	useEffect(() => {
		if (!live) return
		const off = window.electron.on('settings-changed', (next) => {
			setLocale(next.uiLanguage || DEFAULT_LOCALE)
			setSettings(next)
		})
		return () => off()
	}, [live])

	return [settings, setSettings]
}
