import { useT } from '../../i18n'
import { columns, drawBoard } from '../../pixel/board'
import { usePixelCanvas } from '../../pixel/engine'

interface Props {
	enabled: boolean
	local: boolean
	/** The shortcut as the user reads it ("Alt+Q", "Right ⌘"). */
	shortcut: string
}

// The sidebar's status screen: whether dictation is on, the shortcut on a dot-matrix
// board, and which mode is on (both printed, the active one lit).
export default function StatusCard({ enabled, local, shortcut }: Props) {
	const t = useT()
	const board = usePixelCanvas(2, drawBoard(columns(shortcut.toUpperCase())))
	return (
		<div className='status-card sunk-frame'>
			<div className='sunk-screen'>
				<div className='status-line'>
					<span className={enabled ? 'dot dot-live' : 'dot dot-off'} />
					<span className={`status-text ${enabled ? 'lit' : 'status-off'}`}>
						{t(enabled ? 'home.statusReady' : 'home.statusOff')}
					</span>
				</div>
				<canvas
					aria-label={t('status.shortcut', { keys: shortcut })}
					className='status-board'
					ref={board}
					role='img'
				/>
				<div className='status-modes'>
					<span className={local ? 'status-mode' : 'lit'}>
						{t('guide.onlineTitle')}
					</span>
					<span className={local ? 'lit' : 'status-mode'}>
						{t('guide.offlineTitle')}
					</span>
				</div>
			</div>
		</div>
	)
}
