// Single source of truth for the app version shown in the UI. The number is
// injected from package.json at build time (see vite.config.ts `define`), so it
// never drifts from the packaged build; the channel label is a product decision
// kept here. Bump the version in package.json, not here.
export const APP_VERSION =
	typeof __APP_VERSION__ === 'undefined' ? '0.0.0' : __APP_VERSION__
export const APP_CHANNEL = 'Beta'
