import { useEffect, useId, useState } from 'react'
import type { Api } from '../../../electron/preload'
import Hero from '../../components/Hero'
import PixelIcon from '../../components/PixelIcon'
import { useSaveLater } from '../../hooks/useSaveLater'
import { getLocale, type Key, useT } from '../../i18n'

type TestState = 'idle' | 'testing' | 'ok' | 'fail'
type ModelStatus = Awaited<ReturnType<Api['getModelStatus']>>
type ModelState = NonNullable<ModelStatus['stt']['models'][number]['state']>

interface Props {
	settings: { apiKey?: string; backend?: string }
	/** Shows a change at once; the API key's save is debounced (useSaveLater). */
	onPatch: (patch: { apiKey: string }) => void
	onSave: (patch: { backend: string }) => void
	/** Online off means offline on: that switch lives in the Local tab. */
	onOpenLocal: () => void
}

// Online (cloud) tab — everything that concerns the Groq API mode lives here: the
// mode switch, the API key and which Groq model answered last.
export default function OnlineTab({
	settings,
	onPatch,
	onSave,
	onOpenLocal,
}: Props) {
	const t = useT()
	const keyId = useId()
	const [showKey, setShowKey] = useState<boolean>(false)
	const [testState, setTestState] = useState<TestState>('idle')
	const [saveLater, flush] = useSaveLater()
	const apiKey = settings.apiKey || ''
	const active = settings.backend !== 'local'

	// Exactly one mode runs: turning Online on switches Local off. Turning it off
	// means turning Local on, which needs its models, so that happens in Local.
	function toggle(): void {
		if (active) {
			onOpenLocal()
			return
		}
		onSave({ backend: 'cloud' })
	}

	async function handleTest(): Promise<void> {
		if (testState === 'testing') return
		setTestState('testing')
		const res = await window.electron.testApiKey(apiKey)
		setTestState(res.ok ? 'ok' : 'fail')
		setTimeout(() => setTestState('idle'), 2200)
	}

	return (
		<>
			<Hero
				anim='lan'
				badge={t(active ? 'engine.active' : 'engine.off')}
				desc={t('navDesc.online')}
				plate={{
					kind: 'switch',
					label: t('guide.onlineTitle'),
					on: active,
					onToggle: toggle,
				}}
				title={t('online.hero')}
				tone={active ? 'live' : 'muted'}
			/>

			<section className='card card-pad stack gap-3'>
				<div className='row-text'>
					<label className='label' htmlFor={keyId}>
						{t('online.key')}
					</label>
					<span className='desc'>{t('online.keyDesc')}</span>
				</div>
				<div className='hstack gap-2'>
					<div className='input-wrap grow'>
						<input
							className='input mono'
							id={keyId}
							onBlur={flush}
							onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
								onPatch({ apiKey: e.target.value })
								saveLater({ apiKey: e.target.value })
							}}
							placeholder={t('online.keyPlaceholder')}
							spellCheck={false}
							type={showKey ? 'text' : 'password'}
							value={apiKey}
						/>
						<button
							aria-label={showKey ? t('online.hideKey') : t('online.showKey')}
							className='btn btn-ghost btn-icon btn-sm input-btn'
							onClick={() => setShowKey((v) => !v)}
							type='button'
						>
							<PixelIcon
								className='pxi-ctl'
								name={showKey ? 'eyeOff' : 'eye'}
							/>
						</button>
					</div>
					<TestButton
						disabled={!apiKey}
						onClick={handleTest}
						state={testState}
					/>
				</div>
			</section>

			{active && <ModelsPanel />}
		</>
	)
}

const TEST_LABEL: Record<TestState, Key> = {
	fail: 'online.testFail',
	idle: 'online.test',
	ok: 'online.testOk',
	testing: 'online.testing',
}

function TestButton({
	state,
	disabled,
	onClick,
}: {
	state: TestState
	disabled: boolean
	onClick: () => void
}) {
	const t = useT()
	return (
		<button
			className={
				state === 'fail' ? 'btn btn-outline test-fail' : 'btn btn-outline'
			}
			disabled={state === 'idle' ? disabled : state === 'testing'}
			onClick={state === 'idle' ? onClick : undefined}
			type='button'
		>
			{state === 'testing' && <span className='dot dot-live' />}
			{state === 'ok' && <PixelIcon className='pxi-ctl' name='check' />}
			{state === 'fail' && <PixelIcon className='pxi-ctl' name='close' />}
			{t(TEST_LABEL[state])}
		</button>
	)
}

const BADGE: Record<ModelState, string> = {
	active: 'badge badge-secondary',
	failed: 'badge badge-destructive',
	limited: 'badge badge-destructive',
	retired: 'badge badge-muted',
	standby: 'badge badge-outline',
}

// Which Groq model handled the last dictation, per step, and why the others did
// not: read from the chain walker in pipeline/cloud.ts, pushed after every walk.
function ModelsPanel() {
	const t = useT()
	const [status, setStatus] = useState<ModelStatus | null>(null)

	useEffect(() => {
		const off = window.electron.on('models-changed', setStatus)
		window.electron
			.getModelStatus()
			.then(setStatus)
			.catch(() => {
				// main process not answering: panel stays hidden
			})
		return () => off()
	}, [])

	if (!status) return null
	const time = (at: number) =>
		new Date(at).toLocaleTimeString(getLocale(), {
			hour: '2-digit',
			minute: '2-digit',
		})

	return (
		<section className='card card-pad stack gap-4'>
			<div className='row-text'>
				<h2 className='card-title'>{t('online.models.title')}</h2>
				<span className='card-desc'>{t('online.models.desc')}</span>
			</div>
			{(['stt', 'llm'] as const).map((chain) => {
				const { at, models } = status[chain]
				return (
					<div className='stack gap-2' key={chain}>
						<span className='text-xs font-medium muted'>
							{t(`online.models.${chain}`)}
							{at ? ` · ${t('online.models.at', { time: time(at) })}` : ''}
						</span>
						{models.map(({ id, state }) => (
							<div className='alert hstack between' key={id}>
								<span className='mono text-sm'>{id}</span>
								{state && (
									<span className={BADGE[state]}>
										{t(`online.models.state.${state}`)}
									</span>
								)}
							</div>
						))}
					</div>
				)
			})}
			{!(status.stt.at || status.llm.at) && (
				<span className='desc'>{t('online.models.idle')}</span>
			)}
		</section>
	)
}
