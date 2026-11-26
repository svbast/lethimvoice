import type { Asset, Events } from '../../../electron/ipc/broadcast'
import type { Api } from '../../../electron/preload'
import type { TFn } from '../../i18n'
import type { TileFx } from '../../pixel/local'

// Shared by the Local tab's parts.

export type LocalStatus = Awaited<ReturnType<Api['getLocalStatus']>>
export type ModelStatus = LocalStatus['models']['stt'][number]
/** One engine build (whisper.cpp or llama.cpp) for this machine. */
export type EngineVariant = LocalStatus['engines']['variants'][string]
/** One download as the 'progress' event brings it. */
export type Progress = Pick<Events['progress'], 'phase' | 'received' | 'total'>
/** What a model tile shows, and while downloading the file coming in now: its
 * model, or the engine it needs first. */
export interface TileView {
	state: TileFx
	asset?: Asset
	id?: string
	prog?: Progress
}

/** "3.1 GB", "574 MB"; empty while the size is unknown. */
export const fmtBytes = (b?: number): string => {
	if (!b) return ''
	const gb = b / 1e9
	if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`
	return `${Math.round(b / 1e6)} MB`
}

/** Percent of a download; null until its size is known. */
export const pctOf = (prog?: Progress): number | null =>
	prog?.total
		? Math.min(100, Math.round((prog.received / prog.total) * 100))
		: null

// What an engine build runs on, written the way its vendor writes it.
const ACCEL: Record<string, string> = {
	cpu: 'CPU',
	cuda: 'CUDA',
	metal: 'Metal',
	vulkan: 'Vulkan',
}
export const accelLabel = (accel: string): string => ACCEL[accel] ?? accel

/** "Downloading… 42 %", then "Verifying…" while the file is hashed. */
export const dlLabel = (t: TFn, prog?: Progress): string => {
	if (prog?.phase === 'verifying') return t('local.verifying')
	const pct = pctOf(prog)
	return pct === null
		? t('local.downloading')
		: `${t('local.downloading')} ${pct} %`
}
