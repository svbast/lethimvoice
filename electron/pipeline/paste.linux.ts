// Linux paste outcomes by desktop:
//
//   Session         Primary path                 Fallbacks
//   X11             xdotool                      notification
//   GNOME Wayland   RemoteDesktop portal         wtype (exits 1: no protocol), notification
//   KDE Wayland     RemoteDesktop portal         wtype (exits 1: no protocol), notification
//   wlroots         no RemoteDesktop backend     wtype, notification
//
// Shift+Insert, not Ctrl+V: GTK, Qt, Chromium and Electron apps paste the clipboard
// on it and terminals paste on it too (Ctrl+V is a control character there); the
// ones reading PRIMARY get it from paste.ts. Handy's Linux default.
//
// No XSendEvent fallback: GTK and Qt drop send_event key events by design
// (QTBUG-48795), so it would only ever "succeed" silently. No ydotool either: it
// exits 0 even when it injects nothing, and a false success swallows the
// manual-paste notification.
// paste.ts's pasteText() populates the clipboard before simulatePaste() runs.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { notify } from '../i18n'
import { loadSettings, saveSettings } from '../store/settings'
import { config } from '../utils/config'
import { portal, type Variant } from '../xdg-portal.linux'

const execFileAsync = promisify(execFile)
const WTYPE_ARGS = ['-M', 'shift', '-k', 'Insert', '-m', 'shift']
const XDOTOOL_ARGS = ['key', '--clearmodifiers', 'shift+Insert']

// evdev: LEFTSHIFT=42, INSERT=110; 1=down, 0=up
const SHIFT_INSERT: [number, number][] = [
	[42, 1],
	[110, 1],
	[110, 0],
	[42, 0],
]

// null = user declined consent dialog; stays null for process lifetime.
let remoteDesktop: Promise<string | null> | null = null
let notified = false

const createRemoteDesktopSession = async (): Promise<string | null> => {
	const client = await portal()
	const [createCode, createResults] = await client.request(
		'RemoteDesktop',
		'CreateSession',
		'a{sv}',
		(token) => [
			Object.entries<Variant>({
				handle_token: ['s', token],
				session_handle_token: ['s', token],
			}),
		],
	)
	const handle = createResults.session_handle
	if (createCode !== 0 || typeof handle !== 'string' || !handle) {
		throw new Error(`RemoteDesktop CreateSession failed (${createCode})`)
	}

	const restoreToken = loadSettings().linuxRemoteDesktopToken
	const [selectCode] = await client.request(
		'RemoteDesktop',
		'SelectDevices',
		'oa{sv}',
		(token) => {
			const options: Record<string, Variant> = {
				handle_token: ['s', token],
				persist_mode: ['u', 2],
				types: ['u', 1],
			}
			if (restoreToken) options.restore_token = ['s', restoreToken]
			return [handle, Object.entries<Variant>(options)]
		},
	)
	if (selectCode !== 0) {
		throw new Error(`RemoteDesktop SelectDevices failed (${selectCode})`)
	}

	const [startCode, startResults] = await client.request(
		'RemoteDesktop',
		'Start',
		'osa{sv}',
		(token) => [
			handle,
			'',
			Object.entries<Variant>({ handle_token: ['s', token] }),
		],
	)
	if (startCode !== 0) return null

	const nextRestoreToken = startResults.restore_token
	if (typeof nextRestoreToken === 'string' && nextRestoreToken) {
		saveSettings({
			...loadSettings(),
			linuxRemoteDesktopToken: nextRestoreToken,
		})
	}
	return handle
}

const pasteViaRemoteDesktop = async (): Promise<boolean> => {
	try {
		remoteDesktop ??= createRemoteDesktopSession()
		const handle = await remoteDesktop
		if (!handle) return false
		const client = await portal()
		const key = (code: number, state: number) =>
			client.call('RemoteDesktop', 'NotifyKeyboardKeycode', 'oa{sv}iu', [
				handle,
				[],
				code,
				state,
			])
		try {
			for (const [code, state] of SHIFT_INSERT) await key(code, state)
		} catch (e) {
			// Best effort: failure between Shift down and up would latch the modifier.
			await Promise.allSettled([key(110, 0), key(42, 0)])
			throw e
		}
		return true
	} catch {
		remoteDesktop = null
		return false
	}
}

const runTool = async (file: string, args: string[]): Promise<boolean> => {
	try {
		await execFileAsync(file, args)
		return true
	} catch {
		return false
	}
}

export const captureForegroundWindow = (): void => {
	/* no foreground-window API on Linux; paste goes to the focused surface */
}

export const simulatePaste = async (): Promise<boolean> => {
	if (config.wayland) {
		if (await pasteViaRemoteDesktop()) return true
		if (await runTool('wtype', WTYPE_ARGS)) return true
	} else if (await runTool('xdotool', XDOTOOL_ARGS)) return true

	if (!notified) {
		notified = true
		notify('pasteManual', { tools: config.wayland ? 'wtype' : 'xdotool' })
	}
	return false
}
