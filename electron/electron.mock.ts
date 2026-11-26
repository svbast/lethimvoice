// One fake `electron` for every bun test, loaded via bunfig.toml [test] preload.
//
// Shared, not per test file: Bun fixes a mocked module's export set on the FIRST
// mock.module() call in the process; a later file mocking `electron` with other
// names fails "Export named 'x' not found". Holds every name the modules that tests
// load import from 'electron' (main.ts, ipc/index.ts and preload.ts are never
// loaded); tests steer behaviour via mutable `fake`.
import { afterAll, mock } from 'bun:test'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Stands in for a UtilityProcess: records what main posted, lets a test play
// the child's side ('message', 'exit') through emit().
export class FakeChild extends EventEmitter {
	killed = false
	sent: unknown[] = []
	kill() {
		this.killed = true
		return true
	}
	postMessage(msg: unknown) {
		this.sent.push(msg)
	}
}

// Stands in for electron-updater's autoUpdater: a test plays its events through
// emit() and reads what the app asked of it.
export class FakeUpdater extends EventEmitter {
	active = true
	autoDownload = true
	checks = 0
	installs: unknown[][] = []
	isUpdaterActive() {
		return this.active
	}
	checkForUpdates() {
		this.checks++
		this.emit('checking-for-update')
		return Promise.resolve(null)
	}
	quitAndInstall(...args: unknown[]) {
		this.installs.push(args)
	}
}

export const fake = {
	appHandlers: {} as Record<string, () => void>,
	children: [] as FakeChild[],
	globalShortcuts: new Set<string>(),
	notifications: [] as string[],
	/** The template of the menu last set on the tray. */
	trayMenu: [] as Electron.MenuItemConstructorOptions[],
	updater: new FakeUpdater(),
	userData: fs.mkdtempSync(path.join(os.tmpdir(), 'voice-test-')),
}
// Removed after the run, or every `bun test` leaves one in %TEMP%. A preload's
// afterAll runs once, after every test file.
const initialUserData = fake.userData
afterAll(() => fs.rmSync(initialUserData, { force: true, recursive: true }))

class Notification {
	private readonly body: string
	constructor(options: { body: string }) {
		this.body = options.body
	}
	static isSupported() {
		return true
	}
	show() {
		fake.notifications.push(this.body)
	}
}

const noop = () => undefined

mock.module('electron', () => ({
	app: {
		getAppPath: () => '',
		getPath: () => fake.userData,
		isPackaged: false,
		on: (event: string, handler: () => void) => {
			fake.appHandlers[event] = handler
		},
	},
	autoUpdater: { on: noop },
	// No windows in tests: broadcast() reaches nobody.
	BrowserWindow: { getAllWindows: () => [] },
	ClipboardItem: class {
		readonly entry: unknown
		constructor(entry: unknown) {
			this.entry = entry
		}
	},
	clipboard: {},
	// Keeps what it was built from, so a test can read back what was written.
	globalShortcut: {
		register: (accelerator: string) => {
			fake.globalShortcuts.add(accelerator)
			return true
		},
		unregister: (accelerator: string) => {
			fake.globalShortcuts.delete(accelerator)
		},
	},
	Menu: { buildFromTemplate: (template: unknown) => ({ template }) },
	Notification,
	safeStorage: { isEncryptionAvailable: () => false },
	screen: {},
	session: {},
	shell: { openExternal: () => Promise.resolve() },
	systemPreferences: {},
	Tray: class {
		on = noop
		setToolTip = noop
		setContextMenu(menu: { template: typeof fake.trayMenu }) {
			fake.trayMenu = menu.template
		}
	},
	utilityProcess: {
		fork: () => {
			const child = new FakeChild()
			fake.children.push(child)
			return child
		},
	},
}))

mock.module('electron-updater', () => ({ autoUpdater: fake.updater }))
