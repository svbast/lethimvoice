// Backend selection here: local mode must never send audio to cloud.

import { broadcast } from '../ipc/broadcast'
import * as history from '../store/history'
import { loadSettings } from '../store/settings'
import * as stats from '../store/stats'
import * as cloud from './cloud'
import * as local from './local'

type Provider = typeof cloud | typeof local

export const run = async (
	buffer: Buffer,
	mimeType?: string,
	durationMs?: number,
) => {
	const settings = loadSettings()

	const stt: Provider = settings.backend === 'local' ? local : cloud
	const llm: Provider | null =
		settings.backend === 'local'
			? settings.localLlm?.enabled
				? local
				: null
			: cloud

	const rawText = await stt.transcribe(buffer, mimeType)

	// Failed attempts not counted — limit bars slightly undercount on errors.
	stats.recordRecording({
		cloudStt: stt === cloud,
		durationMs,
	})

	const processed = llm ? await llm.postProcess(rawText, settings) : rawText

	if (settings.historyEnabled !== false && processed && processed.trim()) {
		const item = history.add({
			backend: settings.backend,
			durationMs,
			lang: settings.language,
			text: processed,
		})
		if (item) broadcast('history-added', item)
	}
	return processed
}
