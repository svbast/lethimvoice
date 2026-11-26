import { useEffect, useId, useState } from 'react'

import Hero from '../../components/Hero'
import PixelIcon from '../../components/PixelIcon'
import Switch from '../../components/Switch'
import { fmtWhen, useT } from '../../i18n'
import { APP_CHANNEL, APP_VERSION } from '../../version'

// The same repo electron-builder.yml `publish` names: the updater reads it too.
const REPO_URL = 'https://github.com/svbast/lethimvoice'
const RELEASES_URL = `${REPO_URL}/releases/latest`
// Feedback and requests open the repo's feature-request form.
const FEEDBACK_URL = `${REPO_URL}/issues/new?template=feature_request.yml`

type UpdateState = Awaited<ReturnType<Window['electron']['getUpdate']>>

interface Props {
	settings: { autoUpdate?: boolean }
	onSave: (patch: { autoUpdate: boolean }) => void
}

export default function AboutTab({ settings, onSave }: Props) {
	const t = useT()
	const update = useUpdate()
	const autoUpdate = settings.autoUpdate !== false
	const toggleAuto = () => onSave({ autoUpdate: !autoUpdate })
	return (
		<>
			<Hero
				anim='angel'
				badge={APP_CHANNEL}
				desc={t('about.heroDesc')}
				plate={{ kind: 'value', label: t('about.version'), value: APP_VERSION }}
				title='LetHim Voice'
				tone='plain'
			/>

			<section className='card card-pad stack gap-4'>
				<div className='stack gap-3 muted about-story'>
					<p>{t('about.storyP1')}</p>
					<p>{t('about.storyP2')}</p>
				</div>
			</section>

			<section className='card'>
				<UpdateRow update={update} />
				{update.phase !== 'manual' && (
					<AutoRow on={autoUpdate} onToggle={toggleAuto} update={update} />
				)}
			</section>

			<section className='grid-3'>
				<Link href={REPO_URL} icon='code' label={t('about.source')} />
				<Link
					href={`${REPO_URL}/issues`}
					icon='issue'
					label={t('about.issue')}
				/>
				<Link href={FEEDBACK_URL} icon='feedback' label={t('about.feedback')} />
			</section>
		</>
	)
}

function useUpdate(): UpdateState {
	const [update, setUpdate] = useState<UpdateState>({ phase: 'idle' })
	useEffect(() => {
		const off = window.electron.on('update-state', setUpdate)
		window.electron
			.getUpdate()
			.then(setUpdate)
			.catch(() => undefined)
		return () => off()
	}, [])
	return update
}

// The news, when there is any: a download, the restart that installs it, or the
// releases page for a copy that cannot install it itself.
function UpdateRow({ update }: { update: UpdateState }) {
	const t = useT()
	const { phase, percent = 0, version = '' } = update
	if (phase === 'ready')
		return (
			<Row
				desc={t('about.update.ready', { version })}
				label={t('about.update.available')}
			>
				<button
					className='btn btn-default'
					onClick={() => window.electron.installUpdate()}
					type='button'
				>
					<PixelIcon className='pxi-ctl' name='restart' />
					{t('about.update.restart')}
				</button>
			</Row>
		)
	if (phase === 'downloading')
		return (
			<Row
				desc={t('about.update.downloading', { percent, version })}
				label={t('about.update.available')}
			/>
		)
	const manual = {
		available: ['about.update.available', 'about.update.portable'],
		error: ['about.update.failed', 'about.update.failedDesc'],
		manual: ['about.update.manual', 'about.update.manualDesc'],
	} as const
	if (!(phase in manual)) return null
	const [label, desc] = manual[phase as keyof typeof manual]
	return (
		<Row desc={t(desc, { version })} label={t(label)}>
			<a
				className='btn btn-outline btn-sm'
				href={RELEASES_URL}
				rel='noreferrer'
				target='_blank'
			>
				<PixelIcon className='pxi-ctl' name='download' />
				{t('about.update.download')}
			</a>
		</Row>
	)
}

function AutoRow({
	on,
	onToggle,
	update,
}: {
	on: boolean
	onToggle: () => void
	update: UpdateState
}) {
	const t = useT()
	const labelId = useId()
	const busy = ['checking', 'downloading', 'ready'].includes(update.phase)
	const desc =
		update.phase === 'checking'
			? t('about.update.checking')
			: update.checkedAt
				? t('about.update.lastChecked', {
						when: fmtWhen(update.checkedAt, true),
					})
				: t('about.update.notChecked')
	return (
		<Row desc={desc} label={t('about.update.auto')} labelId={labelId}>
			<div className='hstack gap-4'>
				<button
					className='btn btn-outline btn-sm'
					disabled={busy}
					onClick={() => window.electron.checkUpdate()}
					type='button'
				>
					{t('about.update.checkNow')}
				</button>
				<Switch aria-labelledby={labelId} on={on} onToggle={onToggle} />
			</div>
		</Row>
	)
}

function Row({
	label,
	labelId,
	desc,
	children,
}: {
	label: string
	labelId?: string
	desc: string
	children?: React.ReactNode
}) {
	return (
		<div className='row'>
			<div className='row-text'>
				<span className='label' id={labelId}>
					{label}
				</span>
				<span className='desc'>{desc}</span>
			</div>
			{children}
		</div>
	)
}

function Link({
	href,
	icon,
	label,
}: {
	href: string
	icon: 'code' | 'issue' | 'feedback'
	label: string
}) {
	return (
		<a className='btn btn-outline' href={href} rel='noreferrer' target='_blank'>
			<PixelIcon className='pxi-ctl' name={icon} />
			{label}
		</a>
	)
}
