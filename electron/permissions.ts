import type * as Mac from './permissions.mac'

// macOS permission checks; null elsewhere. main.ts gates the shortcut on it too.
export const mac: typeof Mac | null =
	process.platform === 'darwin' ? require('./permissions.mac') : null
