import { app } from 'electron'

import type * as LinuxDesktopEntry from './desktop-entry.linux'
import { config } from './utils/config'

const OPTIONS = config.portableExe
	? { args: [config.autostartArg], path: config.portableExe }
	: { args: [config.autostartArg] }

const linux: typeof LinuxDesktopEntry | null =
	process.platform === 'linux' ? require('./desktop-entry.linux') : null

export const setAutostart = (enable: boolean): void => {
	if (linux) linux.setAutostart(enable)
	else app.setLoginItemSettings({ openAtLogin: enable, ...OPTIONS })
}

/** Launch-at-login enabled? Windows matches path+args, so read back with same options. */
export const getAutostart = (): boolean =>
	linux
		? linux.isAutostartEnabled()
		: app.getLoginItemSettings(OPTIONS).openAtLogin
