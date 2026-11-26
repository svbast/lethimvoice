# Language catalogs

UI text for LetHim Voice. Default locale: **`en`**.

| File      | Locale | Language     |
| --------- | ------ | ------------ |
| `en.json` | `en`   | English      |
| `cs.json` | `cs`   | Czech        |
| `pl.json` | `pl`   | Polish       |
| `sk.json` | `sk`   | Slovak       |
| `uk.json` | `uk`   | Ukrainian    |

Files are plain JSON so they can be loaded both by the Electron main
process (`require('../locales/<loc>.json')`) and by the Vite-bundled
renderer (`import catalog from '../../locales/<loc>.json'`).

## How translation works

- The renderer i18n runtime lives in `src/i18n/index.ts`. It exposes
  `t(key, vars)`, `errorHint(msg)`, `setLocale(loc)`, `getLocale()` and the
  `useT()` React hook. Every catalog is typed as `typeof en`, so a missing key is
  a compile error.
- The Electron main-process side lives in `electron/i18n.ts` and
  re-reads the active locale from settings on every call (used by the
  tray menu).
- Keys use dotted paths (e.g. `nav.home`, `preferences.shortcut`).
- Interpolation uses `{var}` placeholders, e.g.
  `"spoke": "you've spoken {d}"`.
- Plural sets are objects keyed by CLDR category (`one`, `few`, `many`,
  `other`); `t` picks one with `Intl.PluralRules` from the `n` variable, e.g.
  `t('common.recordings', { n: 5 })`.
- `errors.*` doubles as the code table: a dictation failure `'code: detail'` is
  looked up there by `errorHint`, so adding a string is all a new code needs.
- Missing keys fall back to the English catalog, then to the raw key.

## Adding a new language

1. Copy `en.json` to `<locale>.json` and translate the strings.
2. Add the locale to `SUPPORTED_LOCALES` in `electron/utils/languages.ts`
   (shared by both processes). A new recognition language also needs its English
   name in `LANGUAGE_NAMES` there.
3. Import the catalog into `CATALOGS` in `src/i18n/index.ts`. The Preferences
   language switch is built from `SUPPORTED_LOCALES`, so it needs no edit.
