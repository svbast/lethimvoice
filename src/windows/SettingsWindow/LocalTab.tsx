import { type RefObject, useRef } from 'react'
import Hero from '../../components/Hero'
import PixelIcon from '../../components/PixelIcon'
import { errorHint, type TFn, useT } from '../../i18n'
import LocalAssets from './LocalAssets'
import LocalSettings from './LocalSettings'
import LocalSetup from './LocalSetup'
import {
	type Local,
	type LocalPrefs,
	type RuntimeMessage,
	type SettingsPatch,
	useLocal,
} from './LocalState'

interface Props {
	settings: LocalPrefs
	onSave: (patch: SettingsPatch) => void
}

// Local (offline) tab — everything that concerns the fully-offline mode lives
// here: the mode switch, the first setup (model tiles), compute (CPU/GPU), the
// local text cleanup, model choices, and (under Advanced) the engine/model
// download manager. Its counterpart is OnlineTab (Groq API); exactly one of the
// two modes runs.
export default function LocalTab({
	settings,
	onSave,
}: Props): React.JSX.Element {
	const t = useT()
	const startRef = useRef<HTMLButtonElement>(null)
	const lt = useLocal(settings, onSave, t)
	const on = lt.local
	return (
		<>
			<Hero
				anim='gpu'
				badge={t(on ? 'engine.active' : 'engine.off')}
				desc={t('local.heroDesc')}
				plate={{
					kind: 'switch',
					label: t('guide.offlineTitle'),
					on,
					onToggle: () => toggle(on, lt, startRef),
				}}
				title={t('local.hero')}
				tone={on ? 'live' : 'muted'}
			/>
			{lt.status && lt.setup && (
				<LocalSetup
					lt={lt}
					setup={lt.setup}
					shortcut={settings.shortcut}
					startRef={startRef}
					status={lt.status}
					t={t}
				/>
			)}
			<Notices
				fallback={lt.status?.cpuFallback.stt ?? lt.status?.cpuFallback.llm}
				msg={lt.runtimeMsg}
				onRetry={() => window.electron.retryGpu().then(lt.refresh)}
				t={t}
			/>
			{lt.ready && lt.status && (
				<>
					<LocalSettings lt={lt} status={lt.status} t={t} />
					<LocalAssets lt={lt} status={lt.status} t={t} />
				</>
			)}
		</>
	)
}

// Exactly one mode runs: Offline on switches Online off. Before the models are on
// disk it cannot run, so the switch stays off and points at the setup button.
function toggle(
	on: boolean,
	lt: Local,
	startRef: RefObject<HTMLButtonElement | null>,
) {
	if (on) lt.save({ backend: 'cloud' })
	else if (lt.ready) lt.save({ backend: 'local' })
	else startRef.current?.focus()
}

// Between the cards: models loading into memory or leaving it, and a server that
// fell back from the GPU (out of VRAM, crash). That one works, slower, until the
// user retries the GPU or changes the compute mode.
function Notices({
	msg,
	fallback,
	onRetry,
	t,
}: {
	msg: RuntimeMessage | null
	fallback?: string
	onRetry: () => void
	t: TFn
}) {
	return (
		<>
			{msg && (
				<div className='alert hstack local-line'>
					{msg.kind === 'busy' && <span className='dot dot-live' />}
					{msg.kind === 'ok' && (
						<PixelIcon className='pxi-ctl local-ok' name='check' />
					)}
					{msg.kind === 'bad' && (
						<PixelIcon className='pxi-ctl local-bad' name='close' />
					)}
					<span>{msg.text}</span>
				</div>
			)}
			{fallback && (
				<div className='alert hstack between local-line'>
					<span className='local-bad'>
						{t('local.cpuFallback')} — {errorHint(fallback)}
					</span>
					<button
						className='btn btn-outline btn-sm'
						onClick={onRetry}
						type='button'
					>
						{t('local.retryGpu')}
					</button>
				</div>
			)}
		</>
	)
}
