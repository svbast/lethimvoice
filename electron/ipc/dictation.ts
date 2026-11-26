import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import * as pipeline from '../pipeline'
import { pasteText } from '../pipeline/paste'
import { loadSettings } from '../store/settings'
import { config } from '../utils/config'
import { hideRecording } from '../windows'
import type { Handler } from '.'

// Failures swallowed: debug aid must never break dictation.
const dumpAudio = (buf: Buffer, mimeType: string) => {
	try {
		const dir = path.join(app.getPath('userData'), 'debug-audio')
		fs.mkdirSync(dir, { recursive: true })
		const ext = (mimeType || '').includes('wav') ? 'wav' : 'webm'
		const file = path.join(
			dir,
			`${new Date().toISOString().replace(/[:.]/gu, '-')}.${ext}`,
		)
		fs.writeFileSync(file, buf)
	} catch {
		/* best effort */
	}
}

export const handlers = {
	// Not pasted: the pill says the text is on the clipboard, then hides itself.
	'paste-text': async (_e, text: string) => {
		const pasted = await pasteText(
			text,
			loadSettings().keepInClipboard === true,
		)
		if (pasted) hideRecording()
		return pasted
	},
	transcribe: async (
		_e,
		audioBuffer: Buffer | ArrayBuffer,
		mimeType: string,
		durationMs: number,
	) => {
		// audioBuffer arrives as Node Buffer (Electron auto-converts renderer
		// ArrayBuffer). No base64 decode; zero-copy wrap.
		// durationMs = recorded length measured in renderer (usage statistics).
		const buf = Buffer.isBuffer(audioBuffer)
			? audioBuffer
			: Buffer.from(audioBuffer)
		if (config.dumpAudio) dumpAudio(buf, mimeType)
		return await pipeline.run(buf, mimeType, durationMs)
	},
} satisfies Record<string, Handler>
