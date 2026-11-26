import { useEffect, useId, useRef, useState } from 'react'
import Hero from '../../components/Hero'
import PixelIcon from '../../components/PixelIcon'
import { useSaveLater } from '../../hooks/useSaveLater'
import { type TFn, useT } from '../../i18n'

interface CustomMode {
	id: string
	title?: string
	promptText?: string
}
interface EditingMode {
	id?: string
	title: string
	promptText: string
}
interface Settings {
	activeModeId?: string
	modes?: CustomMode[]
	personalPreferences?: string
}
interface Props {
	settings: Settings
	/** Shows a change at once, without saving it. */
	onPatch: (patch: Settings) => void
}
interface OwnModeCardProps {
	active: boolean
	title: string
	onSelect: () => void | Promise<void>
	onEdit: () => void
	t: TFn
}
interface ModeEditorProps {
	editing: EditingMode
	setEditing: React.Dispatch<React.SetStateAction<EditingMode | null>>
	onSave: () => Promise<void>
	onDelete: () => Promise<void>
	t: TFn
}
interface PersonalPreferencesProps {
	settings: Settings
	onPatch: (patch: Settings) => void
	t: TFn
}

// The built-in mode ids, in deliberate render order: everyday cleanup/format
// modes first, then the power modes (rewrite/assistant), Raw (no AI) last.
// Must stay in sync with BUILTIN_MODES in electron/pipeline/prompts.ts — the
// list is fixed, so the renderer holds it rather than asking main for it.
// Custom user modes render after these. Each id is also its pixel icon's name.
const BUILTIN_ORDER = [
	'clean',
	'email',
	'chat',
	'todo',
	'rewrite',
	'assistant',
	'translate',
	'raw',
] as const

// The whole Prompts tab: pick the active mode, manage custom modes, and set the
// personal preferences.
//
// Personal preferences is deliberately the ONLY prompt field in the app, and its
// value is the ONLY app-controlled text that reaches Whisper. The one value feeds
// both stages, so the user states names and spellings once: Whisper's
// initial_prompt (pipeline/cloud.ts, pipeline/local.ts) and the LLM's spelling
// authority (pipeline/prompts.ts).
//
// Exactly one prompt stays hidden — the safety wrapper in prompts.ts, which carries
// rules rather than content. Nothing else is added behind the user's back, so what
// they see here is what the models get.
export default function PromptsTab({
	settings,
	onPatch,
}: Props): React.ReactElement {
	const t = useT()
	const [editing, setEditing] = useState<EditingMode | null>(null)

	const activeId = settings.activeModeId || 'clean'
	const customModes = Array.isArray(settings.modes) ? settings.modes : []
	const titleOf = (m: CustomMode): string => m.title || t('modes.untitled')

	// Hero: the active mode. An id that matches nothing reads as Clean, the default.
	const own = customModes.find((m) => m.id === activeId)
	const builtin = BUILTIN_ORDER.find((id) => id === activeId) ?? 'clean'
	const activeName = own ? titleOf(own) : t(`modes.${builtin}.title`)

	// Saved first: main's merged settings are what the tab shows.
	async function patch(p: Settings): Promise<void> {
		const merged = await window.electron.saveSettings(p)
		onPatch(merged)
	}
	const setActive = (id: string): Promise<void> => patch({ activeModeId: id })

	function startAdd(): void {
		setEditing({ promptText: '', title: '' })
	}
	function startEdit(m: CustomMode): void {
		setEditing({
			id: m.id,
			promptText: m.promptText || '',
			title: m.title || '',
		})
	}

	async function saveEditing(): Promise<void> {
		if (!editing) return
		const promptText = editing.promptText.trim()
		if (!promptText) return
		const title = editing.title.trim() || t('modes.untitled')

		if (editing.id) {
			const next = customModes.map((m) =>
				m.id === editing.id ? { ...m, promptText, title } : m,
			)
			await patch({ modes: next })
		} else {
			const id = crypto.randomUUID()
			const next = [...customModes, { id, promptText, title }]
			await patch({ activeModeId: id, modes: next }) // newly added mode becomes active
		}
		setEditing(null)
	}

	async function deleteEditing(): Promise<void> {
		if (!editing?.id) {
			setEditing(null)
			return
		}
		const p: Settings = {
			modes: customModes.filter((m) => m.id !== editing.id),
		}
		if (activeId === editing.id) p.activeModeId = 'clean' // don't strand the selection
		await patch(p)
		setEditing(null)
	}

	// .mode-card, .mode-card__title, .mode-editor and .modes__prefs are not for
	// styling: e2e/modes.spec.ts and e2e/autosave.spec.ts find the cards by them.
	return (
		<>
			<Hero
				anim='read'
				badge={`${t('modes.hero.modes', { n: BUILTIN_ORDER.length })} · ${t(
					'modes.hero.custom',
					{ n: customModes.length },
				)}`}
				desc={own ? own.promptText || '' : t(`modes.${builtin}.desc`)}
				plate={{
					kind: 'value',
					label: t('modes.hero.plate'),
					value: activeName,
				}}
				title={t('modes.hero.title', { name: activeName })}
				tone='plain'
			/>

			<h2 className='section-title'>{t('modes.section.label')}</h2>
			<section className='stack gap-3'>
				<p className='card-desc'>{t('modes.section.desc')}</p>

				<div
					aria-label={t('modes.section.label')}
					className='grid-3'
					role='radiogroup'
				>
					{BUILTIN_ORDER.map((id) => (
						// biome-ignore lint/a11y/useSemanticElements: a styled card; a native radio input cannot render this appearance
						<button
							aria-checked={activeId === id}
							className='option mode-card'
							key={id}
							onClick={() => setActive(id)}
							role='radio'
							type='button'
						>
							<span className='hstack between'>
								<span className='hstack gap-2 font-medium mode-card__title'>
									<PixelIcon name={id} />
									{t(`modes.${id}.title`)}
								</span>
								<span className='radio' />
							</span>
							<span className='desc'>{t(`modes.${id}.desc`)}</span>
						</button>
					))}
					{customModes.map((m) => (
						<OwnModeCard
							active={activeId === m.id}
							key={m.id}
							onEdit={() => startEdit(m)}
							onSelect={() => setActive(m.id)}
							t={t}
							title={titleOf(m)}
						/>
					))}
					{!editing && (
						<button
							className='option option-add gap-2'
							onClick={startAdd}
							type='button'
						>
							<PixelIcon className='pxi-sm' name='plus' />
							{t('modes.addCustom')}
						</button>
					)}
				</div>

				{editing && (
					<ModeEditor
						editing={editing}
						onDelete={deleteEditing}
						onSave={saveEditing}
						setEditing={setEditing}
						t={t}
					/>
				)}
			</section>

			<PersonalPreferences onPatch={onPatch} settings={settings} t={t} />
		</>
	)
}

// The user's own mode: a div, not a button, because it holds the edit button.
function OwnModeCard({
	active,
	title,
	onSelect,
	onEdit,
	t,
}: OwnModeCardProps): React.ReactElement {
	return (
		// biome-ignore lint/a11y/useSemanticElements: <input type="radio"> cannot contain the nested edit button this card renders
		<div
			aria-checked={active}
			className='option mode-card prompts-custom'
			onClick={onSelect}
			onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
				// Keys on the edit button are its own: selecting here would swallow its Enter.
				if (e.target !== e.currentTarget) return
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault()
					onSelect()
				}
			}}
			role='radio'
			tabIndex={0}
		>
			<span className='hstack gap-2 font-medium mode-card__title prompts-own-title'>
				<PixelIcon name='prompts' />
				{title}
			</span>
			<span className='badge badge-outline'>{t('modes.customTag')}</span>
			<button
				aria-label={t('modes.editor.titleEdit')}
				className='btn btn-ghost btn-icon btn-sm prompts-edit'
				onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
					e.stopPropagation()
					onEdit()
				}}
				type='button'
			>
				<PixelIcon className='pxi-ctl' name='pencil' />
			</button>
		</div>
	)
}

function ModeEditor({
	editing,
	setEditing,
	onSave,
	onDelete,
	t,
}: ModeEditorProps): React.ReactElement {
	const nameId = useId()
	const textId = useId()
	const nameRef = useRef<HTMLInputElement>(null)

	// The Add button that opened the editor is gone, so focus would fall to the page:
	// land on the name instead, which also scrolls the editor into view.
	useEffect(() => {
		nameRef.current?.focus()
	}, [])

	return (
		<section className='card card-pad stack gap-4 mode-editor'>
			<h3 className='card-title'>
				{t(editing.id ? 'modes.editor.titleEdit' : 'modes.editor.titleNew')}
			</h3>

			<div className='stack gap-2'>
				<label className='label' htmlFor={nameId}>
					{t('modes.editor.name')}
				</label>
				<input
					className='input'
					id={nameId}
					maxLength={40}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
						setEditing({ ...editing, title: e.target.value })
					}
					placeholder={t('modes.namePlaceholder')}
					ref={nameRef}
					value={editing.title}
				/>
			</div>

			<div className='stack gap-2'>
				<label className='label' htmlFor={textId}>
					{t('modes.editor.instructions')}
				</label>
				<textarea
					className='textarea'
					id={textId}
					onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
						setEditing({ ...editing, promptText: e.target.value })
					}
					placeholder={t('modes.instructionsPlaceholder')}
					rows={5}
					spellCheck={false}
					value={editing.promptText}
				/>
			</div>

			<div className='hstack gap-2 prompts-actions'>
				{editing.id && (
					<button
						className='btn btn-ghost prompts-delete'
						onClick={onDelete}
						type='button'
					>
						<PixelIcon className='pxi-ctl' name='trash' />
						{t('common.delete')}
					</button>
				)}
				<button
					className='btn btn-outline'
					onClick={() => setEditing(null)}
					type='button'
				>
					{t('common.cancel')}
				</button>
				<button
					className='btn btn-default'
					disabled={!editing.promptText.trim()}
					onClick={onSave}
					type='button'
				>
					{t('common.save')}
				</button>
			</div>
		</section>
	)
}

// Global preferences string, saved as typed (useSaveLater) — no Save button.
function PersonalPreferences({
	settings,
	onPatch,
	t,
}: PersonalPreferencesProps): React.ReactElement {
	const [saveLater, flush] = useSaveLater()
	const prefsId = useId()

	return (
		<>
			<h2 className='section-title'>{t('modes.personal.label')}</h2>
			<section className='card card-pad stack gap-3 modes__prefs'>
				<label className='card-desc' htmlFor={prefsId}>
					{t('modes.personal.desc')}
				</label>
				<textarea
					className='textarea'
					id={prefsId}
					onBlur={flush}
					onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
						onPatch({ personalPreferences: e.target.value })
						saveLater({ personalPreferences: e.target.value })
					}}
					placeholder={t('modes.personal.placeholder')}
					// 4 rows show the 3-line example placeholder whole and leave room to type.
					rows={4}
					spellCheck={false}
					value={settings.personalPreferences || ''}
				/>
			</section>
		</>
	)
}
