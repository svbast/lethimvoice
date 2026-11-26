import { setTimeout as wait } from 'node:timers/promises'
import koffi from 'koffi'

import { anyModifierDown, key, user32, VK } from '../utils/keyboard.win'

const kernel32 = koffi.load('kernel32.dll')

// Win32 signatures. `_Out_`/`_Inout_` params: JS passes 1-element arrays, koffi
// writes result back into [0]. koffi typings leave declared funcs variadic and
// untyped — the C prototype string IS the signature, checked by koffi at call
// time, not tsc.
const GetForegroundWindow = user32.func('void* GetForegroundWindow()')
const GetWindowThreadProcessId = user32.func(
	'uint32 GetWindowThreadProcessId(void* hWnd, _Out_ uint32 *lpdwProcessId)',
)
const SetForegroundWindow = user32.func(
	'bool   SetForegroundWindow(void* hWnd)',
)
const AttachThreadInput = user32.func(
	'bool   AttachThreadInput(uint32 idAttach, uint32 idAttachTo, bool fAttach)',
)

const GetCurrentThreadId = kernel32.func('uint32 GetCurrentThreadId()')

const MODIFIER_WAIT_MS = 1000
// Each new clipboard entry is opened and copied by Win+V history and clipboard
// managers; a target whose OpenClipboard lands meanwhile fails it, pastes nothing.
const SETTLE_MS = 30

// Opaque koffi HWND — only ever handed straight back to Win32.
let targetHwnd: unknown = null

// Skips our own windows (every BrowserWindow HWND is owned by this process):
// previously-active app stays paste target even if the recording pill briefly fronts.
export const captureForegroundWindow = (): void => {
	try {
		const hwnd = GetForegroundWindow()
		if (!hwnd) return
		const pidRef: [number] = [0]
		GetWindowThreadProcessId(hwnd, pidRef)
		if (pidRef[0] === process.pid) return
		targetHwnd = hwnd
	} catch {
		/* FFI failure keeps previously captured target, never throws */
	}
}

// Read when a paste is queued (paste.ts): a press while it waits re-captures, and
// must not redirect it.
export const pasteTarget = (): unknown => targetHwnd

// keybd_event MUST be sent WHILE AttachThreadInput is active — detaching first
// routes keys to whatever window Windows currently focuses.
//
// Virtual key codes (VK_CONTROL=0x11, VK_V=0x56) make paste work on any keyboard
// layout, unlike SendKeys which encodes characters and would emit cyrillic 'В'
// under a Russian/Ukrainian layout.
export const simulatePaste = async (
	target: unknown = targetHwnd,
): Promise<boolean> => {
	let attached = false
	let myTid = 0
	let tgtTid = 0
	try {
		// Hotkey modifiers still held (the Alt of Alt+Q) turn Ctrl+V into Ctrl+Alt+V,
		// AltGr+V on Slovak/German layouts that types nothing, or Win+Ctrl+V. Wait
		// them out; never fake their key-ups: an injected Alt up with no key before it
		// opens the menu bar, which then takes the paste (OpenWhispr #2983).
		for (let t = 0; anyModifierDown() && t < MODIFIER_WAIT_MS; t += 10)
			await wait(10)
		await wait(SETTLE_MS)

		// Only a window that lost the foreground is brought back: re-fronting one
		// that still has it can drop the caret of a Chromium field (OpenWhispr #668),
		// and the usual case then needs no AttachThreadInput at all.
		const front = GetForegroundWindow()
		if (target && (!front || koffi.address(front) !== koffi.address(target))) {
			const pidRef = [0]
			tgtTid = GetWindowThreadProcessId(target, pidRef)
			myTid = GetCurrentThreadId()
			if (tgtTid && myTid && tgtTid !== myTid) {
				attached = AttachThreadInput(myTid, tgtTid, true)
			}
			SetForegroundWindow(target)
			// Brief sleep: Windows needs time to switch focus before typing.
			await wait(50)
		}

		key(VK.CONTROL, false)
		key(VK.V, false)
		await wait(50)
		key(VK.V, true)
		key(VK.CONTROL, true)
		return true
	} catch {
		return false
	} finally {
		if (attached) {
			try {
				AttachThreadInput(myTid, tgtTid, false)
			} catch {
				/* detach best-effort: paste already landed */
			}
		}
	}
}
