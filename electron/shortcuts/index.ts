import { notify } from '../i18n'
import { config } from '../utils/config'
import type * as XdgPortal from '../xdg-portal.linux'

// Press/release because the edges are shortcut-level, as in every API that binds
// a whole shortcut (portal Activated/Deactivated, Tauri Pressed/Released); only
// uiohook's raw-key layer speaks keydown/keyup. onAbort: a modifier-only
// shortcut turned out to be a chord.
export interface ShortcutHandlers {
	onPress: () => void
	onRelease: () => void
	onAbort?: () => void
}

type BackendName = 'none' | 'portal' | 'uiohook'

interface Backend {
	setShortcut: (shortcut: string | undefined) => void
	setCaptureMode?: (enabled: boolean) => void
	bind: (handlers: ShortcutHandlers) => void | Promise<void>
	rebind: () => void
	unbind: () => void
	/** Portal only: what the compositor bound, as it describes it. */
	trigger?: () => string | undefined
	configure?: () => Promise<void>
}

let selected: Backend | null = null
let selectedName: BackendName = 'none'
let selection: Promise<void> | null = null
let configuredShortcut: string | undefined
let captureMode = false

const selectBackend = async (): Promise<Backend> => {
	if (process.platform === 'linux' && config.wayland) {
		try {
			const xdgPortal: typeof XdgPortal = require('../xdg-portal.linux')
			const client = await xdgPortal.portal()
			if (await client.hasInterface('GlobalShortcuts')) {
				selectedName = 'portal'
				return require('./portal.linux')
			}
		} catch {
			/* portal unreachable; fall through to uiohook warning below */
		}
		notify('shortcutDead')
	}
	selectedName = 'uiohook'
	return require(process.platform === 'win32' ? './uiohook.win' : './uiohook')
}

export const setShortcut = (shortcut: string | undefined) => {
	configuredShortcut = shortcut
	selected?.setShortcut(shortcut)
}

export const setCaptureMode = (enabled: boolean) => {
	captureMode = enabled
	selected?.setCaptureMode?.(enabled)
}

export const bind = (handlers: ShortcutHandlers) => {
	if (selection) return
	selection = selectBackend()
		.then(async (backend) => {
			selected = backend
			backend.setShortcut(configuredShortcut)
			backend.setCaptureMode?.(captureMode)
			await backend.bind(handlers)
		})
		.catch(() => {
			// Backend stays selected so rebind (resume/unlock) retries the bind.
			notify('shortcutDead')
		})
}

export const rebind = () => {
	selected?.rebind()
}

export const unbind = () => {
	selected?.unbind()
}

export const status = async () => {
	await selection
	return { backend: selectedName, trigger: selected?.trigger?.() }
}

export const configure = async (): Promise<void> => {
	await selected?.configure?.()
}
