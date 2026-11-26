import { UiohookKey, uIOhook } from 'uiohook-napi'

import type { ShortcutHandlers } from '.'
import { isHeld, type Keys, maskMenu } from './keystate'

// Shortcut keys are UiohookKey names, plus these spellings from the capture UI.
const ALIASES: Record<string, string> = {
	Down: 'ArrowDown',
	Left: 'ArrowLeft',
	Return: 'Enter',
	Right: 'ArrowRight',
	Up: 'ArrowUp',
}
const keycodeOf = (name: string) => {
	const code = (UiohookKey as Record<string, unknown>)[ALIASES[name] ?? name]
	return typeof code === 'number' ? code : undefined
}

// Modifiers usable as a stand-alone push-to-talk hold. Right variants have
// their own keycodes, so "hold Right ⌘" never collides with Cmd+C / Cmd+V.
const MODIFIER_KEYCODES = new Set(
	[
		'Alt',
		'AltRight',
		'Ctrl',
		'CtrlRight',
		'Meta',
		'MetaRight',
		'Shift',
		'ShiftRight',
	].map(keycodeOf),
)

// A COMBO ("Alt+Q": modifier flags + one ordinary key) or a single MODIFIER
// held alone ("MetaRight", macOS default), which never types a character.
const parseShortcut = (shortcut: string | undefined): Keys | null => {
	const parts = String(shortcut || '').split('+')
	const keycode = keycodeOf(parts.pop() ?? '')
	if (keycode === undefined) return null
	const mods = new Set(parts)
	return {
		alt: mods.has('Alt'),
		ctrl: mods.has('Ctrl') || mods.has('Control'),
		keycode,
		meta: mods.has('Meta') || mods.has('Super') || mods.has('Cmd'),
		modifierOnly: parts.length === 0 && MODIFIER_KEYCODES.has(keycode),
		shift: mods.has('Shift'),
	}
}

let parsed: Keys | null = null
let pressed = false
let captureMode = false
let aborted = false // chord (modifier + other key) mid-hold; suppress release
let hooked = false
let handlers: ShortcutHandlers | null = null

// While held, the OS key state is re-read: two "all up" reads in a row end a hold
// whose keyup never arrived (≤ ~400 ms late). Two, so one racy read mid-keystroke
// can't cut a dictation short; and only once the OS has reported the key held at
// least once, so a state API that can't see it (a missing permission, a wrong key
// mapping) never ends a hold either.
const WATCH_MS = 200
let watch: ReturnType<typeof setInterval> | undefined

const unwatch = () => {
	clearInterval(watch)
	watch = undefined
}

const release = () => {
	unwatch()
	pressed = false
	handlers?.onRelease()
}

const press = () => {
	pressed = true
	if (parsed) maskMenu(parsed) // while Alt/Win is still down
	handlers?.onPress()
	unwatch()
	let seenHeld = false
	let upReads = 0
	watch = setInterval(() => {
		const held = parsed ? isHeld(parsed) : undefined
		if (held === undefined)
			unwatch() // this OS can't tell
		else if (held) {
			seenHeld = true
			upReads = 0
		} else if (seenHeld && ++upReads >= 2) release()
	}, WATCH_MS)
}

export const setShortcut = (shortcut: string | undefined) => {
	unwatch()
	parsed = parseShortcut(shortcut)
	pressed = false
	aborted = false
}

export const setCaptureMode = (enabled: boolean) => {
	captureMode = enabled
	if (!enabled) {
		unwatch()
		pressed = false
		aborted = false
	}
}

export const bind = (next: ShortcutHandlers) => {
	handlers = next
	uIOhook.on('keydown', (e) => {
		const p = parsed
		if (captureMode || !p) return
		if (p.modifierOnly) {
			if (e.keycode === p.keycode) {
				if (!(pressed || aborted)) press()
			} else if (pressed) {
				// Another key while the modifier is held is a real shortcut (⌘C),
				// not dictation: abort so it runs untouched; the modifier's keyup
				// is then ignored.
				unwatch()
				pressed = false
				aborted = true
				handlers?.onAbort?.()
			}
		} else if (
			!pressed &&
			e.keycode === p.keycode &&
			Boolean(e.ctrlKey) === p.ctrl &&
			Boolean(e.altKey) === p.alt &&
			Boolean(e.shiftKey) === p.shift &&
			Boolean(e.metaKey) === p.meta
		)
			press()
	})

	// Keycode only: modifiers are often released before the main key.
	uIOhook.on('keyup', (e) => {
		if (captureMode || e.keycode !== parsed?.keycode) return
		if (aborted) aborted = false
		else if (pressed) release()
	})

	uIOhook.start()
	hooked = true
}

// Windows silently removes a low-level hook that stalls while the process is
// suspended (sleep, hibernate, Win+L), and a keyup on the secure desktop never
// reaches it, wedging pressed/aborted. main.ts calls this on powerMonitor
// resume/unlock-screen. Listeners live on the uIOhook emitter, not the native
// hook, so stop()/start() keeps them; both are no-ops when already in that state.
// A hold the dead hook never saw end is released: the pill would record on.
export const rebind = () => {
	if (!hooked) return // never installed (macOS before Accessibility)
	if (pressed) release()
	aborted = false
	try {
		uIOhook.stop()
	} catch {
		/* already-dead hook is why we're here */
	}
	try {
		uIOhook.start()
	} catch {
		/* next resume/unlock retries */
	}
}

export const unbind = () => {
	unwatch()
	hooked = false
	try {
		uIOhook.stop()
	} catch {
		/* X11 only: XRecord context already gone */
	}
}

// Forked as a utilityProcess (Windows, see uiohook.win.ts).
const port = process.parentPort
if (port) {
	const emit = (type: 'abort' | 'press' | 'release') =>
		port.postMessage({ type })
	bind({
		onAbort: () => emit('abort'),
		onPress: () => emit('press'),
		onRelease: () => emit('release'),
	})
	// The hook is up (start() would have thrown): main may eat the key now.
	port.postMessage({ type: 'ready' })
	port.on('message', ({ data }) => {
		if (data.type === 'shortcut') setShortcut(data.shortcut)
		else if (data.type === 'capture') setCaptureMode(data.enabled)
		else if (data.type === 'rebind') rebind()
	})
}
