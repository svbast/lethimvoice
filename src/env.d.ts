/// <reference types="vite/client" />

// No top-level import: a module d.ts's `declare global` applies only where the
// file is explicitly included, which left editors resolving `window.electron`
// to Electron's own namespace.
interface Window {
	electron: import('../electron/preload').Api
}

// vite `define`, see vite.config.ts
declare const __APP_VERSION__: string
