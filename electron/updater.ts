import { autoUpdater } from 'electron-updater'

import { broadcast } from './ipc/broadcast'
import { loadSettings } from './store/settings'
import { config } from './utils/config'

/**
 * What About and the tray show. `manual`: this copy cannot update itself (a dev
 * run, a .tar.gz); `available`: a newer version this copy cannot install (the
 * portable exe). Both send the user to the releases page, and so does `error`.
 */
export interface UpdateState {
	phase:
		| 'idle'
		| 'checking'
		| 'latest'
		| 'downloading'
		| 'ready'
		| 'available'
		| 'error'
		| 'manual'
	version?: string
	percent?: number
	checkedAt?: number
}

const FIRST_CHECK_MS = 30_000
const CHECK_EVERY_MS = 6 * 3_600_000

let state: UpdateState = { phase: 'idle' }
let phaseChanged: () => void = () => undefined

const set = (next: Partial<UpdateState>) => {
	const before = state.phase
	state = { ...state, ...next }
	broadcast('update-state', state)
	if (state.phase !== before) phaseChanged()
}

export const updateState = () => state

export const checkForUpdate = async () => {
	// A download under way or one waiting for its restart: a new check would only
	// hide the restart button behind "checking".
	if (['downloading', 'ready', 'manual'].includes(state.phase)) return
	try {
		await autoUpdater.checkForUpdates()
	} catch {
		/* the 'error' event has set the state */
	}
}

// Silent, then starts the new version: the installer asks nothing it asked the
// first time.
export const installUpdate = () => {
	if (state.phase === 'ready') autoUpdater.quitAndInstall(true, true)
}

// Known limit: a download may overlap a dictation; it only shares the bandwidth.
export const startUpdater = (onPhaseChange: () => void) => {
	phaseChanged = onPhaseChange
	if (!autoUpdater.isUpdaterActive()) {
		set({ phase: 'manual' })
		return
	}
	// The portable exe would download the installer, which installs a second copy.
	autoUpdater.autoDownload = !config.portableExe
	autoUpdater.on('checking-for-update', () => set({ phase: 'checking' }))
	autoUpdater.on('update-not-available', () =>
		set({ checkedAt: Date.now(), phase: 'latest' }),
	)
	autoUpdater.on('update-available', ({ version }) =>
		set({
			checkedAt: Date.now(),
			percent: 0,
			phase: config.portableExe ? 'available' : 'downloading',
			version,
		}),
	)
	autoUpdater.on('download-progress', ({ percent }) => {
		const whole = Math.floor(percent)
		if (whole !== state.percent) set({ percent: whole })
	})
	autoUpdater.on('update-downloaded', ({ version }) =>
		set({ phase: 'ready', version }),
	)
	// Never fatal: offline, a release still uploading, an unsigned Mac build.
	autoUpdater.on('error', (e) => {
		console.error('[updater]', e)
		set({ checkedAt: Date.now(), phase: 'error' })
	})
	const auto = () => {
		if (loadSettings().autoUpdate) checkForUpdate()
	}
	setTimeout(auto, FIRST_CHECK_MS)
	setInterval(auto, CHECK_EVERY_MS)
}
