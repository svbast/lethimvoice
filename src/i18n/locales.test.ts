import { expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
	LANGUAGE_NAMES,
	RECOGNITION_LANGUAGES,
	SUPPORTED_LOCALES,
} from '../../electron/utils/languages'
import { errorHint, setLocale, t } from '.'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const CATEGORIES: Record<string, true> = {
	few: true,
	many: true,
	one: true,
	other: true,
	two: true,
	zero: true,
}

type Leaf = string | Record<string, string>

function leaves(node: unknown, prefix = ''): Record<string, Leaf> {
	const out: Record<string, Leaf> = {}
	for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
		const key = prefix ? `${prefix}.${k}` : k
		if (typeof v === 'string') out[key] = v
		else if (Object.keys(v as object).every((c) => CATEGORIES[c]))
			out[key] = v as Record<string, string>
		else Object.assign(out, leaves(v, key))
	}
	return out
}

const files = readdirSync(`${ROOT}locales`).filter((f) => f.endsWith('.json'))
const catalogs = new Map(
	files.map((f) => [
		f.replace('.json', ''),
		leaves(JSON.parse(readFileSync(`${ROOT}locales/${f}`, 'utf8'))),
	]),
)
const en = catalogs.get('en')
if (!en) throw new Error('locales/en.json is missing')
const PLACEHOLDER = /\{(\w+)\}/gu
const MAIN_KEY = /\bt\(\s*'([a-z][\w.]+)'/gu

const THROWN_CODE = /new Error\([`']([a-z]+): /gu
const CODE_ASSIGN = /\bcode = '([a-z]+)'/gu
const MODE_TITLE = /^modes\.([a-z]+)\.title$/u

const placeholders = (form: string): string[] =>
	[...form.matchAll(PLACEHOLDER)].map((m) => m[1] as string).sort()
const formsOf = (v: Leaf): string[] =>
	typeof v === 'string' ? [v] : Object.values(v)

it('registers exactly the catalogs that exist on disk', () => {
	expect([...catalogs.keys()].sort()).toEqual([...SUPPORTED_LOCALES].sort())
})

it('the renderer registers a catalog for every supported locale', () => {
	const englishOnly = SUPPORTED_LOCALES.filter((loc) => {
		setLocale(loc)
		return loc !== 'en' && t('common.save') === (en['common.save'] as string)
	})
	setLocale('en')
	expect(englishOnly).toEqual([])
})

const PROSE_KEYS = ['guide.use4', 'modes.section.desc']

const MODE_IDS = Object.keys(en)
	.map((k) => MODE_TITLE.exec(k)?.[1])
	.filter((id): id is string => Boolean(id))
for (const key of PROSE_KEYS) {
	const named = MODE_IDS.filter((id) =>
		(en[key] as string).includes(en[`modes.${id}.title`] as string),
	)
	it(`${key}: names every mode the way its own catalog titles it`, () => {
		expect(named.length).toBeGreaterThan(2)
		for (const [loc, catalog] of catalogs) {
			const prose = catalog[key] as string
			const missing = named.filter(
				(id) => !prose.includes(catalog[`modes.${id}.title`] as string),
			)
			expect({ loc, missing }).toEqual({ loc, missing: [] })
		}
	})
}

for (const [loc, catalog] of catalogs) {
	it(`${loc}: has exactly the keys en.json has`, () => {
		expect(Object.keys(catalog).sort()).toEqual(Object.keys(en).sort())
	})

	it(`${loc}: spells every plural form its grammar needs`, () => {
		const wanted = [
			...new Intl.PluralRules(loc).resolvedOptions().pluralCategories,
		].sort()
		for (const [key, value] of Object.entries(catalog)) {
			if (typeof en[key] === 'string') expect(typeof value).toBe('string')
			else expect(Object.keys(value).sort()).toEqual(wanted)
		}
	})

	it(`${loc}: keeps every {placeholder} from the English string`, () => {
		for (const [key, value] of Object.entries(catalog)) {
			const want = placeholders(formsOf(en[key] as Leaf)[0] as string)
			for (const form of formsOf(value)) {
				expect(placeholders(form)).toEqual(want)
			}
		}
	})
}

it('main-process strings all exist (electron/ gets no key types)', () => {
	const dir = `${ROOT}electron`
	const sources = readdirSync(dir, { encoding: 'utf8', recursive: true })
		.filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
		.map((f) => readFileSync(`${dir}/${f}`, 'utf8'))
	const used = sources.flatMap((s) =>
		[...s.matchAll(MAIN_KEY)].map((m) => m[1] as string),
	)
	expect(used.length).toBeGreaterThan(0)
	expect(used.filter((k) => !(k in en))).toEqual([])
})

it('every error code thrown has a label', () => {
	const sources = [
		...readdirSync(`${ROOT}electron`, {
			encoding: 'utf8',
			recursive: true,
		}).map((f) => `electron/${f}`),
		...readdirSync(`${ROOT}src`, { encoding: 'utf8', recursive: true }).map(
			(f) => `src/${f}`,
		),
	].filter((f) => /\.tsx?$/u.test(f) && !f.endsWith('.test.ts'))
	const codes = new Set<string>()
	for (const f of sources) {
		const s = readFileSync(`${ROOT}${f}`, 'utf8')
		for (const m of s.matchAll(THROWN_CODE)) codes.add(m[1] as string)
		for (const m of s.matchAll(CODE_ASSIGN)) codes.add(m[1] as string)
	}
	expect(codes.size).toBeGreaterThan(5)
	expect([...codes].filter((c) => !(`errors.${c}` in en)).sort()).toEqual([])
})

it('every recognition language has a display name', () => {
	expect(RECOGNITION_LANGUAGES.filter((l) => !LANGUAGE_NAMES[l])).toEqual([])
})

it('picks the plural form the count needs', () => {
	setLocale('pl')
	expect([1, 2, 5, 22].map((n) => t('common.recordings', { n }))).toEqual([
		'1 nagranie',
		'2 nagrania',
		'5 nagrań',
		'22 nagrania',
	])
	setLocale('cs')
	expect([1, 3, 5].map((n) => t('common.recordings', { n }))).toEqual([
		'1 nahrávka',
		'3 nahrávky',
		'5 nahrávek',
	])
	setLocale('en')
	expect([1, 2].map((n) => t('common.recordings', { n }))).toEqual([
		'1 recording',
		'2 recordings',
	])
})

it('labels known error codes and falls back on everything else', () => {
	setLocale('en')
	expect(errorHint('quota: 429 from groq')).toBe('Groq limit reached')
	// How a failure thrown in the main process arrives through ipcRenderer.invoke.
	expect(
		errorHint(
			"Error invoking remote method 'transcribe': Error: quota: 429 from groq",
		),
	).toBe('Groq limit reached')
	expect(errorHint('constructor: boom')).toBe('Error')
	expect(errorHint('toString')).toBe('Error')
	expect(errorHint(undefined)).toBe('Error')
})
