import type * as KeystateMac from './keystate.mac'
import type * as KeystateWin from './keystate.win'

export interface Keys {
	alt: boolean
	ctrl: boolean
	keycode: number
	meta: boolean
	modifierOnly: boolean
	shift: boolean
}

interface Os {
	isHeld: (keys: Keys) => boolean | undefined
	maskMenu?: () => void
}

const os: Os | null = (() => {
	if (process.platform === 'win32') {
		const win: typeof KeystateWin = require('./keystate.win')
		return win
	}
	if (process.platform === 'darwin') {
		const mac: typeof KeystateMac = require('./keystate.mac')
		return mac
	}
	return null
})()

// The key as the OS sees it now, not as the hook's event stream last reported it:
// a keyup lost to sleep, the lock screen or a stalled hook leaves the stream saying
// "held" forever (VoiceInk, OpenWhispr and Handy all re-read it for this). Any of
// the shortcut's keys still down counts as held; undefined = this OS can't tell.
export const isHeld = (keys: Keys): boolean | undefined => os?.isHeld(keys)

// For a combo with Alt or Win, whose eaten key (shortcuts/index.ts) would otherwise
// leave a bare Alt/Win tap behind. Windows only.
export const maskMenu = (keys: Keys) => {
	if (!keys.modifierOnly && (keys.alt || keys.meta)) os?.maskMenu?.()
}
