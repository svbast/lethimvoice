import { Notification } from 'electron'
import cs from '../locales/cs.json'
import en from '../locales/en.json'
import pl from '../locales/pl.json'
import sk from '../locales/sk.json'
import uk from '../locales/uk.json'
import { loadSettings } from './store/settings'

type Keys<T> = {
	[K in keyof T & string]: T[K] extends string ? K : `${K}.${Keys<T[K]>}`
}[keyof T & string]
export type Key = Keys<typeof en>

const catalogs: Record<string, typeof en> = { cs, en, pl, sk, uk }

const lookup = (catalog: typeof en, key: Key) =>
	key
		.split('.')
		.reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], catalog) as
		| string
		| undefined

export const t = (key: Key, vars?: Record<string, string | number>) => {
	const catalog = catalogs[loadSettings().uiLanguage] ?? en
	const value = lookup(catalog, key) ?? (lookup(en, key) as string)
	return vars
		? value.replace(/\{(\w+)\}/gu, (_, k: string) =>
				String(vars[k] ?? `{${k}}`),
			)
		: value
}

/** `notify.<kind>Title` and `notify.<kind>Body` as a system notification. */
export const notify = (
	kind:
		| 'llmFail'
		| 'llmLimit'
		| 'modelRetired'
		| 'pasteManual'
		| 'shortcutDead',
	vars?: Record<string, string | number>,
) => {
	try {
		if (Notification.isSupported())
			new Notification({
				body: t(`notify.${kind}Body`, vars),
				title: t(`notify.${kind}Title`, vars),
			}).show()
	} catch {
		/* a notice must never cost the dictation */
	}
}
