import type { Kind } from '../../../electron/runtime/models'
import PixelIcon from '../../components/PixelIcon'
import { errorHint, type Key, type TFn } from '../../i18n'
import { useTileCanvas } from '../../pixel/local'
import {
	fmtBytes,
	type ModelStatus,
	type Progress,
	pctOf,
	type TileView,
} from './LocalFormat'

interface TileProps {
	/** Position in the grid: offsets the field, so neighbours differ. */
	n: number
	kind: Kind
	model: ModelStatus
	view: TileView
	recommended: boolean
	error?: string
	onPick: () => void
	onCancel: () => void
	/** Absent for the model in use. */
	onDelete?: () => void
	t: TFn
}

// The catalog's own notes are terse English; the tiles say it plainly.
const NOTE: Record<string, Key> = {
	base: 'local.setup.tile.base',
	'gemma-4-e2b': 'local.setup.tile.gemma',
	'large-v3': 'local.setup.tile.large',
	'large-v3-turbo-q5_0': 'local.setup.tile.turbo',
}

// One model: a pixel field on top that shows its state, then name, size, action.
export default function LocalTile(props: TileProps) {
	const { error, kind, model, view, t } = props
	const pct = pctOf(view.prog)
	const ref = useTileCanvas(view.state, (pct ?? 0) / 100, props.n)
	const note = NOTE[model.id]
	return (
		<div className='local-tile'>
			<div className='local-top'>
				<canvas className='local-fx' ref={ref} />
				<span className='local-kick'>
					{t(kind === 'stt' ? 'local.setup.tile.stt' : 'local.setup.tile.llm')}
				</span>
				{props.recommended && (
					<span className='badge local-badge'>
						{t('local.setup.recommended')}
					</span>
				)}
			</div>
			<div className='local-body'>
				<span className='local-name'>{model.label}</span>
				<span className='text-sm muted'>
					{fmtBytes(model.bytes)} · {note ? t(note) : model.note}
				</span>
				<div className='local-act'>
					<TileAction {...props} pct={pct} />
				</div>
				{error && view.state !== 'dl' && (
					<span className='text-sm local-bad'>
						{t('local.downloadFailed')} — {errorHint(error)}
					</span>
				)}
			</div>
		</div>
	)
}

// The tile's status line: Download, Queued, the download itself, or Installed.
function TileAction({
	view,
	pct,
	onPick,
	onCancel,
	onDelete,
	t,
}: TileProps & { pct: number | null }) {
	if (view.state === 'idle')
		return (
			<button
				className='btn btn-outline local-mini'
				onClick={onPick}
				type='button'
			>
				<PixelIcon className='pxi-ctl' name='download' />
				{t('local.download')}
			</button>
		)
	if (view.state === 'queue')
		return <span className='text-sm muted'>{t('local.setup.queued')}</span>
	if (view.state === 'dl')
		return <TileProgress onCancel={onCancel} pct={pct} prog={view.prog} t={t} />
	return (
		<div className='hstack between'>
			<span className='hstack gap-1 text-sm local-ok'>
				<PixelIcon className='pxi-ctl' name='check' />
				{t('local.installed')}
			</span>
			{onDelete && (
				<button
					aria-label={t('common.delete')}
					className='btn btn-ghost local-mini local-x'
					onClick={onDelete}
					type='button'
				>
					<PixelIcon className='pxi-ctl' name='trash' />
				</button>
			)}
		</div>
	)
}

// "42 % · 0.24 GB" under a thin bar, then "Verifying…" while the file is hashed.
function TileProgress({
	pct,
	prog,
	onCancel,
	t,
}: {
	pct: number | null
	prog?: Progress
	onCancel: () => void
	t: TFn
}) {
	return (
		<div className='stack gap-1'>
			<div className='progress progress-live local-prog'>
				<div className='progress-bar' style={{ width: `${pct ?? 0}%` }} />
			</div>
			<div className='hstack between'>
				<span className='text-sm muted tabular'>
					{prog?.phase === 'verifying'
						? t('local.verifying')
						: `${pct ?? 0} % · ${((prog?.received ?? 0) / 1e9).toFixed(2)} GB`}
				</span>
				<button
					aria-label={t('common.cancel')}
					className='btn btn-ghost local-mini local-x'
					onClick={onCancel}
					type='button'
				>
					<PixelIcon className='pxi-ctl' name='x' />
				</button>
			</div>
		</div>
	)
}
