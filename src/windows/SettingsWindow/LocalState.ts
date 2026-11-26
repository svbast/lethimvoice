import { useCallback, useEffect, useState } from 'react'
import type { Asset, Events } from '../../../electron/ipc/broadcast'
import type { Kind } from '../../../electron/runtime/models'
import type { SetupState } from '../../../electron/runtime/setup'
import { errorHint, type TFn } from '../../i18n'
import type { EngineVariant, LocalStatus, Progress } from './LocalFormat'

// The Local tab's state: main's status and setup, every download, the model
// choices in flight, and the settings it saves.

interface LlmChoice {
	enabled: boolean
	model: string
}
export interface SettingsPatch {
	backend?: string
	computeMode?: string
	localIdleMinutes?: number
	localLlm?: LlmChoice
	localStt?: { model: string }
}
export interface LocalPrefs extends SettingsPatch {
	shortcut?: string
}
export interface RuntimeMessage {
	kind: 'busy' | 'ok' | 'bad'
	text: string
}
/** A model choice whose download failed, said under the choice and on its tile. */
interface ChoiceError {
	id: string
	error: string
}
type FetchAsset = (
	kind: Asset,
	id: string,
) => Promise<{ ok: boolean; error?: string }>
export type Local = ReturnType<typeof useLocal>

// The tile each choice in flight belongs to, so its engine download shows there.
// Module scope, not state: the tab remounts on every tab switch while the
// download runs on in main, and the remounted tile must still claim it.
let picking: Partial<Record<Kind, string>> = {}

export const engineOf = (status: LocalStatus | null, kind: Kind) =>
	status?.engines.variants[kind === 'stt' ? 'whisper' : 'llama']
const onDisk = (status: LocalStatus | null, kind: Kind, id: string) =>
	Boolean(status?.models[kind].find((m) => m.id === id)?.installed)
const cancel = (kind: Asset, id: string): void => {
	window.electron.cancelDownload(kind, id)
}

/** Everything the Local tab works with. */
export function useLocal(
	settings: LocalPrefs,
	onSave: (patch: SettingsPatch) => void,
	t: TFn,
) {
	const { refresh, setup, status } = useLocalStatus()
	const runtimeMsg = useRuntimeMessage(t, refresh)
	const downloads = useDownloads(refresh)
	const choices = useChoices(status, downloads.fetchAsset)
	const prefs = usePrefs(settings, onSave)
	const { llm, save, setLlm, sttModel } = prefs
	const pickStt = (id: string) =>
		choices.choose('stt', id, () => save({ localStt: { model: id } }))
	async function remove(kind: Asset, id: string): Promise<void> {
		await window.electron.deleteAsset(kind, id)
		// The chosen model is gone: fall back to another one on disk.
		const other =
			kind !== 'engine' &&
			status?.models[kind].find((m) => m.installed && m.id !== id)
		if (other && kind === 'stt' && sttModel === id)
			save({ localStt: { model: other.id } })
		if (other && kind === 'llm' && llm.model === id) setLlm({ model: other.id })
		refresh()
	}
	return {
		...downloads,
		...choices,
		...prefs,
		cancel,
		pickStt,
		// Local mode needs its speech engine and model on disk.
		ready: Boolean(
			engineOf(status, 'stt')?.installed && onDisk(status, 'stt', sttModel),
		),
		refresh,
		remove,
		runtimeMsg,
		setup,
		status,
	}
}

/** The status from main, and the one-button setup, which runs there too. */
function useLocalStatus() {
	const [status, setStatus] = useState<LocalStatus | null>(null)
	const [setup, setSetup] = useState<SetupState | null>(null)
	const refresh = useCallback<() => void>(() => {
		window.electron.getLocalStatus().then((s) => {
			setStatus(s)
			setSetup(s.setup)
		})
	}, [])
	useEffect(() => {
		refresh()
		// The setup runs in main: its state survives this tab.
		const off = window.electron.on('local-setup', (s) => {
			setSetup(s)
			if (s.phase !== 'running') refresh()
		})
		return () => off()
	}, [refresh])
	return { refresh, setup, status }
}

/** Every download's progress and last error, by "kind:id" (engines too). */
function useDownloads(refresh: () => void) {
	const [progress, setProgress] = useState<Record<string, Progress>>({})
	const [rowError, setRowError] = useState<Record<string, string>>({})
	// Progress AND the result of every download: still arrives after this tab was
	// remounted mid-download. A failure stays on its own row.
	useEffect(() => {
		const off = window.electron.on('progress', (ev) => {
			const key = `${ev.kind}:${ev.id}`
			if (!ev.done) {
				const { phase, received, total } = ev
				setProgress((p) => ({ ...p, [key]: { phase, received, total } }))
				return
			}
			setProgress(({ [key]: _done, ...rest }) => rest)
			const { error } = ev
			if (error && error !== 'cancelled')
				setRowError((e) => ({ ...e, [key]: error }))
			refresh()
		})
		return () => off()
	}, [refresh])
	// Resolves with the download's result; progress and errors reach the rows
	// through the event above.
	const fetchAsset: FetchAsset = (kind, id) => {
		const key = `${kind}:${id}`
		setRowError(({ [key]: _old, ...rest }) => rest)
		setProgress((p) => ({ ...p, [key]: { received: 0, total: 0 } }))
		return window.electron.downloadAsset(kind, id)
	}
	return { fetchAsset, progress, rowError }
}

/** Models loading into memory or leaving it, and how that went. */
function useRuntimeMessage(t: TFn, refresh: () => void) {
	const [msg, setMsg] = useState<RuntimeMessage | null>(null)
	// Local runtime is loading/releasing models (VRAM) after a backend/compute change.
	useEffect(() => {
		const off = window.electron.on('local-runtime', (ev) => {
			setMsg(runtimeMessage(ev, t))
			if (ev.phase === 'done') refresh()
		})
		return () => off()
	}, [t, refresh])
	// Auto-clear transient confirmations; errors linger longer so they're not missed.
	useEffect(() => {
		if (!msg || msg.kind === 'busy') return
		const id = setTimeout(() => setMsg(null), msg.kind === 'bad' ? 8000 : 2500)
		return () => clearTimeout(id)
	}, [msg])
	return msg
}

// Choosing a model that is not on disk downloads it first. The current choice
// stays until the new one is installed, and for good if that fails; the failure
// is said under the choice.
function useChoices(status: LocalStatus | null, fetchAsset: FetchAsset) {
	const [choiceError, setChoiceError] = useState<
		Partial<Record<Kind, ChoiceError>>
	>({})
	// Re-renders when a choice starts or ends; the value lives in `picking`.
	const [, setPicked] = useState(picking)
	const own = (next: Partial<Record<Kind, string>>) => {
		picking = next
		setPicked(next)
	}
	async function choose(kind: Kind, id: string, apply: () => void) {
		setChoiceError(({ [kind]: _old, ...rest }) => rest)
		own({ ...picking, [kind]: id })
		const error = await ensureOnDisk(
			fetchAsset,
			engineOf(status, kind),
			onDisk(status, kind, id) ? null : { id, kind },
		)
		// A later choice of the same kind owns the tile by now: leave it.
		if (picking[kind] === id) {
			const { [kind]: _done, ...rest } = picking
			own(rest)
		}
		if (!error) apply()
		else if (error !== 'cancelled')
			setChoiceError((e) => ({ ...e, [kind]: { error, id } }))
	}
	return { choiceError, choose, picking }
}

/** The settings this tab reads, and the setters that save them. */
function usePrefs(settings: LocalPrefs, save: (patch: SettingsPatch) => void) {
	// Main sends every one of these (DEFAULTS in electron/store/settings.ts), so no
	// default is repeated here. The empty fallbacks only cover the moment before the
	// app-state snapshot lands: they match no model, so `ready` stays false and the
	// cards that tune local mode stay hidden until it does.
	const llm = settings.localLlm ?? { enabled: false, model: '' }
	const setLlm = (patch: Partial<LlmChoice>) =>
		save({ localLlm: { ...llm, ...patch } })
	return {
		compute: settings.computeMode ?? '',
		idle: settings.localIdleMinutes,
		llm,
		/** Local mode is the one running. */
		local: settings.backend === 'local',
		save,
		setLlm,
		sttModel: settings.localStt?.model ?? '',
	}
}

// The line under the setup while models load into memory or leave it.
function runtimeMessage(
	ev: Events['local-runtime'],
	t: TFn,
): RuntimeMessage | null {
	if (ev.phase === 'applying')
		return {
			kind: 'busy',
			text: t(ev.load.length > 0 ? 'local.loading' : 'local.releasing'),
		}
	const error = ev.failed[0]?.error ?? ev.error
	if (error)
		return {
			kind: 'bad',
			text: `${t('local.loadFailed')} — ${errorHint(error)}`,
		}
	if (ev.started.length > 0) return { kind: 'ok', text: t('local.loaded') }
	if (ev.stopped.length > 0) return { kind: 'ok', text: t('local.released') }
	return null
}

// Engine, then model (null = already on disk) for a choice, downloading whatever is
// missing; the error when a download failed or was cancelled.
async function ensureOnDisk(
	fetchAsset: FetchAsset,
	engine: EngineVariant | undefined,
	model: { kind: Kind; id: string } | null,
): Promise<string | undefined> {
	if (engine?.id && !engine.installed) {
		const r = await fetchAsset('engine', engine.id)
		if (!r.ok) return r.error ?? 'failed'
	}
	if (!model) return undefined
	const r = await fetchAsset(model.kind, model.id)
	return r.ok ? undefined : (r.error ?? 'failed')
}
