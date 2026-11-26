import path from 'node:path'
import { app, safeStorage } from 'electron'

import { DEFAULT_MODEL } from '../runtime/models'
import { readJson, writeJson } from '../utils/jsonFile'
import { RECOGNITION_LANGUAGES } from '../utils/languages'

// OS-backed API key encryption (DPAPI on Windows, Keychain on macOS). Guarded:
// safeStorage is untouchable before app ready, and the tests' fake app has no
// isReady; both fall back to plaintext.
// To do before Electron 46: these sync safeStorage calls are deprecated in Electron 45 and removed in
// 46; move to isAsyncEncryptionAvailable/encryptStringAsync/decryptStringAsync (they
// read today's ciphertext) before that bump.
const canEncrypt = () => {
	try {
		return app.isReady() && safeStorage.isEncryptionAvailable()
	} catch {
		return false
	}
}

type RawSettings = Record<string, unknown>

// On disk: `apiKeyEnc` (base64 of safeStorage ciphertext). In memory and over IPC
// to the settings UI: always plaintext `apiKey`.
let _undecrypted = false

const decryptApiKey = (raw: RawSettings) => {
	if (typeof raw.apiKeyEnc === 'string' && raw.apiKeyEnc) {
		try {
			raw.apiKey = safeStorage.decryptString(
				Buffer.from(raw.apiKeyEnc, 'base64'),
			)
		} catch {
			raw.apiKey = ''
			_undecrypted = true
			return
		}
	}
	raw.apiKeyEnc = undefined
}

// User-defined LLM mode (Settings → Prompts). Always runs inside the safety wrapper
// (pipeline/prompts.ts).
interface UserMode {
	id: string
	title?: string
	promptText?: string
}

const DEFAULTS = {
	activeModeId: 'clean',
	apiKey: '',
	// Launch at login is opt-out: main.ts registers the login item on first
	// packaged run and flips this flag, once per install; a user who later turns the
	// toggle off is never re-enrolled on next launch.
	autostartConfigured: false,
	// Checks for a new version 30 s after start and every 6 h (updater.ts). Off,
	// About's "Check now" still checks.
	autoUpdate: true,
	backend: 'cloud',
	// Local engine compute: 'auto' (GPU if available, else CPU) | 'gpu' | 'cpu'.
	// Maps to -ngl offload flag; same Vulkan/Metal binary runs CPU or GPU.
	computeMode: 'auto',
	enabled: true,
	inputDevice: 'default',
	// Keep each dictation on clipboard after paste, re-pastable with Ctrl+V. OFF by
	// default: previous clipboard content restored, no transcript lingers. Failed
	// paste: text still in History.
	keepInClipboard: false,
	language: 'en',
	// Linux/Wayland only: RemoteDesktop portal restore token. Set after the one-time
	// "Allow Remote Interaction" consent; every later paste session starts silently
	// with it. Portal rotates it per use (paste.linux.ts rewrites it).
	linuxRemoteDesktopToken: '',
	// Minutes without a dictation before local models leave RAM/VRAM; 0 = never.
	localIdleMinutes: 5,
	// Local LLM post-processing (bundled llama.cpp). enabled: LLM step uses local
	// model regardless of STT backend; model is a catalog id (runtime/models.ts).
	localLlm: { enabled: false, model: DEFAULT_MODEL.llm },
	// turbo-q5: large-v3's accuracy in sk/pl/en at a fifth of the download, measured
	// on FLEURS speech.
	localStt: { model: DEFAULT_MODEL.stt },
	modes: [] as UserMode[],
	// The ONE user-facing prompt field (Settings → Prompts): user names, spellings,
	// style preferences. Used at BOTH stages — verbatim as Whisper initial_prompt
	// (pipeline/cloud.ts, pipeline/local.ts) and as LLM spelling authority
	// (pipeline/prompts.ts). Never an instruction to act on.
	personalPreferences: '',
	// Hold one right-hand modifier: it never types a character and never collides
	// with the left one in Cmd/Ctrl+C. Right ⌘ on macOS, Right Ctrl elsewhere: Alt
	// combos open the Office ribbon KeyTips, and Right Alt is AltGr on most
	// European layouts. See electron/shortcuts/.
	shortcut: process.platform === 'darwin' ? 'MetaRight' : 'CtrlRight',
	uiLanguage: 'en', // ALWAYS English out of the box, on purpose
}

// In-memory settings. `apiKeyEnc` exists only on disk (saveSettings writes it,
// loadSettings decrypts it away); `historyEnabled` has no default — History tab
// writes it, absent = ON.
export type Settings = typeof DEFAULTS & {
	apiKeyEnc?: string
	historyEnabled?: boolean
}

const getSettingsPath = () =>
	path.join(app.getPath('userData'), 'settings.json')

// settings.json is hand-editable and spread in raw. A non-array `modes` makes
// prompts.ts's .find() throw where no caller catches, losing the dictation
// instead of falling back to the raw transcript. Every dictation pins a concrete
// recognition language: an unknown one becomes the UI language when that is one,
// else English.
const normalize = (settings: Settings): Settings => {
	if (!RECOGNITION_LANGUAGES.includes(settings.language)) {
		settings.language = RECOGNITION_LANGUAGES.includes(settings.uiLanguage)
			? settings.uiLanguage
			: 'en'
	}
	if (!Array.isArray(settings.modes)) settings.modes = []
	return settings
}

let _cache: Settings | null = null

const read = (): Settings => {
	_undecrypted = false
	const raw = readJson(getSettingsPath())
	if (!raw || typeof raw !== 'object') return { ...DEFAULTS }
	const stored = raw as RawSettings
	// A key saved in the clear (no OS key store at the time).
	const clearKey = Boolean(stored.apiKey)
	decryptApiKey(stored)
	const settings = normalize({ ...DEFAULTS, ...(stored as Partial<Settings>) })
	// Encrypted as soon as a key store exists: re-saved now, the clear key leaves the
	// disk.
	if (clearKey && canEncrypt())
		try {
			saveSettings(settings)
		} catch {
			/* disk busy: the next save encrypts it */
		}
	return settings
}

// Read + decrypt once; later calls are field accesses. Dictation hot-path callers
// (pipeline, paste, i18n) hit this several times per keypress.
export const loadSettings = (): Settings => {
	if (_cache) return _cache
	const settings = read()
	if (!_undecrypted) _cache = settings
	return settings
}

export const saveSettings = (settings: Settings) => {
	// Disk differs from the in-memory object one way: API key written encrypted
	// (apiKeyEnc), never in the clear — unless the OS store is unavailable, where
	// plaintext beats silently losing the user's key.
	const out: Settings = { ...settings }
	if (out.apiKey) {
		out.apiKeyEnc = canEncrypt()
			? safeStorage.encryptString(out.apiKey).toString('base64')
			: undefined
		if (out.apiKeyEnc) out.apiKey = ''
	}
	_cache = _undecrypted ? null : settings
	// Indented: settings.json is meant to be hand-editable.
	writeJson(getSettingsPath(), out, 2)
}
