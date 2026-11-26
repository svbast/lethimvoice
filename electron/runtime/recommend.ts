import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { osKey } from './engines'

export interface Machine {
	platform: 'win' | 'mac' | 'linux'
	/** Largest NVIDIA card's VRAM; null without one (whisper then runs on CPU). */
	nvidiaVramGb: number | null
	ramGb: number
}

export interface Recommendation {
	grade: 'good' | 'slow' | 'unsupported'
	stt: string | null
	/** null: no text cleanup on this machine, `llmReason` says why. */
	llm: string | null
	llmReason?: 'memory' | 'cpu'
}

// Picks the local models for a machine and dictation language (OpenWhispr's hardware
// table, Superwhisper's grade, Handy's language-aware pick). Numbers: measured on
// FLEURS speech and a Slovak cleanup set, on an RTX 3070-class GPU.
export const recommend = (m: Machine, language: string): Recommendation => {
	// whisper.cpp ships no macOS server build: no local speech-to-text there.
	if (m.platform === 'mac')
		return { grade: 'unsupported', llm: null, stt: null }
	const vram = m.nvidiaVramGb ?? 0
	if (vram >= 2) {
		// turbo-q5 matches large-v3 in sk/pl/en (WER 16.6 / 14.9 / 4.3 %) at a fifth of
		// its size and 2.5× its speed; large-v3 wins only in cs and uk (−2…3 points)
		// and needs 3.6 GB of VRAM next to the cleanup model.
		const stt =
			vram >= 8 && ['cs', 'uk'].includes(language)
				? 'large-v3'
				: 'large-v3-turbo-q5_0'
		// Gemma 4 E2B: 0.2 s per cleanup on the GPU; it kept every fact in Slovak cleanup.
		const llm = vram >= 6 && m.ramGb >= 8 ? 'gemma-4-e2b' : null
		return { grade: 'good', llm, llmReason: llm ? undefined : 'memory', stt }
	}
	// CPU: turbo-q5 transcribes at ~0.5× real time — a 10 s dictation waits ~5 s.
	// English gets base: 10× faster, WER 10.8 % against turbo-q5's 8.5 %; in Slavic
	// languages base misses half the words (WER 47–78 %). Cleanup on CPU takes ~3 s.
	const english = language === 'en'
	return {
		grade: english ? 'good' : 'slow',
		llm: null,
		llmReason: m.ramGb >= 8 ? 'cpu' : 'memory',
		stt: english ? 'base' : 'large-v3-turbo-q5_0',
	}
}

/**
 * The model to suggest when `current` is poor for `language`, else null. Base is
 * picked only for English (CPU). In other languages it misses half the words (WER
 * 47–78 % on FLEURS), and a later switch of the dictation language says nothing.
 */
export const betterSpeechModel = (
	current: string | undefined,
	language: string,
	rec: Recommendation,
): string | null =>
	current === 'base' && language !== 'en' && rec.stt && rec.stt !== current
		? rec.stt
		: null

const nvidiaVramGb = (): Promise<number | null> =>
	new Promise((resolve) => {
		execFile(
			'nvidia-smi',
			['--query-gpu=memory.total', '--format=csv,noheader,nounits'],
			{ timeout: 5000, windowsHide: true },
			(err, stdout) => {
				const mib = err
					? []
					: String(stdout)
							.split(/\r?\n/u)
							.map(Number)
							.filter((n) => n > 0)
				resolve(mib.length > 0 ? Math.max(...mib) / 1024 : null)
			},
		)
	})

let vram: Promise<number | null> | null = null
export const describeMachine = async (gpus: string[]): Promise<Machine> => {
	vram ??= gpus.some((name) => /nvidia/iu.test(name))
		? nvidiaVramGb()
		: Promise.resolve(null)
	return {
		nvidiaVramGb: await vram,
		platform: osKey(),
		ramGb: os.totalmem() / 1024 ** 3,
	}
}

export const freeDiskGb = (dir: string): number => {
	try {
		const { bavail, bsize } = fs.statfsSync(dir)
		return (bavail * bsize) / 1e9
	} catch {
		return 0
	}
}
