import { execFile } from 'node:child_process'
import { setTimeout as wait } from 'node:timers/promises'
import koffi from 'koffi'

import { isAccessibilityTrusted } from '../permissions.mac'
import { cg } from '../shortcuts/keystate.mac'
import { isTypedBrowser, typingChunks } from './typing'

const cf = koffi.load(
	'/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation',
)
const CGEventCreateKeyboardEvent = cg.func(
	'void* CGEventCreateKeyboardEvent(void* source, uint16 virtualKey, bool keyDown)',
)
const CGEventSetFlags = cg.func(
	'void CGEventSetFlags(void* event, uint64 flags)',
)
const CGEventKeyboardSetUnicodeString = cg.func(
	'void CGEventKeyboardSetUnicodeString(void* event, size_t length, const uint16* string)',
)
const CGEventPost = cg.func('void CGEventPost(uint32 tap, void* event)')
const CGEventPostToPid = cg.func(
	'void CGEventPostToPid(int32 pid, void* event)',
)
const CFRelease = cf.func('void CFRelease(void* cf)')

const kVK_ANSI_V = 0x09
const kCGEventFlagMaskCommand = 0x10_00_00
const kCGHIDEventTap = 0
// Some targets drop a 0 ms chord; Handy holds 100 ms, paste.win.ts 50 ms.
const CHORD_HOLD_MS = 50
// Between the clipboard write and ⌘V (OpenWhispr 120 ms, VoiceInk 200 ms).
const PRE_PASTE_MS = 100

const postCommandV = (keyDown: boolean): boolean => {
	const event = CGEventCreateKeyboardEvent(null, kVK_ANSI_V, keyDown)
	if (!event) return false
	// Exactly ⌘: a still-held Option or Shift must not ride along.
	CGEventSetFlags(event, kCGEventFlagMaskCommand)
	CGEventPost(kCGHIDEventTap, event)
	CFRelease(event)
	return true
}

// The app frontmost at press: the recording panel never takes focus, so it is the
// one the text goes to. Through JXA, not objc_msgSend over FFI, where one wrong
// prototype crashes the app; its ~100 ms passes while the user speaks.
interface Frontmost {
	bundleId: string
	pid: number
}
let frontmost: Promise<Frontmost | null> = Promise.resolve(null)
const FRONTMOST_JXA = [
	"ObjC.import('AppKit')",
	'const a = $.NSWorkspace.sharedWorkspace.frontmostApplication',
	"a.processIdentifier + ' ' + a.bundleIdentifier.js",
].join('; ')

// Read when a paste is queued (paste.ts): a press while it waits re-captures.
export const pasteTarget = (): unknown => frontmost

export const captureForegroundWindow = (): void => {
	frontmost = new Promise((resolve) => {
		execFile(
			'osascript',
			['-l', 'JavaScript', '-e', FRONTMOST_JXA],
			{ timeout: 2000 },
			(error, stdout) => {
				const m = error ? null : /^(\d+) (\S+)/u.exec(String(stdout).trim())
				resolve(m ? { bundleId: String(m[2]), pid: Number(m[1]) } : null)
			},
		)
	})
}

// Straight to the browser's process: switching apps mid-way can't redirect the
// rest, and keyboard monitors (text expanders) never see it. Once an event is out,
// true even on a failure: pasting as well would insert part of it twice.
export const typeText = async (
	text: string,
	target: unknown = frontmost,
): Promise<boolean> => {
	const app = await (target as Promise<Frontmost | null>)
	const chunks = app && isTypedBrowser(app.bundleId) ? typingChunks(text) : null
	// Without the grant the events vanish: simulatePaste then reports it.
	if (!(app && chunks && isAccessibilityTrusted())) return false
	let posted = false
	for (const chunk of chunks) {
		const units = new Uint16Array(chunk.length)
		for (let i = 0; i < chunk.length; i++) units[i] = chunk.charCodeAt(i)
		for (const keyDown of [true, false]) {
			const event = CGEventCreateKeyboardEvent(null, 0, keyDown)
			if (!event) return posted
			CGEventSetFlags(event, 0)
			CGEventKeyboardSetUnicodeString(event, units.length, units)
			CGEventPostToPid(app.pid, event)
			CFRelease(event)
			posted = true
		}
		await wait(2)
	}
	return true
}

/**
 * ⌘V into frontmost. Never re-activate target app first: switches Spaces, pastes
 * into wrong window. Silently dropped without the Accessibility grant (revoked
 * while running), so then false: the transcript stays on the clipboard.
 */
export const simulatePaste = async (): Promise<boolean> => {
	if (!isAccessibilityTrusted()) return false
	await wait(PRE_PASTE_MS)
	if (!postCommandV(true)) return false
	await wait(CHORD_HOLD_MS)
	postCommandV(false)
	return true
}
