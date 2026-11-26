import * as path from 'node:path'

import {
	app,
	globalShortcut,
	type UtilityProcess,
	utilityProcess,
} from 'electron'

import type { ShortcutHandlers } from '.'

// While a mic stream is live Chromium registers a process-wide raw-input
// keyboard sink (WebRTC typing-noise suppression), and a WH_KEYBOARD_LL hook
// in the same process stops being called (uiohook-napi #54, CEF #2609). The
// fix both threads land on is another process: the uiohook backend runs in a
// utilityProcess and this module stands in for it in shortcuts/index.ts.
type Msg =
	| { type: 'shortcut'; shortcut: string | undefined }
	| { type: 'capture'; enabled: boolean }
	| { type: 'rebind' }

type Edge = 'abort' | 'press' | 'release'

let child: UtilityProcess | null = null
let callbacks: Partial<Record<Edge, () => void>> = {}
// Last shortcut/capture, replayed into a respawned child.
const state: Partial<Record<Msg['type'], Msg>> = {}

// The hook only listens, so the shortcut's key still reaches the focused app: Alt+Q
// opens the search box of Word/Outlook/Teams, which then takes the paste. The same
// keys registered as a global shortcut are eaten there (OpenWhispr does this);
// press and release still come from the hook, which Windows runs before hotkeys.
// Only while the hook runs (a dead one must not leave the key dead in every app),
// and never during capture, which must see the keys itself.
const MODIFIER_ONLY = /^(Alt|Ctrl|Meta|Shift)(Right)?$/u
let shortcut: string | undefined
let capturing = false
let hookRunning = false
let eaten: string | null = null

const eat = () => {
	const want =
		hookRunning && !capturing && shortcut && !MODIFIER_ONLY.test(shortcut)
			? shortcut
			: null
	if (want === eaten) return
	if (eaten) globalShortcut.unregister(eaten)
	eaten = null
	try {
		if (want && globalShortcut.register(want, () => undefined)) eaten = want
	} catch {
		/* not an accelerator Electron knows: the key also reaches the focused app */
	}
}

const post = (msg: Msg) => {
	if (msg.type !== 'rebind') state[msg.type] = msg
	child?.postMessage(msg)
}

const spawn = () => {
	const proc = utilityProcess.fork(
		path.join(app.getAppPath(), 'dist-electron/shortcuts/uiohook.js'),
	)
	child = proc
	proc.on('message', (e: { type: Edge | 'ready' }) => {
		if (e.type !== 'ready') return callbacks[e.type]?.()
		hookRunning = true
		eat()
	})
	// V8 fatal error in the child: 'error' on a listener-less emitter would throw
	// in main; 'exit' follows regardless and does the recovery.
	proc.on('error', () => undefined)
	// Child died mid-hold: its release died with it, so release on its behalf.
	// Paced, not counted: a hook that dies at startup costs one fork a second;
	// the alternative is push-to-talk dead until relaunch.
	proc.on('exit', () => {
		if (child !== proc) return
		child = null
		hookRunning = false
		eat()
		callbacks.release?.()
		setTimeout(() => {
			if (!child && callbacks.press) spawn()
		}, 1000)
	})
	for (const msg of Object.values(state)) proc.postMessage(msg)
}

export const setShortcut = (next: string | undefined) => {
	shortcut = next
	post({ shortcut: next, type: 'shortcut' })
	eat()
}

export const setCaptureMode = (enabled: boolean) => {
	capturing = enabled
	post({ enabled, type: 'capture' })
	eat()
}

export const bind = ({ onAbort, onPress, onRelease }: ShortcutHandlers) => {
	callbacks = { abort: onAbort, press: onPress, release: onRelease }
	if (!child) spawn()
}

export const rebind = () => post({ type: 'rebind' })

export const unbind = () => {
	callbacks = {}
	hookRunning = false
	eat()
	child?.kill()
	child = null
}
