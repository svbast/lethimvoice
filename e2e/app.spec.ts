import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { launch } from './launch'

let launched: ElectronApplication
let page: Page
const crashed: string[] = []

test.beforeAll(async () => {
	;({ app: launched, page } = await launch((p) =>
		p.on('crash', () => crashed.push(p.url())),
	))
})
test.afterAll(() => launched.close().catch(() => undefined))

test('settings and pill windows exist with their fixed sizes', async () => {
	const sizes = await launched.evaluate(({ BrowserWindow }) =>
		BrowserWindow.getAllWindows()
			.map((w) => ({ ...w.getBounds(), visible: w.isVisible() }))
			.sort((a, b) => b.width - a.width),
	)
	expect(sizes).toHaveLength(2)
	expect(sizes[0]).toMatchObject({ height: 720, visible: true, width: 960 })
	expect(sizes[1]).toMatchObject({ height: 48, visible: false, width: 210 })
})

test('preload exposes the typed API and main answers', async () => {
	const result = await page.evaluate(async () => {
		const api = window.electron
		const state = await api.getAppState()
		return {
			history: await api.getHistory(),
			local: Object.keys(await api.getLocalStatus()),
			methods: Object.keys(api).length,
			shortcut: state.settings.shortcut,
			shortcutBackend: state.shortcut.backend,
		}
	})
	expect(result.methods).toBeGreaterThan(25)
	expect(typeof result.shortcut).toBe('string')
	expect(typeof result.shortcutBackend).toBe('string')
	expect(result.history).toEqual({ items: [], total: 0 })
	expect(result.local).toEqual([
		'cpuFallback',
		'engines',
		'freeGb',
		'languageHint',
		'machine',
		'models',
		'recommendation',
		'setup',
	])
})

test('a killed pill renderer is hidden and reloaded', async () => {
	const pillPage = launched
		.windows()
		.find((p) => p.url().includes('mode=compact'))
	if (!pillPage) throw new Error('pill window not found')
	const before = crashed.length
	await launched.evaluate(({ BrowserWindow }) => {
		for (const w of BrowserWindow.getAllWindows())
			if (w.getBounds().width === 210) w.show()
	})
	// Playwright only finishes attaching (Page.createIsolatedWorld) once the
	// hidden pill's renderer gets scheduled; a crash while that call is pending
	// surfaces as a bare "Target crashed" test failure. Any evaluate drains it.
	await pillPage.evaluate(() => document.readyState)
	const result = await launched.evaluate(async ({ BrowserWindow }) => {
		const pill = BrowserWindow.getAllWindows().find(
			(w) => w.getBounds().width === 210,
		)
		if (!pill) throw new Error('no pill window')
		const gone = new Promise<string>((done) =>
			pill.webContents.once('render-process-gone', (_e, d) => done(d.reason)),
		)
		const loaded = new Promise<void>((done) =>
			pill.webContents.once('did-finish-load', done),
		)
		process.kill(pill.webContents.getOSProcessId(), 'SIGKILL')
		const reason = await gone
		await loaded
		return {
			crashed: pill.webContents.isCrashed(),
			hidden: !pill.isVisible(),
			reason,
		}
	})
	expect(result).toEqual({ crashed: false, hidden: true, reason: 'killed' })
	await expect.poll(() => crashed.length).toBe(before + 1)
	crashed.length = 0 // the one deliberate crash; the last test must see none
})

test('no renderer crashes; quit closes for real', async () => {
	expect(crashed).toEqual([])

	launched.evaluate(({ app }) => app.quit()).catch(() => undefined)
	await launched.waitForEvent('close')
})
