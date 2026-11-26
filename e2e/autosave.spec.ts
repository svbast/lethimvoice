import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import en from '../locales/en.json'
import { launch } from './launch'

// Settings save themselves as they change; no Save button where a setting is
// edited. Typed values are saved a beat later (useSaveLater) — these pin the
// moments that must neither lose nor revert them.
let launched: ElectronApplication
let page: Page

const main = () => page.evaluate(() => window.electron.getSettings())
const openTab = (name: string) =>
	page.getByRole('button', { exact: true, name }).click()
const noSaveButton = () =>
	expect(page.getByRole('button', { name: en.common.save })).toHaveCount(0)

test.beforeAll(async () => {
	;({ app: launched, page } = await launch())
})
test.afterAll(() => launched.close().catch(() => undefined))

test('a picked option is saved at once', async () => {
	await openTab(en.common.settings)
	await page.getByRole('radio', { name: 'French' }).click()
	await expect.poll(async () => (await main()).language).toBe('fr')
	await noSaveButton()
})

test('a typed API key saves itself and survives the window losing focus', async () => {
	await openTab(en.nav.online)
	const key = page.getByPlaceholder(en.online.keyPlaceholder)
	await key.fill('gsk_first')
	await expect.poll(async () => (await main()).apiKey).toBe('gsk_first')
	await noSaveButton()

	// Focus leaves the window before the save delay is up: saved right then, so the
	// refetch on refocus brings the new key back, not the old one.
	await key.fill('gsk_second')
	await page.evaluate(() => window.dispatchEvent(new Event('blur')))
	expect((await main()).apiKey).toBe('gsk_second')
	await page.evaluate(() => window.dispatchEvent(new Event('focus')))
	await expect(key).toHaveValue('gsk_second')
})

test('personal preferences survive picking a mode right after typing', async () => {
	await openTab(en.nav.prompts)
	const prefs = page.locator('.modes__prefs textarea')
	await prefs.fill('Kubernetes, PostgreSQL')
	// Within the save delay; the mode's save answers with main's merged settings.
	await page
		.locator('.mode-card', {
			has: page.locator('.mode-card__title', {
				hasText: new RegExp(`^${en.modes.email.title}$`),
			}),
		})
		.click()
	await expect(page.locator('.mode-card[aria-checked="true"]')).toContainText(
		en.modes.email.title,
	)
	await expect(prefs).toHaveValue('Kubernetes, PostgreSQL')
	expect(await main()).toMatchObject({
		activeModeId: 'email',
		personalPreferences: 'Kubernetes, PostgreSQL',
	})
	await noSaveButton()
})
