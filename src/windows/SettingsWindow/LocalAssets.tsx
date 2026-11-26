import { useState } from 'react'
import type { Asset } from '../../../electron/ipc/broadcast'
import type { Kind } from '../../../electron/runtime/models'
import PixelIcon from '../../components/PixelIcon'
import { errorHint, type TFn } from '../../i18n'
import { useFlowBar } from '../../pixel/local'
import {
	accelLabel,
	dlLabel,
	type EngineVariant,
	fmtBytes,
	type LocalStatus,
	type ModelStatus,
	type Progress,
	pctOf,
} from './LocalFormat'
import type { Local } from './LocalState'

interface RowHandlers {
	error?: string
	prog?: Progress
	t: TFn
	onDownload: () => void
	onCancel: () => void
	onDelete: () => void
}
interface AssetRowProps extends RowHandlers {
	name: string
	meta: string
	installed: boolean
	downloading: boolean
	/** Asks before deleting: the model in use. */
	confirmDelete?: boolean
}
type RowOf = (kind: Asset, id: string) => RowHandlers
interface Props {
	lt: Local
	status: LocalStatus
	t: TFn
}

// Each row's download, last error and actions, by asset.
const rowsOf =
	(lt: Local, t: TFn): RowOf =>
	(kind, id) => ({
		error: lt.rowError[`${kind}:${id}`],
		onCancel: () => lt.cancel(kind, id),
		onDelete: () => lt.remove(kind, id),
		onDownload: () => lt.fetchAsset(kind, id),
		prog: lt.progress[`${kind}:${id}`],
		t,
	})

// Every engine and model with its own download / cancel / delete, in the Advanced
// card, folded until opened.
export default function LocalAssets({ lt, status, t }: Props) {
	const row = rowsOf(lt, t)
	return (
		<details className='card local-adv'>
			<summary className='row'>
				<span className='label'>{t('local.advanced')}</span>
				<PixelIcon className='pxi-ctl muted local-chev' name='chevronDown' />
			</summary>
			<div className='row-sep stack gap-4 card-pad'>
				<div className='stack gap-2'>
					<span className='text-xs font-medium muted'>
						{t('local.engineRuntime')}
					</span>
					{(['whisper', 'llama'] as const).map((k) => (
						<EngineRow
							engine={status.engines.variants[k]}
							key={k}
							name={k}
							row={row}
							t={t}
						/>
					))}
				</div>
				{(['stt', 'llm'] as const).map((kind) => (
					<ModelSection
						chosen={kind === 'stt' ? lt.sttModel : lt.llm.model}
						key={kind}
						kind={kind}
						models={status.models[kind]}
						row={row}
						t={t}
					/>
				))}
			</div>
		</details>
	)
}

// One engine build: its row, or why there is none for this device.
function EngineRow({
	engine: b,
	name,
	row,
	t,
}: {
	engine?: EngineVariant
	name: string
	row: RowOf
	t: TFn
}) {
	if (!(b?.supported && b.id))
		return (
			<div className='alert hstack between'>
				<span className='stack'>
					<span className='font-medium'>{b?.engine ?? name}</span>
					<span className='desc'>{t('local.unsupported')}</span>
				</span>
			</div>
		)
	return (
		<AssetRow
			downloading={Boolean(b.downloading)}
			installed={Boolean(b.installed)}
			meta={`${fmtBytes(b.bytes)}${b.accel ? ` · ${accelLabel(b.accel)}` : ''}`}
			name={b.label ?? name}
			{...row('engine', b.id)}
		/>
	)
}

// The models of one kind; the one in use asks before it is deleted.
function ModelSection({
	kind,
	models,
	chosen,
	row,
	t,
}: {
	kind: Kind
	models: ModelStatus[]
	chosen: string
	row: RowOf
	t: TFn
}) {
	return (
		<div className='stack gap-2'>
			<span className='text-xs font-medium muted'>
				{t(kind === 'stt' ? 'local.sttModels' : 'local.llmModels')}
			</span>
			{models.map((m) => (
				<AssetRow
					confirmDelete={m.id === chosen}
					downloading={m.downloading}
					installed={m.installed}
					key={m.id}
					meta={`${fmtBytes(m.bytes)}${m.note ? ` · ${m.note}` : ''}`}
					name={m.label}
					{...row(kind, m.id)}
				/>
			))}
		</div>
	)
}

// One engine or model in the manager: size, progress, then install / delete.
function AssetRow(props: AssetRowProps) {
	const { name, meta, prog, error, t } = props
	const info = (
		<span className='stack'>
			<span className='font-medium'>{name}</span>
			<span className='desc'>{meta}</span>
		</span>
	)
	if (props.downloading || prog)
		return (
			<DownloadRow info={info} onCancel={props.onCancel} prog={prog} t={t} />
		)
	return (
		<div className='alert hstack between'>
			<span className='stack'>
				{info}
				{error && (
					<span className='text-sm local-bad'>
						{t('local.downloadFailed')} — {errorHint(error)}
					</span>
				)}
			</span>
			<AssetActions
				confirmDelete={props.confirmDelete}
				installed={props.installed}
				onDelete={props.onDelete}
				onDownload={props.onDownload}
				t={t}
			/>
		</div>
	)
}

// A row while its file comes in: "Downloading… 42 %", Cancel, the pixel bar.
function DownloadRow({
	info,
	prog,
	onCancel,
	t,
}: {
	info: React.ReactNode
	prog?: Progress
	onCancel: () => void
	t: TFn
}) {
	const ref = useFlowBar(pctOf(prog) ?? 0)
	return (
		<div className='alert stack gap-2 local-dl'>
			<div className='hstack between'>
				{info}
				<span className='hstack gap-3'>
					<span className='text-xs muted tabular'>{dlLabel(t, prog)}</span>
					<button
						className='btn btn-ghost btn-sm'
						onClick={onCancel}
						type='button'
					>
						{t('common.cancel')}
					</button>
				</span>
			</div>
			<canvas className='local-flow' ref={ref} />
		</div>
	)
}

// Installed: the badge and delete (the model in use only after a second click);
// else Download.
function AssetActions({
	installed,
	confirmDelete,
	onDownload,
	onDelete,
	t,
}: Pick<
	AssetRowProps,
	'installed' | 'confirmDelete' | 'onDownload' | 'onDelete' | 't'
>) {
	const [confirming, setConfirming] = useState<boolean>(false)
	if (installed && confirming)
		return (
			<ConfirmDelete
				onCancel={() => setConfirming(false)}
				onConfirm={() => {
					setConfirming(false)
					onDelete()
				}}
				t={t}
			/>
		)
	if (installed)
		return (
			<span className='hstack gap-2'>
				<span className='badge badge-secondary'>{t('local.installed')}</span>
				<button
					aria-label={t('common.delete')}
					className='btn btn-ghost btn-icon btn-sm'
					onClick={() => (confirmDelete ? setConfirming(true) : onDelete())}
					type='button'
				>
					<PixelIcon className='pxi-ctl' name='trash' />
				</button>
			</span>
		)
	return (
		<button
			className='btn btn-outline btn-sm'
			onClick={onDownload}
			type='button'
		>
			<PixelIcon className='pxi-ctl' name='download' />
			{t('local.download')}
		</button>
	)
}

function ConfirmDelete({
	onConfirm,
	onCancel,
	t,
}: {
	onConfirm: () => void
	onCancel: () => void
	t: TFn
}) {
	return (
		<span className='hstack gap-2'>
			<button
				className='btn btn-destructive btn-sm'
				onClick={onConfirm}
				type='button'
			>
				<PixelIcon className='pxi-ctl' name='trash' />
				{t('local.deleteInUse')}
			</button>
			<button className='btn btn-ghost btn-sm' onClick={onCancel} type='button'>
				{t('common.cancel')}
			</button>
		</span>
	)
}
