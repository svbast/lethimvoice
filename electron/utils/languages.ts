// Language lists both processes need. Pure data, zero imports: renderer bundles
// this file (Preferences and the locale tests import it); node/electron-only code
// here would land in the web build.

// Order = display order of UI-language chips in Preferences. Each code needs a
// locales/<code>.json catalog (imported statically by both i18n modules).
export const SUPPORTED_LOCALES: string[] = ['en', 'pl', 'sk', 'cs', 'uk']

// Speech-recognition languages offered in Preferences/Prompts; code sent to
// Whisper as `language`. Order = grid display order. Separate from
// SUPPORTED_LOCALES (UI languages); also validation list for stored settings
// (electron/store/settings.ts).
export const RECOGNITION_LANGUAGES: string[] = [
	'en',
	'fr',
	'es',
	'de',
	'sk',
	'cs',
	'pl',
	'uk',
	'ru',
]

// Recognition-language names (Preferences grid, tray menu): English, identical in
// every UI locale — one universal list rather than endonyms or per-locale
// translations. Deliberately not in locales/*.json: a translated name would defeat
// the "same in all languages" rule.
const english = new Intl.DisplayNames(['en'], { type: 'language' })
export const LANGUAGE_NAMES: Record<string, string> = Object.fromEntries(
	RECOGNITION_LANGUAGES.map((code) => [code, english.of(code) ?? code]),
)
