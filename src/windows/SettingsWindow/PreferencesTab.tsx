import { useCallback, useEffect, useId, useRef, useState } from 'react'

import type { Api } from '../../../electron/preload'
import {
	LANGUAGE_NAMES,
	RECOGNITION_LANGUAGES,
	SUPPORTED_LOCALES,
} from '../../../electron/utils/languages'
import Hero from '../../components/Hero'
import PixelIcon from '../../components/PixelIcon'
import { renderTemplate } from '../../components/renderTemplate'
import Segmented from '../../components/Segmented'
import Switch from '../../components/Switch'
import { DEFAULT_LOCALE, type Key, setLocale, useT } from '../../i18n'
import { eventToShortcut, loneModifier } from '../../utils/keyCode'

interface PreferencesSettings {
	backend?: string
	shortcut?: string
	uiLanguage?: string
	language?: string
	inputDevice?: string
	keepInClipboard?: boolean
	[key: string]: unknown
}
type SettingsPatch = Partial<PreferencesSettings>
interface Props {
	settings: PreferencesSettings
	/** Shows a change at once, without saving it. */
	onPatch: (patch: SettingsPatch) => void
	/** Shows a change at once and saves it. */
	onSave: (patch: SettingsPatch) => Promise<unknown>
	autostart: boolean
	onAutostart: (on: boolean) => void
	onOpenLocal: () => void
	/** undefined until the app-state snapshot lands; hides the shortcut row. */
	shortcut?: Awaited<ReturnType<Api['getAppState']>>['shortcut']
	/** The shortcut as key caps, e.g. ["Alt", "Q"]. */
	keys: string[]
}
interface CaptureDialogProps {
	onCapture: (key: string) => void | Promise<void>
	onCancel: () => void | Promise<void>
	isMac: boolean
}

// Short, locale-independent label for a UI language (codes read cleaner in a
// segmented control than full names). Czech and Ukrainian show the country code
// people know ("CZ", "UA") instead of their ISO 639 language code ('cs', 'uk').
const LANG_DISPLAY: Record<string, string> = { cs: 'CZ', uk: 'UA' }
const langLabel = (loc: string): string =>
	LANG_DISPLAY[loc] || loc.toUpperCase()

// The hero's microphone note: the system default or a picked device.
const micNote = (device: string | undefined): Key =>
	!device || device === 'default'
		? 'preferences.hero.micDefault'
		: 'preferences.hero.micOther'

export default function PreferencesTab({
	settings,
	onPatch,
	onSave,
	autostart,
	onAutostart,
	onOpenLocal,
	shortcut,
	keys,
}: Props): React.ReactElement {
	const t = useT()
	const [form, setForm] = useState<PreferencesSettings>({ ...settings })
	const [capturing, setCapturing] = useState<boolean>(false)

	useEffect(() => {
		setForm({ ...settings })
	}, [settings])

	const languageHint = useLanguageHint(
		settings.backend === 'local',
		form.language,
	)

	// Every control applies on change, like picking a mode — no Save button to
	// forget.
	async function save(patch: SettingsPatch): Promise<void> {
		setForm((f) => ({ ...f, ...patch }))
		await onSave(patch)
	}

	// Stable refs so CaptureDialog doesn't resubscribe its keydown handler.
	const handleCapture = useCallback<(key: string) => Promise<void>>(
		async (key) => {
			setForm((f) => ({ ...f, shortcut: key }))
			setCapturing(false)
			try {
				await window.electron.saveSettings({ shortcut: key })
				onPatch({ shortcut: key })
			} finally {
				await window.electron.setShortcutCapture(false)
			}
		},
		[onPatch],
	)

	const handleCancel = useCallback<() => Promise<void>>(async () => {
		setCapturing(false)
		await window.electron.setShortcutCapture(false)
	}, [])

	const language = form.language || 'en'

	return (
		<>
			<Hero
				anim='boot'
				badge={`${LANGUAGE_NAMES[language] ?? language} · ${t(micNote(form.inputDevice))}`}
				desc={t('navDesc.settings')}
				plate={{ keys, kind: 'keys', label: t('preferences.shortcut') }}
				title={t('preferences.hero.title')}
				tone='plain'
			/>

			<h2 className='section-title'>{t('preferences.section.general')}</h2>
			<section className='card'>
				<div className='row'>
					<div className='row-text'>
						<span className='label'>{t('preferences.interfaceLanguage')}</span>
					</div>
					<Segmented
						ariaLabel={t('preferences.interfaceLanguage')}
						onChange={(loc) => {
							setLocale(loc)
							save({ uiLanguage: loc })
						}}
						options={SUPPORTED_LOCALES.map((loc) => ({
							label: langLabel(loc),
							value: loc,
						}))}
						value={form.uiLanguage || DEFAULT_LOCALE}
					/>
				</div>
			</section>

			<h2 className='section-title'>{t('preferences.section.dictation')}</h2>
			<section className='card'>
				{shortcut?.backend !== undefined && (
					<ShortcutRow
						keys={keys}
						onCapture={async () => {
							setCapturing(true)
							await window.electron.setShortcutCapture(true)
						}}
						shortcut={shortcut}
					/>
				)}
				<LanguageRow
					hint={languageHint}
					language={language}
					onOpenLocal={onOpenLocal}
					onPick={(loc) => save({ language: loc })}
				/>
				<MicRow
					onChange={(id) => save({ inputDevice: id })}
					value={form.inputDevice}
				/>
			</section>

			<h2 className='section-title'>{t('preferences.section.system')}</h2>
			<SystemCard
				autostart={autostart}
				keepInClipboard={form.keepInClipboard === true}
				onAutostart={async () => {
					onAutostart(!autostart)
					await window.electron.setAutostart(!autostart)
				}}
				onKeepClipboard={() =>
					save({ keepInClipboard: !(form.keepInClipboard === true) })
				}
			/>

			{capturing && (
				<CaptureDialog
					isMac={window.electron.platform === 'darwin'}
					onCancel={handleCancel}
					onCapture={handleCapture}
				/>
			)}
		</>
	)
}

// The shortcut on a key cap and the way to change it: our capture dialog, or the
// compositor's own dialog where the portal owns the binding (Wayland).
function ShortcutRow({
	shortcut,
	keys,
	onCapture,
}: {
	shortcut: NonNullable<Props['shortcut']>
	keys: string[]
	onCapture: () => Promise<void>
}): React.ReactElement {
	const t = useT()
	const portal = shortcut.backend === 'portal'
	return (
		<div className='row'>
			<div className='row-text'>
				<span className='label'>{t('preferences.shortcut')}</span>
				<span className='desc'>{t('preferences.shortcutDesc')}</span>
			</div>
			<div className='hstack gap-2'>
				<kbd className='kbd kbd-lg'>
					{portal
						? shortcut.trigger || t('preferences.shortcutSystemManaged')
						: keys.join(' + ')}
				</kbd>
				<button
					className='btn btn-outline btn-sm'
					onClick={() =>
						portal ? window.electron.configureShortcuts() : onCapture()
					}
					type='button'
				>
					<PixelIcon className='pxi-ctl' name='keyboard' />
					{t(portal ? 'preferences.changeInSystem' : 'preferences.change')}
				</button>
			</div>
		</div>
	)
}

function LanguageRow({
	language,
	hint,
	onOpenLocal,
	onPick,
}: {
	language: string
	hint: boolean
	onOpenLocal: () => void
	onPick: (loc: string) => void
}): React.ReactElement {
	const t = useT()
	return (
		<div className='row row-top'>
			<div className='row-text'>
				<span className='label'>{t('preferences.recognitionLanguage')}</span>
				<span className='desc'>
					{hint ? (
						<LanguageHint onOpen={onOpenLocal} />
					) : (
						t('preferences.recognitionLanguageDesc')
					)}
				</span>
			</div>
			<div
				aria-label={t('preferences.recognitionLanguage')}
				className='chips'
				role='radiogroup'
			>
				{RECOGNITION_LANGUAGES.map((loc) => (
					// biome-ignore lint/a11y/useSemanticElements: a styled chip; a native radio input cannot render this appearance
					<button
						aria-checked={language === loc}
						className='chip'
						key={loc}
						onClick={() => onPick(loc)}
						role='radio'
						type='button'
					>
						{LANGUAGE_NAMES[loc] || loc.toUpperCase()}
					</button>
				))}
			</div>
		</div>
	)
}

// Enumerating devices is what spawns Chromium's "VideoCaptureService" utility
// process (the API lists cameras too, even though we only ever read audio inputs)
// — a scary name to meet in Task Manager under a dictation app. Deferred to the
// first hover/focus on the mic picker: the process never exists unless the user
// actually reaches for the device list, and the ~10 ms enumeration finishes before
// the click that opens the popup.
function MicRow({
	value,
	onChange,
}: {
	value?: string
	onChange: (deviceId: string) => void
}): React.ReactElement {
	const t = useT()
	const id = useId()
	const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
	const enumerated = useRef<boolean>(false)
	function loadDevices(): void {
		if (enumerated.current) return
		enumerated.current = true
		navigator.mediaDevices
			.enumerateDevices()
			.then((all) => setDevices(all.filter((d) => d.kind === 'audioinput')))
			.catch(() => {
				enumerated.current = false
			})
	}
	const fallback = (deviceId: string) =>
		t('preferences.microphoneFallback', { id: deviceId.slice(0, 8) })
	return (
		<div className='row'>
			<div className='row-text'>
				<label className='label' htmlFor={id}>
					{t('preferences.microphone')}
				</label>
			</div>
			<select
				className='select'
				id={id}
				onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
					onChange(e.target.value)
				}
				onFocus={loadDevices}
				onPointerEnter={loadDevices}
				value={value || 'default'}
			>
				<option value='default'>{t('preferences.deviceDefault')}</option>
				{/* A saved non-default device must stay visible before enumeration
            runs, or the select would render blank until the first hover. */}
				{value &&
					value !== 'default' &&
					!devices.some((d) => d.deviceId === value) && (
						<option value={value}>{fallback(value)}</option>
					)}
				{devices.map((d) => (
					<option key={d.deviceId} value={d.deviceId}>
						{d.label || fallback(d.deviceId)}
					</option>
				))}
			</select>
		</div>
	)
}

function SystemCard({
	autostart,
	keepInClipboard,
	onAutostart,
	onKeepClipboard,
}: {
	autostart: boolean
	keepInClipboard: boolean
	onAutostart: () => Promise<void>
	onKeepClipboard: () => Promise<void>
}): React.ReactElement {
	const t = useT()
	const os = window.electron.platform
	const autostartKey = os === 'darwin' ? 'Mac' : os === 'linux' ? 'Linux' : ''
	return (
		<section className='card'>
			<SwitchRow
				desc={t(`preferences.autostart.desc${autostartKey}`)}
				label={t(`preferences.autostart.label${autostartKey}`)}
				on={autostart}
				onChange={onAutostart}
			/>
			<SwitchRow
				desc={t('preferences.keepClipboard.desc')}
				label={t('preferences.keepClipboard.label')}
				on={keepInClipboard}
				onChange={onKeepClipboard}
			/>
		</section>
	)
}

// Local mode with an English-only speech model and another dictation language:
// said where the language changes, not only in the Local tab.
function useLanguageHint(localMode: boolean, language?: string): boolean {
	const [hint, setHint] = useState<boolean>(false)
	useEffect(() => {
		if (!localMode) return setHint(false)
		window.electron
			.getLocalStatus()
			.then((s) => setHint(Boolean(s.languageHint && language)))
	}, [localMode, language])
	return hint
}

function LanguageHint({ onOpen }: { onOpen: () => void }): React.ReactElement {
	const t = useT()
	return (
		<>
			{t('local.hint.prefs')}{' '}
			<button className='link' onClick={onOpen} type='button'>
				{t('local.hint.open')}
			</button>
		</>
	)
}

/** A card row with a label, a description and a switch on the right. */
function SwitchRow({
	label,
	desc,
	on,
	onChange,
}: {
	label: string
	desc: string
	on: boolean
	onChange: () => void | Promise<void>
}): React.ReactElement {
	const labelId = useId()
	return (
		<div className='row'>
			<div className='row-text'>
				<span className='label' id={labelId}>
					{label}
				</span>
				<span className='desc'>{desc}</span>
			</div>
			<Switch aria-labelledby={labelId} on={on} onToggle={onChange} />
		</div>
	)
}

function CaptureDialog({
	onCapture,
	onCancel,
	isMac,
}: CaptureDialogProps): React.ReactElement {
	const t = useT()
	const titleId = useId()
	useEffect(() => {
		const lone = loneModifier()

		const down = (e: KeyboardEvent): void => {
			e.preventDefault()
			e.stopPropagation()
			if (e.key === 'Escape') {
				onCancel()
				return
			}
			const combo = eventToShortcut(e) // non-null only for an ordinary key (+ optional mods)
			if (combo) onCapture(combo)
			else lone.down(e) // a bare modifier: finished when it is released alone
		}

		const up = (e: KeyboardEvent): void => {
			e.preventDefault()
			e.stopPropagation()
			const mod = lone.up(e)
			if (mod) onCapture(mod)
		}

		window.addEventListener('keydown', down, { capture: true })
		window.addEventListener('keyup', up, { capture: true })
		return () => {
			window.removeEventListener('keydown', down, { capture: true })
			window.removeEventListener('keyup', up, { capture: true })
		}
	}, [onCancel, onCapture])

	const esc = <kbd className='kbd'>Esc</kbd>
	// macOS shows native symbols (⌘ ⌥ ⌃); other platforms the Ctrl/Alt/Shift names.
	const hint = isMac
		? renderTemplate(t('preferences.capture.hintMac'), {
				cmd: <kbd className='kbd'>⌘</kbd>,
				ctl: <kbd className='kbd'>⌃</kbd>,
				opt: <kbd className='kbd'>⌥</kbd>,
			})
		: renderTemplate(t('preferences.capture.hint1'), {
				alt: <kbd className='kbd'>Alt</kbd>,
				ctrl: <kbd className='kbd'>Ctrl</kbd>,
				shift: <kbd className='kbd'>Shift</kbd>,
			})

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: click-outside backdrop, not a widget — the keyboard path is the window-level Escape handler above
		<div
			className='overlay'
			onClick={(e: React.MouseEvent<HTMLDivElement>) => {
				if (e.target === e.currentTarget) onCancel()
			}}
			role='presentation'
		>
			<div
				aria-labelledby={titleId}
				aria-modal='true'
				className='dialog'
				role='dialog'
			>
				<span className='pulse'>
					<PixelIcon className='pxi-lg' name='keyboard' />
				</span>
				<h2 className='text-lg font-semibold' id={titleId}>
					{t('preferences.capture.title')}
				</h2>
				<p className='muted capture-hint'>
					{hint}
					<br />
					{renderTemplate(t('preferences.capture.hint2'), { esc })}
				</p>
				<button className='btn btn-outline' onClick={onCancel} type='button'>
					{t('common.cancel')}
				</button>
			</div>
		</div>
	)
}
