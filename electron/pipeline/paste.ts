import { ClipboardItem, clipboard } from 'electron'

import type * as PasteLinux from './paste.linux'
import type * as PasteMac from './paste.mac'
import type * as PasteWin from './paste.win'

interface PasteApi {
	captureForegroundWindow: () => void
	/** Where the last press was made, as an opaque token for the calls below. */
	pasteTarget?: () => unknown
	/** false = no keystroke could be sent: the text stays on the clipboard. */
	simulatePaste: (target?: unknown) => Promise<boolean>
	/** Types the text instead of pasting it; false = paste it. */
	typeText?: (text: string, target?: unknown) => Promise<boolean>
}

// Conditional require, not import: load only the running platform's module
// (paste.win pulls user32/kernel32 via koffi). Each require cast to its module's
// own type (import type loads nothing), so the assignment type-checks every
// platform's paste file. Electron runs on these three platforms only.
const impl: PasteApi =
	process.platform === 'win32'
		? (require('./paste.win') as typeof PasteWin)
		: process.platform === 'darwin'
			? (require('./paste.mac') as typeof PasteMac)
			: (require('./paste.linux') as typeof PasteLinux)

export const { captureForegroundWindow } = impl

// clipboard.read()/write() keep every platform MIME type, incl. file lists
// (text/uri-list == CF_HDROP on Windows).
// Materialize payloads: clipboard.read() items' getType() reads lazily from LIVE
// clipboard, which holds our transcript by restore time. Awaiting all = snapshot.
type ClipboardSnapshot = Record<string, Blob | Electron.ClipboardBookmark>[]

const snapshotClipboard = async (): Promise<ClipboardSnapshot> => {
	const items = await clipboard.read()
	return Promise.all(
		items.map(async (item) =>
			Object.fromEntries(
				await Promise.all(
					item.types.map(async (t) => [t, await item.getType(t)] as const),
				),
			),
		),
	)
}

// Empty snapshot: clear; never leave transcript on clipboard. read() adds
// OS-synthesized formats (Win CF_LOCALE/CF_OEMTEXT, X11 STRING/UTF8_STRING):
// try first to preserve app-specific formats, but one rejection fails the atomic
// write, so retry canonical types, OS regenerates. ClipboardBookmark: macOS-only,
// returns to same OS.
const OS_PASSTHROUGH = 'electron application/osclipboard'

// Three tiers, each degrading to the next: faithful write -> canonical only ->
// clear. Terminal state never "transcript still sitting on user's clipboard".
const restoreClipboard = async (snap: ClipboardSnapshot) => {
	const entries = snap.filter((entry) => Object.keys(entry).length)
	if (entries.length === 0) return clipboard.clear()
	try {
		return await clipboard.write(
			entries.map((entry) => new ClipboardItem(entry)),
		)
	} catch {
		/* synthesized format rejected — retry canonical only */
	}
	const canonical = entries
		.map((entry) =>
			Object.fromEntries(
				Object.entries(entry).filter(([t]) => !t.startsWith(OS_PASSTHROUGH)),
			),
		)
		.filter((entry) => Object.keys(entry).length)
	try {
		if (canonical.length === 0) return await clipboard.clear()
		return await clipboard.write(
			canonical.map((entry) => new ClipboardItem(entry)),
		)
	} catch {
		await clipboard.clear()
	}
}

// Wait after Ctrl+V before restoring the user's clipboard. A busy browser tab reads
// the paste late; restore before that and it pastes the previous clipboard, or
// nothing when an empty one was cleared (150 ms is too short). Others wait
// 450–2000 ms (OpenWhispr, VoiceInk).
export const RESTORE_DELAY_MS = 1000

// Windows hands text back with CRLF line ends.
const same = (a: string, b: string) =>
	a.replace(/\r\n/gu, '\n') === b.replace(/\r\n/gu, '\n')

const restoreLater = async (
	text: string,
	snapshot: ClipboardSnapshot,
	primary: string | undefined,
) => {
	await new Promise((r) => setTimeout(r, RESTORE_DELAY_MS))
	// Linux PRIMARY (the last highlighted text) gets its text back the same way.
	const selection = clipboard.selection
	if (
		selection &&
		primary !== undefined &&
		same(await selection.readText(), text)
	)
		await (primary ? selection.writeText(primary) : selection.clear())
	// Something else was copied meanwhile (the user, a clipboard manager): theirs
	// now, not ours to overwrite.
	if (!same(await clipboard.readText(), text)) return
	// restoreClipboard already degrades to clipboard.clear(); rejection means even
	// that failed — nothing left to try.
	await restoreClipboard(snapshot)
}

// One paste at a time, the next only after the previous restore: otherwise the
// second snapshot catches the first transcript and "restores" it as the user's
// clipboard (VoiceInk, OpenWhispr queue the same way).
let queue: Promise<void> = Promise.resolve()

// `keep` (settings.keepInClipboard, default off) leaves the transcript on the
// clipboard for a later Ctrl+V. Resolves once the paste keystroke is sent; the
// restore finishes in the background. false = nothing could paste it: the
// transcript is left on the clipboard for the user's own Ctrl+V.
export const pasteText = async (
	text: string,
	keep: boolean,
): Promise<boolean> => {
	// Now, not after the wait in the queue: a press meanwhile re-captures the target.
	const target = impl.pasteTarget?.()
	const turn = queue
	let done!: () => void
	queue = new Promise((r) => {
		done = r
	})
	try {
		await turn
		// Typed instead (Chromium on macOS, paste.mac.ts): the clipboard is not used.
		if (await impl.typeText?.(text, target)) {
			if (keep) await clipboard.writeText(text)
			done()
			return true
		}
		const snapshot = keep ? null : await snapshotClipboard()
		const primary = keep ? undefined : await clipboard.selection?.readText()
		// Awaited: writeText resolves once transcript is committed to OS clipboard.
		// Ctrl+V before that pastes previous contents.
		await clipboard.writeText(text)
		// Linux only: terminals that paste PRIMARY on Shift+Insert (paste.linux.ts).
		await clipboard.selection?.writeText(text)
		const pasted = await impl.simulatePaste(target)
		if (!(pasted && snapshot)) {
			done()
			return pasted
		}
		restoreLater(text, snapshot, primary)
			.catch(() => undefined)
			.finally(done)
		return true
	} catch (e) {
		done()
		throw e
	}
}
