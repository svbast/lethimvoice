import { broadcast } from './ipc/broadcast'
import * as servers from './runtime/servers'
import { setShortcut } from './shortcuts'
import { loadSettings, type Settings, saveSettings } from './store/settings'
import { refreshTray } from './tray'

// Debounce runtime sync: rapid backend/compute toggles thrash model load↔unload.
// Only final state applies ~700 ms after last change; UI notified on start +
// changed models.
let runtimeTimer: NodeJS.Timeout | undefined
const RUNTIME_DEBOUNCE_MS = 700
export const scheduleRuntimeSync = (settings: Settings) => {
	clearTimeout(runtimeTimer)
	// `pending()` = what reconcile will do, so UI says "loading" vs "releasing"
	// before debounced apply runs. Only when something will load or stop: a save
	// that changes no server shows no spinner.
	servers.pending(settings).then(({ load, release }) => {
		if (load.length > 0 || release.length > 0)
			broadcast('local-runtime', { load, phase: 'applying', release })
	})
	runtimeTimer = setTimeout(async () => {
		runtimeTimer = undefined
		try {
			servers.runtimeDone(await servers.reconcile(settings))
		} catch (e) {
			servers.runtimeDone({ error: (e as Error).message })
		}
	}, RUNTIME_DEBOUNCE_MS)
}

const TRAY_KEYS = ['activeModeId', 'language', 'modes', 'uiLanguage'] as const

// Stores a settings change and applies its side effects. The caller tells the
// windows: a save from the Settings window only the pill, a change made in main
// (local setup) every window.
export const applySettings = (patch: Partial<Settings>): Settings => {
	const previous = loadSettings()
	const merged = { ...previous, ...patch }
	saveSettings(merged)
	if (patch.shortcut && patch.shortcut !== previous.shortcut)
		setShortcut(patch.shortcut)
	// The tray lists modes and languages with the current ones checked. Deferred:
	// a pick in the tray lands here from inside that menu's click.
	if (TRAY_KEYS.some((k) => k in patch)) setImmediate(refreshTray)

	// New compute mode = new server arguments: the sync below restarts each server
	// once its dictation is done. A GPU that failed earlier gets another chance.
	if (patch.computeMode && patch.computeMode !== previous.computeMode)
		servers.retryGpu()
	// Reconcile local runtime to new settings (debounced): pre-load models so first
	// dictation skips cold load; release VRAM/RAM for servers no longer needed
	// (e.g. local→cloud).
	scheduleRuntimeSync(merged)
	return merged
}
