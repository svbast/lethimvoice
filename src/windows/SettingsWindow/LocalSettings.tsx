import { useId, useState } from 'react'
import type { Asset } from '../../../electron/ipc/broadcast'
import type { Api } from '../../../electron/preload'
import type { Kind } from '../../../electron/runtime/models'
import PixelIcon from '../../components/PixelIcon'
import Segmented from '../../components/Segmented'
import Switch from '../../components/Switch'
import { errorHint, type TFn } from '../../i18n'
import {
	dlLabel,
	fmtBytes,
	type LocalStatus,
	type ModelStatus,
} from './LocalFormat'
import { engineOf, type Local } from './LocalState'

type TestResult = Awaited<ReturnType<Api['testLocal']>>
interface CardProps {
	lt: Local
	status: LocalStatus
	t: TFn
}
type RowProps = Pick<CardProps, 'lt' | 't'>
interface ModelRowProps {
	label: string
	desc: React.ReactNode
	value: string
	models: ModelStatus[]
	onChange: (id: string) => void
	t: TFn
}

// 0 = never released.
const IDLE_MINUTES = [1, 5, 15, 60, 0]

// The settings card, shown once local mode is set up: everything that tunes it.
// Compute, idle and cleanup act only in local mode; the model choices stay open,
// so a model can be picked (and downloaded) ahead.
export default function LocalSettings({ lt, status, t }: CardProps) {
	const { llm, sttModel } = lt
	return (
		<section className='card'>
			<ComputeRow lt={lt} status={status} t={t} />
			<IdleRow lt={lt} t={t} />
			<CleanupRow lt={lt} t={t} />
			<ModelRow
				desc={
					choiceDesc(lt, 'stt', t) ??
					languageHint(status, sttModel, lt.pickStt, t)
				}
				label={t('local.sttModel')}
				models={status.models.stt}
				onChange={lt.pickStt}
				t={t}
				value={sttModel}
			/>
			<ModelRow
				desc={choiceDesc(lt, 'llm', t)}
				label={t('local.llmModel')}
				models={status.models.llm}
				onChange={(id) => lt.choose('llm', id, () => lt.setLlm({ model: id }))}
				t={t}
				value={llm.model}
			/>
			{/* A new choice remounts the test: an old result never describes other
          models. */}
			{lt.local && (
				<SelfTest
					key={`${sttModel}|${llm.model}|${llm.enabled}`}
					onDone={lt.refresh}
					t={t}
				/>
			)}
		</section>
	)
}

function ComputeRow({ lt, status, t }: CardProps) {
	return (
		<div className='row'>
			<div className='row-text'>
				<span className='label'>{t('local.compute.label')}</span>
				<span className='desc'>{computeDesc(t, status.engines.gpus)}</span>
			</div>
			<Segmented
				ariaLabel={t('local.compute.label')}
				onChange={(v: string) => lt.save({ computeMode: v })}
				options={[
					{ label: t('local.auto'), value: 'auto' },
					{ label: t('local.gpu'), value: 'gpu' },
					{ label: t('local.cpu'), value: 'cpu' },
				]}
				value={lt.compute}
			/>
		</div>
	)
}

// How long idle local models keep their RAM/VRAM.
function IdleRow({ lt, t }: RowProps) {
	const id = useId()
	return (
		<div className='row'>
			<div className='row-text'>
				<label className='label' htmlFor={id}>
					{t('local.idle.label')}
				</label>
				<span className='desc'>{t('local.idle.desc')}</span>
			</div>
			<select
				className='select local-idle'
				id={id}
				onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
					lt.save({ localIdleMinutes: Number(e.target.value) })
				}
				value={String(lt.idle)}
			>
				{IDLE_MINUTES.map((m) => (
					<option key={m} value={m}>
						{idleLabel(t, m)}
					</option>
				))}
			</select>
		</div>
	)
}

// Text cleanup on: its model downloads first when it is not on disk.
function CleanupRow({ lt, t }: RowProps) {
	const id = useId()
	const { llm } = lt
	return (
		<div className='row'>
			<div className='row-text'>
				<span className='label' id={id}>
					{t('local.llmEnable.label')}
				</span>
				<span className='desc'>{t('local.llmEnable.desc')}</span>
			</div>
			<Switch
				aria-labelledby={id}
				on={llm.enabled}
				onToggle={() =>
					llm.enabled
						? lt.setLlm({ enabled: false })
						: lt.choose('llm', llm.model, () => lt.setLlm({ enabled: true }))
				}
			/>
		</div>
	)
}

// Under a model choice: its download (engine or model) with Cancel, or why the
// last choice failed; null when there is nothing to say.
function choiceDesc(lt: Local, kind: Kind, t: TFn): React.ReactNode {
	const engine = `engine:${engineOf(lt.status, kind)?.id}`
	const key = Object.keys(lt.progress).find(
		(k) => k.startsWith(`${kind}:`) || k === engine,
	)
	if (key) {
		const [asset, ...id] = key.split(':')
		return (
			<>
				{dlLabel(t, lt.progress[key])}{' '}
				<button
					className='link'
					onClick={() => lt.cancel(asset as Asset, id.join(':'))}
					type='button'
				>
					{t('common.cancel')}
				</button>
			</>
		)
	}
	const failed = lt.choiceError[kind]
	return failed ? (
		<span className='local-bad'>
			{t('local.downloadFailed')} — {errorHint(failed.error)}
		</span>
	) : null
}

// The chosen speech model is poor for the dictation language: one click to the
// recommended one. null when it suits.
function languageHint(
	status: LocalStatus,
	current: string,
	onSwitch: (id: string) => void,
	t: TFn,
): React.ReactNode {
	const to = status.models.stt.find((m) => m.id === status.languageHint)
	// Just switched: the choice is in, the status saying so is a moment behind.
	if (!to || current === to.id) return null
	const from = status.models.stt.find((m) => m.id === current)?.label ?? current
	return (
		<>
			{t('local.hint.text', { current: from, suggested: to.label })}{' '}
			<button className='link' onClick={() => onSwitch(to.id)} type='button'>
				{t('local.hint.switch')}
				{to.installed ? '' : ` · ${fmtBytes(to.bytes)}`}
			</button>
		</>
	)
}

// A model choice: a not-installed option names its download size. The chosen one
// says it under the label instead: the closed select is too narrow for the suffix.
function ModelRow({ label, desc, value, models, onChange, t }: ModelRowProps) {
	const id = useId()
	const chosen = models.find((m) => m.id === value)
	const shown =
		desc ??
		(chosen && !chosen.installed
			? t('local.optionDownload', { size: fmtBytes(chosen.bytes) })
			: null)
	return (
		<div className='row'>
			<div className='row-text'>
				<label className='label' htmlFor={id}>
					{label}
				</label>
				{shown && <span className='desc'>{shown}</span>}
			</div>
			<select
				className='select'
				id={id}
				onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
					onChange(e.target.value)
				}
				value={value}
			>
				{models.map((m) => (
					<option key={m.id} value={m.id}>
						{m.label}
						{m.installed || m.id === value
							? ''
							: ` — ${t('local.optionDownload', { size: fmtBytes(m.bytes) })}`}
					</option>
				))}
			</select>
		</div>
	)
}

// Self-test of the chosen models: engines spawn, models load, one real inference
// each. Cold start loads the models, so this can take a while.
function SelfTest({ t, onDone }: { t: TFn; onDone: () => void }) {
	const [state, setState] = useState<'idle' | 'testing' | 'done'>('idle')
	const [result, setResult] = useState<TestResult | null>(null)
	async function run(): Promise<void> {
		setState('testing')
		setResult(await window.electron.testLocal().catch(() => null))
		setState('done')
		onDone()
	}
	const testing = state === 'testing'
	return (
		<div className='row row-top'>
			<button
				className='btn btn-outline'
				disabled={testing}
				onClick={run}
				type='button'
			>
				{testing ? (
					<span className='dot dot-live' />
				) : (
					<PixelIcon className='pxi-ctl' name='check' />
				)}
				{t(testing ? 'local.testing' : 'local.test')}
			</button>
			{state === 'done' && result && (
				<div className='stack gap-1 text-sm local-results'>
					<TestLine label={t('local.sttModel')} r={result.stt} t={t} />
					<TestLine label={t('local.llmModel')} r={result.llm} t={t} />
				</div>
			)}
		</div>
	)
}

// One line of the self-test result: OK, the localized error, or "off" (LLM disabled).
function TestLine({
	label,
	r,
	t,
}: {
	label: string
	r: TestResult['stt']
	t: TFn
}) {
	let body: React.ReactElement
	if (r.skipped) body = <span className='muted'>{t('local.testSkipped')}</span>
	else if (r.ok)
		body = (
			<span className='hstack gap-1 font-medium'>
				<PixelIcon className='pxi-ctl local-ok' name='check' />
				OK
			</span>
		)
	else
		body = (
			<span className='hstack gap-1 local-bad'>
				<PixelIcon className='pxi-ctl' name='close' />
				{errorHint(r.error)}
			</span>
		)
	return (
		<div className='hstack between gap-4'>
			<span className='muted'>{label}</span>
			{body}
		</div>
	)
}

function idleLabel(t: TFn, minutes: number): string {
	if (minutes === 0) return t('local.idle.never')
	if (minutes === 60) return t('local.idle.hour')
	return t('local.idle.minutes', { n: minutes })
}

// "How local models run. GPU detected: …", the plain line until GPUs are known.
function computeDesc(t: TFn, gpus: string[] | null): string {
	const plain = t('local.compute.desc')
	if (gpus === null) return plain
	if (gpus.length === 0) return `${plain} ${t('local.noGpu')}`
	return `${plain} ${t('local.gpuDetected', { name: gpus.join(', ') })}`
}
