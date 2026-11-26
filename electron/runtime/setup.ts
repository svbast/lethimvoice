import type { Asset } from '../ipc/broadcast'
import type { ProgressFn } from './downloader'

export interface SetupAsset {
	kind: Asset
	id: string
	bytes: number
}

/** Speech first, then text cleanup; `apply` switches each on once its files are in. */
export interface SetupPart {
	step: 'stt' | 'llm'
	assets: SetupAsset[]
	apply: () => void
}

export interface SetupState {
	phase: 'idle' | 'running' | 'done' | 'failed'
	/** Part being downloaded; on failure, the part that failed. */
	step?: SetupPart['step']
	/** Bytes of the whole setup, so the Local tab shows one bar for all files. */
	received: number
	total: number
	verifying?: boolean
	error?: string
}

interface Deps {
	download: (
		asset: SetupAsset,
		onProgress: ProgressFn,
	) => Promise<{ ok: boolean; error?: string }>
	cancel: (asset: SetupAsset) => void
	publish: (state: SetupState) => void
}

// The one-button setup of local mode. It lives in main, not in the Local tab: the
// tab remounts on every tab switch, and a promise chain there would lose the
// progress, the failure and the "done" moment.
export const createSetup = ({ download, cancel, publish }: Deps) => {
	let state: SetupState = { phase: 'idle', received: 0, total: 0 }
	let current: SetupAsset | null = null
	let stopped = false
	const set = (patch: Partial<SetupState>) => {
		state = { ...state, ...patch }
		publish(state)
	}

	// Downloads part by part, switching each on once its files are in; the end state.
	const run = async (parts: SetupPart[]): Promise<Partial<SetupState>> => {
		let done = 0
		for (const part of parts) {
			for (const asset of part.assets) {
				if (stopped) return { phase: 'idle' }
				current = asset
				set({ step: part.step, verifying: false })
				const base = done
				const result = await download(asset, (received, _total, phase) =>
					set({ received: base + received, verifying: phase === 'verifying' }),
				)
				current = null
				// A cancel from the setup card or from the asset's own row: no error.
				if (stopped || result.error === 'cancelled') return { phase: 'idle' }
				if (!result.ok) return { error: result.error, phase: 'failed' }
				done += asset.bytes
			}
			part.apply()
		}
		return { phase: 'done', received: done }
	}

	return {
		cancel() {
			if (state.phase !== 'running') return
			stopped = true
			if (current) cancel(current)
		},

		/** Closes the "ready" or "failed" message. */
		dismiss() {
			if (state.phase === 'done' || state.phase === 'failed')
				set({ error: undefined, phase: 'idle' })
		},

		async start(parts: SetupPart[]) {
			if (state.phase === 'running') return
			stopped = false
			set({
				error: undefined,
				phase: 'running',
				received: 0,
				step: parts[0]?.step,
				total: parts.flatMap((p) => p.assets).reduce((n, a) => n + a.bytes, 0),
				verifying: false,
			})
			// Whatever ends the run (a throw included) leaves "running": a setup stuck
			// there would hide its own button for good.
			const end = await run(parts).catch(
				(e: Error): Partial<SetupState> => ({
					error: e.message || 'failed',
					phase: 'failed',
				}),
			)
			current = null
			set({ ...end, verifying: false })
		},
		state: () => state,
	}
}
