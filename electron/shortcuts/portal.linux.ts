import { broadcast } from '../ipc/broadcast'
import {
	type Portal,
	portal,
	type Response,
	type Variant,
} from '../xdg-portal.linux'
import type { ShortcutHandlers } from '.'

const SHORTCUT_ID = 'push-to-talk'

let client: Portal | null = null
let session: string | null = null
let pressed = false
let shortcut: string | undefined
let boundTrigger: string | undefined
let onPressCb: (() => void) | null = null
let onReleaseCb: (() => void) | null = null

const responseResults = ([code, results]: Response, operation: string) => {
	if (code !== 0) throw new Error(`${operation} was declined`)
	return results
}

// Right variants: lone macOS-style triggers the spec cannot express.
const MODIFIERS: Record<string, string | undefined> = {
	Alt: 'ALT',
	AltRight: undefined,
	Cmd: 'LOGO',
	Control: 'CTRL',
	Ctrl: 'CTRL',
	CtrlRight: undefined,
	Meta: 'LOGO',
	MetaRight: undefined,
	Shift: 'SHIFT',
	ShiftRight: undefined,
	Super: 'LOGO',
}

const KEYSYMS: Record<string, string> = {
	Backspace: 'BackSpace',
	PageDown: 'Page_Down',
	PageUp: 'Page_Up',
	Space: 'space',
}

// Spec grammar is MODIFIER+…+key (`a`, `CTRL+a`, `F9`) with no modifier-only form,
// so a shortcut ending in a modifier sends no preference and the compositor asks.
const preferredTrigger = (combo: string | undefined): string | undefined => {
	const parts = String(combo || '').split('+')
	const key = parts.at(-1)
	if (!key || key in MODIFIERS) return undefined
	return [
		...parts
			.slice(0, -1)
			.map((part) => MODIFIERS[part])
			.filter(Boolean),
		KEYSYMS[key] ?? (key.length === 1 ? key.toLowerCase() : key),
	].join('+')
}

const updateTrigger = (shortcuts: unknown) => {
	const ours = (shortcuts as [string, { trigger_description?: string }][]).find(
		([id]) => id === SHORTCUT_ID,
	)
	boundTrigger = ours?.[1].trigger_description
	broadcast('shortcut-bound', boundTrigger)
}

// Observed on GNOME 50: holding trigger fires Activated once, then per
// key-repeat (30 ms, after 500 ms delay) until Deactivated; the `pressed` guard
// collapses those. Signals carry compositor timestamp (body[2], ms). Activated
// stamped at or before last Deactivated = repeat that lost a race with the
// release; must not re-arm the hold, or recording never stops (no release poller
// on Wayland). KDE and Hyprland never emit repeats.
let lastDeactivatedTs = 0

const createSession = async () => {
	const next = await portal()
	// A reconnected bus (xdg-portal.linux 'close') has no signal handlers.
	if (next !== client) {
		client = next
		client.onSignal('GlobalShortcuts', 'Activated', (body) => {
			if (body[0] !== session || body[1] !== SHORTCUT_ID) return
			const ts = Number(body[2] ?? 0)
			if (ts > 0 && ts <= lastDeactivatedTs) return
			if (!pressed) {
				pressed = true
				onPressCb?.()
			}
		})
		client.onSignal('GlobalShortcuts', 'Deactivated', (body) => {
			if (body[0] !== session || body[1] !== SHORTCUT_ID) return
			const ts = Number(body[2] ?? 0)
			if (ts > 0) lastDeactivatedTs = ts
			if (!pressed) return
			pressed = false
			onReleaseCb?.()
		})
		client.onSignal('GlobalShortcuts', 'ShortcutsChanged', (body) => {
			if (body[0] === session) updateTrigger(body[1])
		})
	}

	const created = responseResults(
		await client.request(
			'GlobalShortcuts',
			'CreateSession',
			'a{sv}',
			(token) => [
				Object.entries<Variant>({
					handle_token: ['s', token],
					session_handle_token: ['s', token],
				}),
			],
		),
		'GlobalShortcuts.CreateSession',
	)
	const handle = created.session_handle
	if (typeof handle !== 'string')
		throw new Error('GlobalShortcuts.CreateSession returned no session handle')

	const preferred = preferredTrigger(shortcut)
	const bound = responseResults(
		await client.request(
			'GlobalShortcuts',
			'BindShortcuts',
			'oa(sa{sv})sa{sv}',
			(token) => [
				handle,
				[
					[
						SHORTCUT_ID,
						Object.entries<Variant>({
							description: ['s', 'Push to talk'],
							...(preferred && { preferred_trigger: ['s', preferred] }),
						}),
					],
				],
				'',
				Object.entries<Variant>({ handle_token: ['s', token] }),
			],
		),
		'GlobalShortcuts.BindShortcuts',
	)
	// Only a bound session is ours to keep: a declined bind leaves `session`
	// null, so rebind retries and configure stays a no-op.
	session = handle
	updateTrigger(bound.shortcuts)
}

const closeSession = async () => {
	const closing = session
	session = null
	pressed = false
	updateTrigger([])
	if (client && closing) {
		await client.closeSession(closing)
	}
}

export const setShortcut = (next: string | undefined) => {
	shortcut = next
}

export const bind = async ({ onPress, onRelease }: ShortcutHandlers) => {
	onPressCb = onPress
	onReleaseCb = onRelease
	await createSession()
}

export const rebind = () => {
	if (!onPressCb) return
	closeSession()
		.catch(() => undefined)
		.then(createSession)
		.catch(() => {
			/* no compositor yet (mid-resume); next rebind retries */
		})
}

export const unbind = () => {
	onPressCb = null
	onReleaseCb = null
	closeSession().catch(() => {
		/* session usually died with compositor; nothing to close */
	})
}

export const trigger = () => boundTrigger

export const configure = async (): Promise<void> => {
	if (!(client && session)) return
	await client.call('GlobalShortcuts', 'ConfigureShortcuts', 'osa{sv}', [
		session,
		'',
		[],
	])
}
