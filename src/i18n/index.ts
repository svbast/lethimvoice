import { useSyncExternalStore } from 'react'
import cs from '../../locales/cs.json'
import en from '../../locales/en.json'
import pl from '../../locales/pl.json'
import sk from '../../locales/sk.json'
import uk from '../../locales/uk.json'

// All UI-facing strings live in /locales/<locale>.json; the registry of which
// locales exist is shared with the main process (electron/utils/languages.ts).
// Typed as `typeof en`, not `unknown`: that one annotation makes every other
// catalog structurally checked against English at compile time, so a key missing
// from a translation is an editor error rather than a test failure. Slavic
// catalogs legitimately carry extra plural categories, which stay assignable.
const CATALOGS: Record<string, typeof en> = { cs, en, pl, sk, uk }

export const DEFAULT_LOCALE: string = 'en'

// Every key in en.json, dotted. A leaf whose own keys are all CLDR plural
// categories is a plural form set, so it ends the path: 'common.recordings' is a
// key, 'common.recordings.one' is not. Typos and stale keys become type errors.
type Keys<T> = {
	[K in keyof T & string]: T[K] extends string
		? K
		: keyof T[K] extends Intl.LDMLPluralRule
			? K
			: `${K}.${Keys<T[K]>}`
}[keyof T & string]
export type Key = Keys<typeof en>
export type TFn = typeof t

let current: string = DEFAULT_LOCALE
// Rebuilt only on locale change: `t` would otherwise allocate one per call.
let rules: Intl.PluralRules = new Intl.PluralRules(DEFAULT_LOCALE)
const listeners = new Set<() => void>()

const subscribe = (cb: () => void): (() => void) => {
	listeners.add(cb)
	return () => listeners.delete(cb)
}
const getSnapshot = (): string => current

export function getLocale(): string {
	return current
}

export function setLocale(loc: string): void {
	const next = CATALOGS[loc] ? loc : DEFAULT_LOCALE
	if (next === current) return
	current = next
	rules = new Intl.PluralRules(next)
	for (const listener of listeners) {
		listener()
	}
}

function lookup(obj: unknown, key: string): unknown {
	return key
		.split('.')
		.reduce<unknown>(
			(o, k) =>
				o === null || o === undefined
					? undefined
					: (o as Record<string, unknown>)[k],
			obj,
		)
}

function format(value: string, vars?: Record<string, string | number>): string {
	if (!vars) return value
	return value.replace(/\{(\w+)\}/gu, (_, k) => String(vars[k] ?? `{${k}}`))
}

// t('common.save')                      → "Save"
// t('common.recordings', { n: 2 })      → "2 nagrania"  (pl few)
// t('stats.hero', { d: '3 min' })        → "3 min saved today"
// Falls back to the English catalog and finally to the raw key so callers
// always get *something* renderable.
export function t(key: Key, vars?: Record<string, string | number>): string {
	const value = lookup(CATALOGS[current], key) ?? lookup(en, key)
	if (value === null || value === undefined) return key
	// Plural form set: pick the category CLDR wants for `n` in THIS locale —
	// Slavic catalogs carry one/few/many/other, English only one/other. A missing
	// or non-finite `n` resolves to 'other', which every locale defines.
	if (typeof value === 'object') {
		const forms = value as Record<string, string | undefined>
		const form = forms[rules.select(Number(vars?.n))] ?? forms.other
		return form === undefined ? key : format(form, vars)
	}
	return format(value as string, vars)
}

// 'code: debug detail' → localized hint, the convention main uses for every
// dictation failure. The set of codes IS errors.* in the catalog, so adding a
// string is all a new code takes; unknown codes get the generic label.
// hasOwn, not `in`: a message like 'constructor: …' would otherwise resolve to
// Object.prototype and hand `t` a function to interpolate. A failure thrown in main
// reaches the renderer as "Error invoking remote method 'x': Error: code: …";
// Electron's wrapper is dropped first, otherwise every such failure would show "Error".
const IPC_WRAPPER = /^Error invoking remote method '[^']*': (?:\w*Error: )?/u

export function errorHint(msg: unknown): string {
	const [head = ''] = String(msg || '')
		.replace(IPC_WRAPPER, '')
		.split(':')
	const code = head.trim().toLowerCase()
	return t(
		Object.hasOwn(en.errors, code)
			? (`errors.${code}` as Key)
			: 'errors.unknown',
	)
}

// "Today 14:32" / "Yesterday 09:05" / "3 Jul 14:32" — localized, compact.
// lower: the day word mid-sentence, as in "Last: today 14:32".
export function fmtWhen(ts: number, lower = false): string {
	const locale = current
	const d = new Date(ts)
	const time = d.toLocaleTimeString(locale, {
		hour: '2-digit',
		minute: '2-digit',
	})
	const day = (word: string): string =>
		`${lower ? word.toLocaleLowerCase(locale) : word} ${time}`
	const now = new Date()
	const startOfDay = (x: Date): number =>
		new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
	const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000)
	if (dayDiff === 0) return day(t('common.today'))
	if (dayDiff === 1) return day(t('history.yesterday'))
	return `${d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} ${time}`
}

// React hook: re-renders subscribers whenever setLocale() is called.
// Returns the bound `t` so component code stays terse: const t = useT();
export function useT(): TFn {
	useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
	return t
}
