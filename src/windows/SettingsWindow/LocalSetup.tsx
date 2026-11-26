import type { RefObject } from 'react'
import type { Kind } from '../../../electron/runtime/models'
import type { SetupState } from '../../../electron/runtime/setup'
import PixelIcon from '../../components/PixelIcon'
import { withShortcut } from '../../components/withShortcut'
import { errorHint, type TFn } from '../../i18n'
import { shortcutKeys } from '../../utils/keyCode'
import {
	accelLabel,
	type EngineVariant,
	fmtBytes,
	type LocalStatus,
	type ModelStatus,
	type TileView,
} from './LocalFormat'
import { engineOf, type Local } from './LocalState'
import LocalTile from './LocalTile'

interface Props {
	lt: Local
	status: LocalStatus
	setup: SetupState
	/** The user's shortcut, e.g. "CtrlRight". */
	shortcut?: string
	/** The setup button: the Offline switch points here before setup. */
	startRef: RefObject<HTMLButtonElement | null>
	t: TFn
}
interface HeadProps {
	setup: SetupState
	bytes: number
	/** The setup downloads speech, then text cleanup. */
	twoParts: boolean
	startRef: RefObject<HTMLButtonElement | null>
	t: TFn
}
/** One tile's inputs, for working out what it shows. */
interface TileIn {
	kind: Kind
	m: ModelStatus
	lt: Local
	setup: SetupState
	status: LocalStatus
}

const act = (action: 'start' | 'cancel' | 'dismiss') => () =>
	window.electron.localSetup(action)
const NVIDIA = /nvidia/iu

// The first thing a new user sees in the Local tab: a tile per model, the
// recommended pair marked, one button for that pair. The setup runs in main, so
// its progress, failure and result outlive a tab switch. Once speech is set up the
// card shows only a running or finished setup.
export default function LocalSetup(props: Props) {
	const { lt, setup, status, t } = props
	if (lt.ready && setup.phase === 'idle') return null
	const rec = status.recommendation
	// No speech engine for this machine: nothing here could ever run.
	if (
		rec.grade === 'unsupported' ||
		!status.engines.variants.whisper?.supported
	)
		return <Unavailable mac={rec.grade === 'unsupported'} t={t} />
	const keys = shortcutKeys(props.shortcut, window.electron.platform)
	return (
		<section className='card stack gap-3 local-setup'>
			<div className='hstack between gap-3'>
				<div className='row-text'>
					<span className='card-title'>{t('local.setup.title')}</span>
					<span className='desc'>{machineLine(status, t)}</span>
				</div>
				<div className='local-head'>
					<Head
						bytes={setupBytes(status)}
						setup={setup}
						startRef={props.startRef}
						t={t}
						twoParts={Boolean(rec.llm)}
					/>
				</div>
			</div>
			{setup.phase === 'failed' && <FailedLine setup={setup} t={t} />}
			<div className='local-grid'>
				<Tiles lt={lt} setup={setup} status={status} t={t} />
				<span className='text-sm muted local-note'>
					{setup.phase === 'done'
						? withShortcut(t('local.setup.doneDesc'), keys)
						: setupNote(status, t)}
				</span>
			</div>
		</section>
	)
}

function Unavailable({ mac, t }: { mac: boolean; t: TFn }) {
	return (
		<section className='card stack gap-1 local-setup'>
			<span className='card-title'>{t('local.setup.unavailable')}</span>
			<span className='desc'>
				{t(mac ? 'local.setup.mac' : 'local.unsupported')}
			</span>
		</section>
	)
}

function FailedLine({ setup, t }: { setup: SetupState; t: TFn }) {
	return (
		<span className='hstack gap-1 text-sm local-bad'>
			<PixelIcon className='pxi-ctl' name='close' />
			{t(
				setup.step === 'llm' ? 'local.setup.failedLlm' : 'local.setup.failed',
				{
					reason: errorHint(setup.error),
				},
			)}
		</span>
	)
}

// The tiles: every speech model, the recommended one first, then text cleanup.
function Tiles({
	lt,
	setup,
	status,
	t,
}: Omit<TileIn, 'kind' | 'm'> & { t: TFn }) {
	const rec = status.recommendation
	const stt = [...status.models.stt].sort(
		(a, b) => Number(b.id === rec.stt) - Number(a.id === rec.stt),
	)
	const tiles = [
		...stt.map((m) => ({ kind: 'stt' as const, m })),
		...status.models.llm.map((m) => ({ kind: 'llm' as const, m })),
	]
	// Models in use: their tiles offer no delete (Advanced asks before that).
	const inUse = { llm: lt.llm.enabled ? lt.llm.model : '', stt: lt.sttModel }
	return (
		<>
			{tiles.map(({ kind, m }, n) => {
				const v = tileView({ kind, lt, m, setup, status })
				return (
					<LocalTile
						error={tileError(lt, kind, m.id)}
						key={`${kind}:${m.id}`}
						kind={kind}
						model={m}
						n={n}
						onCancel={() => v.asset && v.id && lt.cancel(v.asset, v.id)}
						onDelete={
							inUse[kind] === m.id ? undefined : () => lt.remove(kind, m.id)
						}
						onPick={() => pickTile(lt, kind, m.id)}
						// The badge marks only the cleanup pick: the speech pick is first in the
						// row and the button downloads it anyway.
						recommended={kind === 'llm' && rec.llm === m.id}
						t={t}
						view={v}
					/>
				)
			})}
		</>
	)
}

// A tile: speech becomes the chosen model, cleanup is also switched on.
function pickTile(lt: Local, kind: Kind, id: string) {
	if (kind === 'stt') lt.pickStt(id)
	else lt.choose('llm', id, () => lt.setLlm({ enabled: true, model: id }))
}

// The tile's own failed download, or its failed choice (the engine first).
function tileError(lt: Local, kind: Kind, id: string): string | undefined {
	const choice = lt.choiceError[kind]
	return (
		lt.rowError[`${kind}:${id}`] ??
		(choice?.id === id ? choice.error : undefined)
	)
}

// Each tile follows its own files: the setup's current part, a choice in flight,
// or a download from Advanced all show here.
function tileView(v: TileIn): TileView {
	const { kind, m, setup, status } = v
	const dl = downloading(v)
	if (dl) return dl
	const engine = engineOf(status, kind)
	// The setup's own part, also before its first bytes arrive.
	if (setupOwns(v, engine) && setup.step === kind)
		return engine?.id && !engine.installed
			? { asset: 'engine', id: engine.id, state: 'dl' }
			: { asset: kind, id: m.id, state: 'dl' }
	// The cleanup part waits for the speech part. main's setup has no way to
	// drop one part, so a queued tile offers no cancel: "Cancel all" does.
	if (setupOwns(v, engine) && setup.step === 'stt') return { state: 'queue' }
	return { state: m.installed ? 'done' : 'idle' }
}

// A file coming in for the tile: its model, or the engine its choice needs first.
function downloading({ kind, m, lt, setup, status }: TileIn): TileView | null {
	const engine = engineOf(status, kind)
	const running = setup.phase === 'running' && setup.step === kind
	const owner = running ? status.recommendation[kind] : lt.picking[kind]
	const model = lt.progress[`${kind}:${m.id}`]
	if (model) return { asset: kind, id: m.id, prog: model, state: 'dl' }
	const eng = lt.progress[`engine:${engine?.id}`]
	if (owner === m.id && engine?.id && eng)
		return { asset: 'engine', id: engine.id, prog: eng, state: 'dl' }
	return m.downloading ? { asset: kind, id: m.id, state: 'dl' } : null
}

// The running setup downloads this tile's model, which still misses a file.
function setupOwns(
	{ kind, m, setup, status }: TileIn,
	engine: EngineVariant | undefined,
): boolean {
	return (
		setup.phase === 'running' &&
		status.recommendation[kind] === m.id &&
		!(m.installed && engine?.installed)
	)
}

// The card's corner: the button, the running setup with "Cancel all", or "Ready".
function Head(props: HeadProps) {
	if (props.setup.phase === 'running')
		return (
			<HeadBusy setup={props.setup} t={props.t} twoParts={props.twoParts} />
		)
	if (props.setup.phase === 'done') return <HeadReady t={props.t} />
	return <HeadStart {...props} />
}

function HeadBusy({
	setup,
	twoParts,
	t,
}: Pick<HeadProps, 'setup' | 'twoParts' | 't'>) {
	return (
		<>
			<span className='text-sm muted tabular'>
				{busyLine(setup, twoParts, t)}
			</span>
			<button
				className='btn btn-ghost btn-sm'
				onClick={act('cancel')}
				type='button'
			>
				{t('local.setup.cancelAll')}
			</button>
		</>
	)
}

// "Ready" is a moment: it closes, and the tab shows the settings alone.
function HeadReady({ t }: { t: TFn }) {
	return (
		<>
			<span className='hstack gap-1 local-ok'>
				<PixelIcon className='pxi-ctl' name='check' />
				{t('local.setup.ready')}
			</span>
			<button
				className='btn btn-secondary btn-sm'
				onClick={act('dismiss')}
				type='button'
			>
				{t('local.setup.ok')}
			</button>
		</>
	)
}

// "Download recommended · 4.4 GB", or after a failure "Try again"; a failed text
// cleanup leaves speech working, so that one can also be put off.
function HeadStart({ setup, bytes, startRef, t }: HeadProps) {
	const failed = setup.phase === 'failed'
	const size = fmtBytes(bytes)
	let label = t(failed ? 'local.setup.retry' : 'local.setup.button')
	if (size)
		label = failed ? `${label} · ${size}` : t('local.setup.download', { size })
	return (
		<>
			{failed && setup.step === 'llm' && (
				<button
					className='btn btn-ghost btn-sm'
					onClick={act('dismiss')}
					type='button'
				>
					{t('local.setup.later')}
				</button>
			)}
			<button
				className='btn btn-default btn-sm'
				onClick={act('start')}
				ref={startRef}
				type='button'
			>
				<PixelIcon className='pxi-ctl' name='download' />
				{label}
			</button>
		</>
	)
}

function busyLine(setup: SetupState, twoParts: boolean, t: TFn): string {
	if (setup.verifying) return t('local.verifying')
	if (!twoParts) return t('local.setup.stepStt')
	return t('local.setup.busy', { n: setup.step === 'llm' ? 2 : 1, total: 2 })
}

// "NVIDIA GeForce RTX 3070 (8 GB) · 32 GB RAM"
function machineLine(status: LocalStatus, t: TFn): string {
	const { machine } = status
	const gpu = machine.nvidiaVramGb
		? `${status.engines.gpus.find((g) => NVIDIA.test(g)) ?? 'NVIDIA'} (${Math.round(machine.nvidiaVramGb)} GB)`
		: t('local.setup.noGpu')
	return `${gpu} · ${Math.round(machine.ramGb)} GB RAM`
}

// What the one-button setup would still download, for this machine
// (runtime/recommend.ts): engine + speech model first, then the cleanup model and
// its engine.
function setupBytes(status: LocalStatus): number {
	const rec = status.recommendation
	const missing = (kind: Kind, id: string | null) => {
		const engine = engineOf(status, kind)
		const model = status.models[kind].find((m) => m.id === id)
		if (!model) return 0
		return (
			(engine?.id && !engine.installed ? (engine.bytes ?? 0) : 0) +
			(model.installed ? 0 : model.bytes)
		)
	}
	return missing('stt', rec.stt) + missing('llm', rec.llm)
}

// Under the tiles: what the button does, the engines that come along, and what
// this machine cannot do well.
function setupNote(status: LocalStatus, t: TFn): string {
	const rec = status.recommendation
	const engines = (['whisper', 'llama'] as const)
		.map((k) => status.engines.variants[k])
		.filter((b): b is EngineVariant =>
			Boolean(b?.supported && b.id && !b.installed),
		)
	return [
		t(rec.llm ? 'local.setup.note.pair' : 'local.setup.note.one'),
		engines.length > 0 ? enginesNote(engines, t) : '',
		rec.llm
			? ''
			: `${t('local.setup.llm')}: ${t(`local.setup.noLlm.${rec.llmReason ?? 'memory'}`)}`,
		rec.grade === 'slow' ? t('local.setup.slow') : '',
	]
		.filter(Boolean)
		.join(' ')
}

// "The engines (whisper.cpp for CUDA, llama.cpp for Vulkan, 470 MB) come with the
// first model."
function enginesNote(engines: EngineVariant[], t: TFn): string {
	return t('local.setup.note.engines', {
		engines: engines
			.map((b) =>
				t('local.setup.note.engine', {
					accel: accelLabel(b.accel ?? ''),
					name: `${b.engine}.cpp`,
				}),
			)
			.join(', '),
		size: fmtBytes(engines.reduce((n, b) => n + (b.bytes ?? 0), 0)),
	})
}
