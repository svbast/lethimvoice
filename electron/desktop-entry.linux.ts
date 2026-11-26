// XDG desktop entries for Linux: one lets portal Registry resolve app id, one
// for launch-at-login (Electron login-item API is a no-op here).
import fs from 'node:fs'
import path from 'node:path'

import { config } from './utils/config'

const APPLICATIONS_DIR = path.join(config.xdg.dataHome, 'applications')
const AUTOSTART_DIR = path.join(config.xdg.configHome, 'autostart')
const DISABLED = /^(?:Hidden=true|X-GNOME-Autostart-enabled=false)\s*$/mu

/**
 * Renders a desktop entry. Exec quoting per spec: `\ " $ \`` escaped inside the
 * quotes, `%` doubled (field codes). Name/Icon = what GNOME shows in Startup
 * Applications and Keyboard settings.
 */
const entry = (args: string[], extra: string[]): string => {
	const exe = (config.appImage ?? process.execPath)
		.replace(/[\\"$`]/gu, '\\$&')
		.replace(/%/gu, '%%')
	return [
		'[Desktop Entry]',
		'Type=Application',
		`Name=${config.appName}`,
		`Exec=${[`"${exe}"`, ...args].join(' ')}`,
		'Icon=lethim-voice',
		...extra,
		'',
	].join('\n')
}
const read = (file: string): string | null => {
	try {
		return fs.readFileSync(file, 'utf8')
	} catch {
		return null
	}
}
const write = (file: string, content: string): void => {
	if (read(file) === content) return
	fs.mkdirSync(path.dirname(file), { recursive: true })
	fs.writeFileSync(file, content)
}

/**
 * Writes `<appId>.desktop` to applications dir, refreshed every start: AppImage
 * can move between launches. Unchanged content not rewritten (gnome-shell
 * rescans dir on every write). `NoDisplay`: deb/rpm already ship a launcher;
 * this entry only resolves the app id for portals.
 */
export const ensureDesktopEntry = (): void => {
	write(
		path.join(APPLICATIONS_DIR, `${config.appId}.desktop`),
		entry([], ['NoDisplay=true']),
	)
	if (isAutostartEnabled()) setAutostart(true)
}

export const setAutostart = (enable: boolean): void => {
	const file = path.join(AUTOSTART_DIR, `${config.appId}.desktop`)
	if (!enable) {
		fs.rmSync(file, { force: true })
		return
	}
	write(file, entry([config.autostartArg], []))
}

/**
 * Autostart spec: `Hidden=true` means entry does not exist; GNOME also honours
 * `X-GNOME-Autostart-enabled=false`. Desktop settings toggle these instead of
 * deleting the file.
 */
export const isAutostartEnabled = (): boolean => {
	const content = read(path.join(AUTOSTART_DIR, `${config.appId}.desktop`))
	return content !== null && !DISABLED.test(content)
}
