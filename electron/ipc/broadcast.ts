import { BrowserWindow, type WebContents } from 'electron'
import type { modelStatus } from '../pipeline/cloud'
import type { Kind } from '../runtime/models'
import type { ReconcileResult } from '../runtime/servers'
import type { SetupState } from '../runtime/setup'
import type { HistoryItem } from '../store/history'
import type { Settings } from '../store/settings'
import type { UpdateState } from '../updater'

/** Downloadable asset: a model of either kind, or an engine build. */
export type Asset = Kind | 'engine'

export interface Events {
	'history-added': HistoryItem
	'local-runtime':
		| { phase: 'applying'; load: Kind[]; release: Kind[] }
		| ({ phase: 'done'; error?: string } & ReconcileResult)
	/** A request waits for its local model to load (the pill says so). */
	'model-loading': undefined
	/** The one-button setup of local mode (runtime/setup.ts). */
	'local-setup': SetupState
	/** Groq model chains after a dictation walked one (Online tab indicator). */
	'models-changed': ReturnType<typeof modelStatus>
	/**
	 * Download progress; `done` closes it with the result. The Local tab reads the
	 * result from here, not from its own downloadAsset call: that tab may have been
	 * remounted since.
	 */
	progress: {
		kind: Asset
		id: string
		received: number
		total: number
		phase?: 'verifying'
		done?: boolean
		error?: string
	}
	'settings-changed': Settings
	/** 'aborted': modifier-only shortcut became a chord; cancel the recording. */
	shortcut: 'pressed' | 'released' | 'aborted'
	/** Linux portal: what the compositor bound, as it describes it. */
	'shortcut-bound': string | undefined
	'should-hide': undefined
	'update-state': UpdateState
	'window-shown': undefined
}

export type Payload<C extends keyof Events> = Events[C] extends undefined
	? []
	: [Events[C]]

export const send = <C extends keyof Events>(
	target: WebContents,
	channel: C,
	...payload: Payload<C>
) => target.send(channel, ...payload)

export const broadcast = <C extends keyof Events>(
	channel: C,
	...payload: Payload<C>
) => {
	for (const w of BrowserWindow.getAllWindows()) {
		if (!w.isDestroyed()) send(w.webContents, channel, ...payload)
	}
}
