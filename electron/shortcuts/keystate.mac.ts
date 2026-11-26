import koffi from 'koffi'

import type { Keys } from './keystate'

// Also posts the paste's key events (paste.mac.ts).
export const cg = koffi.load(
	'/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics',
)
const CGEventSourceKeyState = cg.func(
	'bool CGEventSourceKeyState(int32 stateID, uint16 key)',
)

const COMBINED_SESSION = 0 // kCGEventSourceStateCombinedSessionState

// uiohook keycode of a modifier (same on every OS) → macOS virtual keycode.
const MAC_KEYCODE: Record<number, number> = {
	[0x0e_1d]: 0x3e, // Right Ctrl
	[0x0e_5b]: 0x37, // Command
	[0x0e_5c]: 0x36, // Right Command (the default shortcut)
	[0x0e_38]: 0x3d, // Right Option
	[0x00_1d]: 0x3b, // Ctrl
	[0x00_2a]: 0x38, // Shift
	[0x00_36]: 0x3c, // Right Shift
	[0x00_38]: 0x3a, // Option
}

// A modifier hold (the macOS default) reads its own key. A combo's main key has no
// keycode table here, and its modifiers can't stand in for it: letting go of Ctrl
// while still holding Space must not end Ctrl+Space. So combos answer "can't tell".
export const isHeld = (keys: Keys): boolean | undefined => {
	const key = keys.modifierOnly ? MAC_KEYCODE[keys.keycode] : undefined
	return key === undefined
		? undefined
		: CGEventSourceKeyState(COMBINED_SESSION, key)
}
