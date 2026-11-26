import { type PointerEvent, useEffect, useRef, useState } from 'react'
import NameReveal from '../../components/NameReveal'
import PixelIcon from '../../components/PixelIcon'
import PixelMascot from '../../components/PixelMascot'
import { useAppState } from '../../hooks/useAppState'
import { useT } from '../../i18n'
import { formatShortcut, shortcutKeys } from '../../utils/keyCode'
import AboutTab from './AboutTab'
import HistoryTab from './HistoryTab'
import HomeTab from './HomeTab'
import LocalTab from './LocalTab'
import OnlineTab from './OnlineTab'
import PreferencesTab from './PreferencesTab'
import PromptsTab from './PromptsTab'
import Sidebar from './Sidebar'
import StatsTab from './StatsTab'
import { SECTIONS, type Section } from './sections'

export default function SettingsWindow() {
	const t = useT()
	const [ready, setReady] = useState<boolean>(false)
	const [section, setSection] = useState<Section>('main')
	const [state, setState] = useAppState()
	const settings = state.settings
	const burst = useBurst()

	if (!ready) return <Splash onStart={() => setReady(true)} />

	// patch only shows a change: a typed field that saves later (useSaveLater), or
	// one main has already saved. save shows a change and saves it.
	const patch = (p: SettingsPatch): void =>
		setState((s) => ({ ...s, settings: { ...s.settings, ...p } }))
	const save = (p: SettingsPatch) => {
		patch(p)
		return window.electron.saveSettings(p)
	}

	// Every Section has an entry, so the find always succeeds.
	const page = SECTIONS.find(
		(s) => s.id === section,
	) as (typeof SECTIONS)[number]
	const { keys, shortcut } = shortcutView(state.shortcut, settings.shortcut)

	return (
		<div className='app window' onPointerDown={burst.onPointerDown}>
			<div className='sidebar-col'>
				<Sidebar
					enabled={settings.enabled !== false}
					local={settings.backend === 'local'}
					onSection={setSection}
					section={section}
					shortcut={shortcut}
				/>
			</div>

			{/* key: a new section starts at the top, with its own fresh state. */}
			<main className='main' key={section}>
				<header className='main-header'>
					<div className='hstack gap-3'>
						<span className='icon-tile'>
							<PixelIcon name={page.icon} />
						</span>
						<div className='stack'>
							<h1 className='main-title'>{t(page.label)}</h1>
							<p className='main-desc'>{t(page.desc)}</p>
						</div>
					</div>
				</header>

				<div className='main-body'>
					<Tab
						keys={keys}
						onPatch={patch}
						onSave={save}
						onSection={setSection}
						section={section}
						setState={setState}
						state={state}
					/>
				</div>
			</main>
			{burst.marks}
		</div>
	)
}

type AppState = ReturnType<typeof useAppState>[0]
type SettingsPatch = Partial<AppState['settings']>

// The shortcut as shown: a portal-managed one (Wayland) is the compositor's binding,
// not ours.
const shortcutView = (
	status: AppState['shortcut'],
	stored: string | undefined,
) => {
	const platform = window.electron.platform
	if (status?.backend === 'portal') {
		const trigger = status.trigger || ''
		return { keys: [trigger], shortcut: trigger }
	}
	return {
		keys: shortcutKeys(stored, platform),
		shortcut: formatShortcut(stored, platform),
	}
}

// The open section's tab.
function Tab({
	keys,
	onPatch,
	onSave,
	onSection,
	section,
	setState,
	state,
}: {
	keys: string[]
	onPatch: (p: SettingsPatch) => void
	onSave: (p: SettingsPatch) => Promise<unknown>
	onSection: (id: Section) => void
	section: Section
	setState: ReturnType<typeof useAppState>[1]
	state: AppState
}) {
	const { settings } = state
	const openLocal = () => onSection('local')
	switch (section) {
		case 'main':
			return (
				<HomeTab
					keys={keys}
					onOpenLocal={openLocal}
					onToggle={() => onSave({ enabled: settings.enabled === false })}
					settings={settings}
				/>
			)
		case 'online':
			return (
				<OnlineTab
					onOpenLocal={openLocal}
					onPatch={onPatch}
					onSave={onSave}
					settings={settings}
				/>
			)
		case 'local':
			return <LocalTab onSave={onSave} settings={settings} />
		case 'prompts':
			return <PromptsTab onPatch={onPatch} settings={settings} />
		case 'settings':
			return (
				<PreferencesTab
					autostart={state.autostart ?? false}
					keys={keys}
					onAutostart={(on) => setState((s) => ({ ...s, autostart: on }))}
					onOpenLocal={openLocal}
					onPatch={onPatch}
					onSave={onSave}
					settings={settings}
					shortcut={state.shortcut}
				/>
			)
		case 'stats':
			return <StatsTab />
		case 'history':
			return <HistoryTab onSave={onSave} settings={settings} />
		case 'info':
			return <AboutTab onSave={onSave} settings={settings} />
		default:
			return null
	}
}

// A click anywhere in the window: a pixel burst where the pointer went down. A click
// on nothing clickable gets a grey burst and a small tilted "miss" or "knock", a
// little off to the side each time.
const CLICKABLE =
	'a, button, input, textarea, select, label, [role="button"], [role="switch"], [role="radio"], [role="tab"], [tabindex]'

interface Burst {
	n: number
	x: number
	y: number
	miss: boolean
	word: 'fx.knock' | 'fx.miss'
	mx: number
	my: number
	tilt: number
}

function useBurst() {
	const t = useT()
	const [b, setB] = useState<Burst | null>(null)
	const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
		const r = e.currentTarget.getBoundingClientRect()
		const x = Math.round(e.clientX - r.left)
		const y = Math.round(e.clientY - r.top)
		const rnd = (lo: number, hi: number) =>
			Math.round(lo + Math.random() * (hi - lo))
		setB((prev) => ({
			miss: !(e.target as Element).closest(CLICKABLE),
			mx: x + rnd(-12, 12),
			my: y - rnd(4, 14),
			n: (prev?.n ?? 0) + 1,
			tilt: rnd(-22, 22),
			word: Math.random() < 0.5 ? 'fx.knock' : 'fx.miss',
			x,
			y,
		}))
	}
	// key={b.n}: a new element per click restarts the animation.
	const marks = b && (
		<>
			<span
				aria-hidden='true'
				className={`burst burst-a${b.miss ? ' burst-miss' : ''}`}
				key={`burst${b.n}`}
				style={{ left: b.x, top: b.y }}
			/>
			{b.miss && (
				<span
					aria-hidden='true'
					className='miss miss-a'
					key={`miss${b.n}`}
					style={{ left: b.mx, top: b.my }}
				>
					<span
						style={{
							display: 'inline-block',
							transform: `rotate(${b.tilt}deg)`,
						}}
					>
						{t(b.word)}
					</span>
				</span>
			)}
		</>
	)
	return { marks, onPointerDown }
}

// The launch splash: the mascot and the name draw themselves in pixels with one sweep,
// he boots, the same sweep takes both out, and the app takes over. About 3.3 s; a
// click or a key skips it.
// onStart is read through a ref so a parent re-render can't reset the timer.
const SPLASH_MS = 3300

function Splash({ onStart }: { onStart: () => void }) {
	const onStartRef = useRef<() => void>(onStart)
	useEffect(() => {
		onStartRef.current = onStart
	})
	const [start] = useState<number>(() => performance.now())

	useEffect(() => {
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
		const done = () => onStartRef.current()
		const timer = setTimeout(done, reduce ? 800 : SPLASH_MS)
		window.addEventListener('keydown', done)
		return () => {
			clearTimeout(timer)
			window.removeEventListener('keydown', done)
		}
	}, [])

	return (
		// A click anywhere skips the splash; keys skip it through the listener above.
		<div
			className='app splash-root'
			onPointerDown={() => onStartRef.current()}
			role='presentation'
		>
			<div className='splash-mascot'>
				<PixelMascot anim='splash' size={216} start={start} />
			</div>
			<div className='splash-name'>
				<NameReveal start={start} text='LetHim Voice' />
			</div>
		</div>
	)
}
