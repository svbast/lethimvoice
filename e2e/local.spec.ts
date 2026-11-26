import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import en from '../locales/en.json'
import { launch } from './launch'

// The Local tab without touching the internet: every download is routed to a local
// server that trickles model bytes (never finishing) and answers engines with 404,
// or trickles them too.
let launched: ElectronApplication
let page: Page
let server: http.Server
let userData: string
let engineDownloads: 'missing' | 'trickle' = 'missing'

const openTab = (name: string) =>
	page.getByRole('button', { exact: true, name }).click()
const localStatus = () => page.evaluate(() => window.electron.getLocalStatus())
// The setup card, and its button: "Download recommended · 4.4 GB".
const setupCard = () => page.locator('.local-setup')
const setupButton = () =>
	page.getByRole('button', {
		name: en.local.setup.download.replace(' · {size}', ''),
	})
const setupFailed = en.local.setup.failed.replace(' — {reason}', '')
// One model's tile in the setup card, by its exact label.
const tile = (name: string) =>
	page
		.locator('.local-tile')
		.filter({ has: page.getByText(name, { exact: true }) })
const tileDownload = (name: string) =>
	tile(name).getByRole('button', { exact: true, name: en.local.download })
const offlineSwitch = () =>
	page.getByRole('switch', { name: en.guide.offlineTitle })

// "Installs" the speech engine (and base) the way the app checks them: the server
// exe exists, the model file has its exact size (sparse, nothing written).
const fakeInstall = async (withBase: boolean) => {
	const engine = (await localStatus()).engines.variants.whisper?.id
	if (!engine) throw new Error('no whisper build for this machine')
	await launched.evaluate(
		(_e, { base, dir, id }) => {
			const nodeFs = process.getBuiltinModule('fs')
			const nodePath = process.getBuiltinModule('path')
			const enginesJs = nodePath.join(dir, 'engines.js')
			const load = process.getBuiltinModule('module').createRequire(enginesJs)
			const exe = load(enginesJs).serverPath(id)
			nodeFs.mkdirSync(nodePath.dirname(exe), { recursive: true })
			nodeFs.writeFileSync(exe, '')
			if (!base) return
			const model = load(nodePath.join(dir, 'models.js')).pathFor('stt', 'base')
			nodeFs.mkdirSync(nodePath.dirname(model), { recursive: true })
			nodeFs.closeSync(nodeFs.openSync(model, 'w'))
			nodeFs.truncateSync(model, 147_951_465)
		},
		{ base: withBase, dir: path.resolve('dist-electron/runtime'), id: engine },
	)
	// a remounted tab reads the status again
	await openTab(en.nav.home)
	await openTab(en.nav.local)
}

test.beforeAll(async () => {
	server = http.createServer((req, res) => {
		if (
			decodeURIComponent(req.url ?? '').endsWith('.zip') &&
			engineDownloads === 'missing'
		) {
			res.writeHead(404).end()
			return
		}
		res.writeHead(200, { 'Content-Length': 500_000_000 })
		const tick = setInterval(() => res.write(Buffer.alloc(64 * 1024)), 200)
		res.on('close', () => clearInterval(tick))
	})
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
	const { port } = server.address() as { port: number }

	;({ app: launched, page } = await launch())
	userData = await launched.evaluate(({ app }) => app.getPath('userData'))
	// The app's own downloader module: models.ts / engines.ts call it through its
	// exports object, so swapping the export reroutes every download.
	await launched.evaluate(
		(_e, { file, to }) => {
			const load = process.getBuiltinModule('module').createRequire(file)
			const dl = load(file)
			const real = dl.downloadFile
			dl.downloadTiming.retryMs = [10, 10]
			dl.downloadFile = (url: string, ...rest: unknown[]) =>
				real(`http://127.0.0.1:${to}/${encodeURIComponent(url)}`, ...rest)
		},
		{ file: path.resolve('dist-electron/runtime/downloader.js'), to: port },
	)
	await openTab(en.nav.local)
})
test.afterAll(async () => {
	await launched.close().catch(() => undefined)
	server.closeAllConnections()
	server.close()
	fs.rmSync(userData, { force: true, recursive: true })
})

test('the Local tab is open: setup card alone, no settings or manager yet', async () => {
	await expect(page.getByText(en.local.setup.title)).toBeVisible()
	await expect(setupButton()).toBeVisible()
	// one way in: the Offline switch cannot turn on before the models are on disk,
	// it points at the setup button instead
	await expect(offlineSwitch()).toHaveAttribute('aria-checked', 'false')
	await offlineSwitch().click()
	await expect(offlineSwitch()).toHaveAttribute('aria-checked', 'false')
	await expect(setupButton()).toBeFocused()
	// no settings that cannot act yet, no manager
	await expect(page.getByText(en.local.sttModel, { exact: true })).toHaveCount(
		0,
	)
	await expect(page.locator('details.local-adv')).toHaveCount(0)
})

test('a failed setup says why in the card and offers a retry', async () => {
	await setupButton().click()
	await expect(setupCard()).toContainText(setupFailed, { timeout: 20_000 })
	await expect(
		page.getByRole('button', { name: en.local.setup.retry }),
	).toBeVisible()
})

test('a running setup shows its progress, outlives a tab switch, and cancels', async () => {
	engineDownloads = 'trickle'
	try {
		const status = await localStatus()
		const rec = status.recommendation
		const speech = status.models.stt.find((m) => m.id === rec.stt)?.label
		if (!speech) throw new Error('no recommended speech model')
		// "Downloading 1 of 2…" with text cleanup, else "Downloading speech recognition…"
		const busy = rec.llm
			? en.local.setup.busy.replace('{n}', '1').replace('{total}', '2')
			: en.local.setup.stepStt
		const running = async () => {
			await expect(setupCard()).toContainText(busy)
			await expect(
				page.getByRole('button', { name: en.local.setup.cancelAll }),
			).toBeVisible()
			// the recommended tile carries the download: its engine comes first
			await expect(
				tile(speech).getByRole('button', { name: en.common.cancel }),
			).toBeVisible()
		}

		await page.getByRole('button', { name: en.local.setup.retry }).click()
		await running()
		// the setup runs in main: a remounted tab shows it, and no second button
		await openTab(en.nav.home)
		await openTab(en.nav.local)
		await running()
		await expect(setupButton()).toHaveCount(0)
		await page.getByRole('button', { name: en.local.setup.cancelAll }).click()
		await expect(setupButton()).toBeVisible()
		await expect(setupCard().getByText(setupFailed)).toHaveCount(0)
	} finally {
		engineDownloads = 'missing'
	}
})

test('Home says which mode runs and leads to the offline setup', async () => {
	await openTab(en.nav.home)
	await expect(
		page.getByText(en.home.modeOnline, { exact: true }),
	).toBeVisible()
	await page.getByRole('button', { name: en.guide.offlineButton }).click()
	await expect(page.getByText(en.local.setup.title)).toBeVisible()
})

test('a failed engine download says so on the tile that needed it', async () => {
	// base needs the speech engine first, and engines answer 404
	await tileDownload('Base').click()
	await expect(tile('Base')).toContainText(en.local.downloadFailed, {
		timeout: 20_000,
	})
	await expect(tileDownload('Base')).toBeVisible()
})

test('a download keeps its tile across a tab switch, and cancels', async () => {
	// with the engine on disk a tile downloads its model alone
	await fakeInstall(false)
	await tileDownload('Base').click()
	const cancel = tile('Base').getByRole('button', { name: en.common.cancel })
	await expect(cancel).toBeVisible()
	await openTab(en.nav.home)
	await openTab(en.nav.local)
	// the remounted tab lost its own state, but the download runs on in main:
	// its progress events bring the tile back, still cancellable
	await expect(cancel).toBeVisible()
	await cancel.click()
	await expect(tileDownload('Base')).toBeVisible()
})

test('with speech on disk: settings appear, base gets a language hint, a choice can be cancelled', async () => {
	await fakeInstall(true)
	await page.evaluate(() =>
		window.electron.saveSettings({
			language: 'sk',
			localStt: { model: 'base' },
		}),
	)
	// the window re-reads its settings on focus, as after a change made elsewhere
	await page.evaluate(() => window.dispatchEvent(new Event('focus')))
	await openTab(en.nav.home)
	await openTab(en.nav.local)

	// ready: the settings are back, the setup card is gone, the switch can turn on
	const select = page.getByLabel(en.local.sttModel, { exact: true })
	await expect(select).toBeVisible()
	await expect(page.getByText(en.local.setup.title)).toHaveCount(0)
	await expect(offlineSwitch()).toHaveAttribute('aria-checked', 'false')
	// the manager is folded away; opened, it lists what is on disk
	const advanced = page.locator('details.local-adv')
	expect(await advanced.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(
		false,
	)
	await advanced.locator('summary').click()
	await expect(
		advanced
			.locator('.alert')
			.filter({ has: page.getByText('Base', { exact: true }) }),
	).toContainText(en.local.installed)

	// base is poor in Slovak: a hint under the choice with a one-click switch
	const row = select.locator('..')
	await expect(row).toContainText(
		en.local.hint.text.split('.')[0]?.replace('{current}', 'Base') ?? '',
	)
	await expect(
		row.getByRole('button', { name: en.local.hint.switch }),
	).toBeVisible()

	// the size is in the option before anything downloads
	await expect(
		select.locator('option[value="large-v3-turbo-q5_0"]'),
	).toContainText('MB')
	await select.selectOption('large-v3-turbo-q5_0')
	await expect(row).toContainText(en.local.downloading)
	await row.getByRole('button', { name: en.common.cancel }).click()
	await expect(row).not.toContainText(en.local.downloading)
	await expect(select).toHaveValue('base')
	await expect
		.poll(() => page.evaluate(() => window.electron.getSettings()))
		.toMatchObject({ localStt: { model: 'base' } })
})
