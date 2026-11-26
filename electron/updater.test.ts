import { afterAll, expect, it, spyOn } from 'bun:test'

import { fake } from './electron.mock'

// tray.test loads the updater, and desktop-entry.linux.test then reloads
// utils/config: a fresh updater, and the config it reads, keep this file on one copy.
delete require.cache[require.resolve('./updater')]
const { checkForUpdate, installUpdate, startUpdater, updateState } =
	require('./updater') as typeof import('./updater')
const { config } = require('./utils/config') as typeof import('./utils/config')

const updater = fake.updater
const quiet = spyOn(console, 'error').mockImplementation(() => undefined)
afterAll(() => quiet.mockRestore())
const phases: string[] = []

it('downloads a new version, then offers the restart and keeps it', async () => {
	startUpdater(() => phases.push(updateState().phase))
	expect(updater.autoDownload).toBe(true)

	await checkForUpdate()
	updater.emit('update-available', { version: '2.0.1' })
	updater.emit('download-progress', { percent: 41.7 })
	expect(updateState()).toMatchObject({
		percent: 41,
		phase: 'downloading',
		version: '2.0.1',
	})
	updater.emit('download-progress', { percent: 41.9 })
	updater.emit('update-downloaded', { version: '2.0.1' })
	// The tray rebuilds on a new phase, never on progress.
	expect(phases).toEqual(['checking', 'downloading', 'ready'])

	// The 6-hourly check must not hide the restart behind "checking".
	await checkForUpdate()
	expect(updater.checks).toBe(1)
	installUpdate()
	expect(updater.installs).toEqual([[true, true]])
})

it('a failure is never fatal and the next check runs again', async () => {
	updater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
	expect(updateState().phase).toBe('error')
	installUpdate()
	expect(updater.installs).toHaveLength(1)
	await checkForUpdate()
	expect(updater.checks).toBe(2)
	updater.emit('update-not-available', { version: '1.11.0' })
	expect(updateState().phase).toBe('latest')
})

it('the portable exe only points to the new version', () => {
	const portable = config as { portableExe?: string }
	portable.portableExe = 'C:\\LetHim Voice.exe'
	try {
		updater.emit('update-available', { version: '2.0.2' })
		expect(updateState()).toMatchObject({
			phase: 'available',
			version: '2.0.2',
		})
	} finally {
		portable.portableExe = undefined
	}
})

it('a copy that cannot update itself never checks', async () => {
	updater.active = false
	startUpdater(() => undefined)
	expect(updateState().phase).toBe('manual')
	await checkForUpdate()
	expect(updater.checks).toBe(2)
})
