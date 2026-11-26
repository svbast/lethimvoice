// biome-ignore-all lint/style/noProcessEnv: the one module that reads runtime env
import os from 'node:os'
import path from 'node:path'

const { env } = process

/** XDG base dir + spec fallback; `||` since an empty variable means unset. */
const xdg = (name: string, fallback: string): string =>
	env[name] || path.join(os.homedir(), fallback)

export const config = {
	/** Portal Registry app id; needs `<appId>.desktop` for GNOME to accept it. */
	appId: process.defaultApp ? 'com.lethim.voice.dev' : 'com.lethim.voice',
	/** AppImage runs from a FUSE mount that vanishes on exit; this is on-disk file. */
	appImage: env.APPIMAGE,
	appName: 'LetHim Voice',
	/** Marks boot launch (main.ts stays tray-only). */
	autostartArg: '--autostart',
	/** Vite dev port; shared with vite.config.ts + start-electron.mts. */
	devPort: 5273,
	/**
	 * VOICE_DUMP_AUDIO=1 keeps a copy of what the engine was given; only way to
	 * re-run same audio through different Whisper prompts.
	 * Off by default: dictation audio is private.
	 */
	dumpAudio: env.VOICE_DUMP_AUDIO === '1',
	engines: {
		llamaTag: 'b9858',
		releases: 'https://github.com/ggml-org',
		whisperTag: 'v1.9.1',
	},
	/** Portable build: `process.execPath` is a per-launch temp extraction; real exe. */
	portableExe: env.PORTABLE_EXECUTABLE_FILE,
	systemRoot: env.SystemRoot || 'C:\\Windows',
	wayland:
		env.XDG_SESSION_TYPE === 'wayland' || env.WAYLAND_DISPLAY !== undefined,
	xdg: {
		configHome: xdg('XDG_CONFIG_HOME', '.config'),
		dataHome: xdg('XDG_DATA_HOME', '.local/share'),
	},
} as const
