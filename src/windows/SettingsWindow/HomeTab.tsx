import { useCallback, useEffect, useState } from 'react'
import type { PermissionStatus } from '../../../electron/permissions.mac'
import Hero from '../../components/Hero'
import PixelIcon from '../../components/PixelIcon'
import { withShortcut } from '../../components/withShortcut'
import { useT } from '../../i18n'

const GROQ_KEYS_URL = 'https://console.groq.com/keys'

// Home plays every loop the other tabs use, one after another; switched off, he sleeps.
const HOME_ANIM =
	'dance,cat,starstruck,boot,lan,gpu,read,charts,detective,angel'

interface Props {
	settings: { backend?: string; enabled?: boolean }
	/** The shortcut as key caps, e.g. ["Alt", "Q"]. */
	keys: string[]
	onToggle: () => void
	/** Opens the Local tab. */
	onOpenLocal: () => void
}

export default function HomeTab({
	settings,
	keys,
	onToggle,
	onOpenLocal,
}: Props) {
	const t = useT()
	const enabled = settings.enabled !== false
	const isMac = window.electron.platform === 'darwin'
	const local = settings.backend === 'local'

	return (
		<>
			{isMac && <PermissionsGate />}
			<Hero
				anim={enabled ? HOME_ANIM : 'sleep'}
				badge={t(local ? 'home.modeLocal' : 'home.modeOnline')}
				desc={t(enabled ? 'home.heroDesc' : 'home.heroOffDesc')}
				keys={keys}
				plate={{
					kind: 'switch',
					label: t('home.dictation'),
					on: enabled,
					onToggle,
				}}
				title={t(enabled ? 'home.statusReady' : 'home.statusOff')}
				tone={enabled ? 'live' : 'muted'}
			/>
			<Guide
				keys={keys}
				local={local}
				offline={!isMac}
				onOpenLocal={onOpenLocal}
			/>
		</>
	)
}

// Onboarding guide — one-time setup + how to dictate. The first thing a new user
// sees: online (Groq key) or offline (Local tab), then the steps of the path in
// use.
function Guide({
	keys,
	local,
	offline,
	onOpenLocal,
}: {
	keys: string[]
	local: boolean
	/** Local mode exists on this platform (not on macOS yet). */
	offline: boolean
	onOpenLocal: () => void
}) {
	const t = useT()
	const online = (
		<div className='option home-option'>
			<span className='hstack gap-3 home-option-head'>
				<span className='icon-tile'>
					<PixelIcon name='online' />
				</span>
				<span className='stack gap-1'>
					<span className='font-medium'>{t('guide.onlineTitle')}</span>
					<span className='desc'>{t('guide.onlineDesc')}</span>
				</span>
			</span>
			<a
				className='btn btn-outline btn-sm home-option-btn'
				href={GROQ_KEYS_URL}
				rel='noreferrer'
				target='_blank'
			>
				{t('guide.setupLink')}
				<PixelIcon className='pxi-ctl' name='external' />
			</a>
		</div>
	)

	return (
		<>
			<h2 className='section-title'>{t('guide.setupTitle')}</h2>
			<section className='card card-pad stack gap-4'>
				{local ? (
					<p className='desc'>{t('guide.offlineOn')}</p>
				) : offline ? (
					<div className='grid-2'>
						{online}
						<div className='option home-option'>
							<span className='hstack gap-3 home-option-head'>
								<span className='icon-tile'>
									<PixelIcon name='local' />
								</span>
								<span className='stack gap-1'>
									<span className='font-medium'>{t('guide.offlineTitle')}</span>
									<span className='desc'>{t('guide.offlineDesc')}</span>
								</span>
							</span>
							<button
								className='btn btn-outline btn-sm home-option-btn'
								onClick={onOpenLocal}
								type='button'
							>
								{t('guide.offlineButton')}
								<PixelIcon className='pxi-ctl' name='arrowRight' />
							</button>
						</div>
					</div>
				) : (
					online
				)}
				<ol className='steps'>
					{(local
						? (['guide.setup5'] as const)
						: ([
								'guide.setup1',
								'guide.setup2',
								'guide.setup3',
								'guide.setup4',
								'guide.setup5',
							] as const)
					).map((key, i) => (
						<Step key={key} n={i + 1}>
							{t(key)}
						</Step>
					))}
				</ol>
			</section>

			<h2 className='section-title'>{t('guide.useTitle')}</h2>
			<section className='card card-pad'>
				<ol className='steps'>
					<Step n={1}>{t('guide.use1')}</Step>
					<Step n={2}>{withShortcut(t('guide.use2'), keys)}</Step>
					<Step n={3}>{t('guide.use3')}</Step>
					<Step n={4}>{t('guide.use4')}</Step>
				</ol>
			</section>
		</>
	)
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
	return (
		<li className='step'>
			<span className='step-num'>{n}</span>
			<span>{children}</span>
		</li>
	)
}

// macOS-only permission gate. Renders NOTHING once the shortcut + paste have what
// they need — so on a healthy install (and on Windows/Linux, where the main
// process answers undefined) it is invisible. The microphone row only appears
// after macOS's own first-record sheet was declined: a denied mic never
// reprompts, so the button opens the Settings pane instead.
function PermissionsGate() {
	const t = useT()
	const [perms, setPerms] = useState<PermissionStatus | null>(null)
	const [busy, setBusy] = useState<boolean>(false)

	const refresh = useCallback<() => Promise<void>>(async () => {
		try {
			setPerms((await window.electron.getPermissions()) ?? null)
		} catch {
			/* keep last */
		}
	}, [])

	useEffect(() => {
		refresh()
		const id = setInterval(refresh, 1500)
		window.addEventListener('focus', refresh)
		return () => {
			clearInterval(id)
			window.removeEventListener('focus', refresh)
		}
	}, [refresh])

	if (!perms) return null

	const micDenied =
		perms.microphone === 'denied' || perms.microphone === 'restricted'
	const axOk = perms.accessibility
	if (axOk && !micDenied) return null

	const act = async (fn: () => Promise<unknown>): Promise<void> => {
		setBusy(true)
		try {
			await fn()
		} finally {
			setBusy(false)
			refresh()
		}
	}

	return (
		<section className='card card-pad stack gap-4' role='alert'>
			<div className='row-text'>
				<h2 className='card-title'>{t('permissions.title')}</h2>
				<p className='card-desc'>{t('permissions.subtitle')}</p>
			</div>
			<div className='stack gap-2'>
				<PermRow
					busy={busy}
					desc={t('permissions.ax.desc')}
					granted={axOk}
					grantLabel={t('permissions.grant')}
					icon='keyboard'
					label={t('permissions.ax.label')}
					onGrant={() => act(() => window.electron.promptAccessibility())}
				/>
				{micDenied && (
					<PermRow
						busy={busy}
						desc={t('permissions.mic.desc')}
						granted={false}
						grantLabel={t('permissions.openSettings')}
						icon='mic'
						label={t('permissions.mic.label')}
						onGrant={() =>
							act(() => window.electron.openPermissionSettings('microphone'))
						}
					/>
				)}
			</div>
		</section>
	)
}

function PermRow({
	icon,
	label,
	desc,
	granted,
	grantLabel,
	busy,
	onGrant,
}: {
	icon: 'keyboard' | 'mic'
	label: string
	desc: string
	granted: boolean
	grantLabel: string
	busy: boolean
	onGrant: () => void
}) {
	const t = useT()
	return (
		<div className='alert perm-row'>
			<span className='icon-tile'>
				<PixelIcon name={icon} />
			</span>
			<div className='row-text grow'>
				<span className='label'>{label}</span>
				<span className='desc'>{desc}</span>
			</div>
			{granted ? (
				<span className='badge badge-secondary'>
					{t('permissions.granted')}
				</span>
			) : (
				<button
					className='btn btn-default btn-sm'
					disabled={busy}
					onClick={onGrant}
					type='button'
				>
					{grantLabel}
				</button>
			)}
		</div>
	)
}
