// Convert KeyboardEvent → Electron-compatible shortcut string using e.code
// (layout-independent: cyrillic / latin layouts give the same result).

const CODE_MAP: Record<string, string> = {
	ArrowDown: 'Down',
	ArrowLeft: 'Left',
	ArrowRight: 'Right',
	ArrowUp: 'Up',
	Backspace: 'Backspace',
	Delete: 'Delete',
	End: 'End',
	Enter: 'Return',
	Escape: 'Escape',
	Home: 'Home',
	PageDown: 'PageDown',
	PageUp: 'PageUp',
	Space: 'Space',
	Tab: 'Tab',
}

export function eventToShortcut(e: KeyboardEvent): string | null {
	// Derive the key name ONLY from e.code (physical key, layout-independent) and
	// ONLY for keys the main-process shortcut parser (electron/shortcuts/uiohook.ts)
	// can parse. Never fall back to e.key: on macOS, Option (Alt) + a key produces a
	// dead key, so e.key becomes "Dead" and we would persist an unparseable
	// shortcut like "Alt+Dead" that leaves the app with no working shortcut.
	const mapped = CODE_MAP[e.code]
	let key: string | null = null
	if (mapped) key = mapped
	else if (/^F([1-9]|1[0-2])$/u.test(e.code))
		key = e.code // F1–F12
	else if (/^Key[A-Z]$/u.test(e.code))
		key = e.code.slice(3) // letter keys → A–Z
	else if (/^Digit[0-9]$/u.test(e.code)) key = e.code.slice(5) // number row → 0–9
	if (key === null) return null // unsupported (punctuation, numpad, dead, media) — ignore the capture

	const mods: string[] = []
	if (e.ctrlKey) mods.push('Ctrl')
	if (e.altKey) mods.push('Alt')
	if (e.shiftKey) mods.push('Shift')
	if (e.metaKey) mods.push('Super')

	return mods.length > 0 ? `${mods.join('+')}+${key}` : key
}

// e.code of a modifier key → the shortcut token used by electron/shortcuts/. Left and
// right variants are distinct (right ⌘ = 'MetaRight'). Used to capture a single
// modifier held alone as a push-to-talk trigger (the macOS default style).
const CODE_TO_MODIFIER: Record<string, string> = {
	AltLeft: 'Alt',
	AltRight: 'AltRight',
	ControlLeft: 'Ctrl',
	ControlRight: 'CtrlRight',
	MetaLeft: 'Meta',
	MetaRight: 'MetaRight',
	ShiftLeft: 'Shift',
	ShiftRight: 'ShiftRight',
}

export function eventToModifier(e: KeyboardEvent): string | null {
	return CODE_TO_MODIFIER[e.code] || null
}

// Human-facing label for a stored shortcut token. macOS gets native symbols
// (⌃⌥⇧⌘, Apple's canonical order); elsewhere modifiers get their key-cap names
// (Win, Super on Linux, Right Ctrl) and other keys stay as stored.
const MAC_SYMBOL: Record<string, string> = {
	Alt: '⌥',
	Cmd: '⌘',
	Control: '⌃',
	Ctrl: '⌃',
	Meta: '⌘',
	Shift: '⇧',
	Super: '⌘',
}
const MOD_TOKEN_LABEL: Record<string, { mac: string; win: string }> = {
	Alt: { mac: '⌥', win: 'Alt' },
	AltRight: { mac: 'Right ⌥', win: 'Right Alt' },
	Ctrl: { mac: '⌃', win: 'Ctrl' },
	CtrlRight: { mac: 'Right ⌃', win: 'Right Ctrl' },
	Meta: { mac: '⌘', win: 'Win' },
	MetaRight: { mac: 'Right ⌘', win: 'Right Win' },
	Shift: { mac: '⇧', win: 'Shift' },
	ShiftRight: { mac: 'Right ⇧', win: 'Right Shift' },
}
const LINUX_TOKEN_LABEL: Record<string, string> = {
	Meta: 'Super',
	MetaRight: 'Right Super',
}

/** The shortcut as one label per key, for key caps: "Alt+Q" → ["Alt", "Q"]. */
export function shortcutKeys(
	shortcut: string | null | undefined,
	platform: string,
): string[] {
	if (!shortcut) return []
	return shortcut.split('+').map((key) => formatShortcut(key, platform))
}

export function formatShortcut(
	shortcut: string | null | undefined,
	platform: string,
): string {
	if (!shortcut) return ''
	const token = MOD_TOKEN_LABEL[shortcut]
	if (platform !== 'darwin') {
		const linux = platform === 'linux' ? LINUX_TOKEN_LABEL[shortcut] : undefined
		return linux ?? (token ? token.win : shortcut)
	}
	if (token) return token.mac
	return String(shortcut)
		.split('+')
		.map((p) => MAC_SYMBOL[p] || p)
		.join(' ')
}
