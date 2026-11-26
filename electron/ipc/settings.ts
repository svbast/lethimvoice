import { applySettings, scheduleRuntimeSync } from '../applySettings'
import { getAutostart } from '../autostart'
import { modelStatus, testApiKey } from '../pipeline/cloud'
import * as servers from '../runtime/servers'
import { status } from '../shortcuts'
import { loadSettings, type Settings } from '../store/settings'
import { sendToRecording } from '../windows'
import type { Handler } from '.'

export const handlers = {
	// Everything the settings window needs at mount, in one round-trip.
	// `status()` awaits backend selection, which startup already kicked off — so
	// this is a settled promise by the time any window opens. The pill keeps using
	// get-settings: it must never wait on that selection.
	'get-app-state': async () => ({
		autostart: getAutostart(),
		settings: loadSettings(),
		shortcut: await status(),
	}),

	'get-model-status': () => modelStatus(),
	'get-settings': () => loadSettings(),
	// "Retry GPU" after a server fell back to CPU: same models, GPU arguments again.
	'retry-gpu': () => {
		servers.retryGpu()
		scheduleRuntimeSync(loadSettings())
	},

	'save-settings': (_e, patch: Partial<Settings>) => {
		const merged = applySettings(patch)
		sendToRecording('settings-changed', merged)
		return merged
	},
	'test-api-key': (_e, apiKey: string) => testApiKey(apiKey),
} satisfies Record<string, Handler>
