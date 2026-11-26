import PixelIcon from '../../components/PixelIcon'
import { useT } from '../../i18n'
import { APP_CHANNEL, APP_VERSION } from '../../version'
import StatusCard from './StatusCard'
import { SECTIONS, type Section } from './sections'

interface Props {
	section: Section
	onSection: (id: Section) => void
	enabled: boolean
	local: boolean
	shortcut: string
}

export default function Sidebar({
	section,
	onSection,
	enabled,
	local,
	shortcut,
}: Props) {
	const t = useT()
	return (
		<div className='app sidebar'>
			<div className='brand'>
				<span className='stack'>
					<span className='brand-name'>LetHim Voice</span>
					<span className='brand-ver'>
						v{APP_VERSION} ({APP_CHANNEL})
					</span>
				</span>
				{/* The same two lights on every OS: hide (the window keeps running in the
            tray) and minimize. */}
				<div className='winctl'>
					<button
						aria-label={t('app.hide')}
						className='wdot wdot-hide'
						onClick={() => window.electron.hideWindow()}
						title={t('app.hide')}
						type='button'
					>
						<PixelIcon name='close' />
					</button>
					<button
						aria-label={t('app.minimize')}
						className='wdot'
						onClick={() => window.electron.minimizeWindow()}
						title={t('app.minimize')}
						type='button'
					>
						<PixelIcon name='minimize' />
					</button>
				</div>
			</div>

			<div className='sunk-frame'>
				<div className='sunk-screen'>
					<nav aria-label={t('app.sections')} className='nav'>
						{SECTIONS.map(({ id, icon, label }) => (
							<button
								aria-current={section === id ? 'page' : undefined}
								className={section === id ? 'nav-item is-active' : 'nav-item'}
								key={id}
								onClick={() => onSection(id)}
								type='button'
							>
								<PixelIcon name={icon} />
								<span>{t(label)}</span>
							</button>
						))}
					</nav>
				</div>
			</div>

			<div className='sidebar-foot'>
				<StatusCard enabled={enabled} local={local} shortcut={shortcut} />
			</div>
		</div>
	)
}
