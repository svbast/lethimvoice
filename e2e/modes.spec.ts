import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import {
	BUILTIN_MODES,
	preparePostProcess,
	temperatureFor,
} from '../electron/pipeline/prompts'
import en from '../locales/en.json'
import { launch } from './launch'

// Does the mode picked in Settings — built-in or the user's own — drive the very
// NEXT dictation? Real UI, IPC and pipeline; only Groq's network is stubbed in
// main, where the chat request the LLM would get is captured.
const SAID = 'hello this is a test'

interface Chat {
	messages: Array<{ content: string }>
	temperature: number
}
type Stubbed = typeof globalThis & { chats: Chat[] }

let launched: ElectronApplication
let page: Page

const card = (title: string) =>
	page.locator('.mode-card', {
		has: page.locator('.mode-card__title', {
			hasText: new RegExp(`^${title}$`),
		}),
	})
const editor = () => page.locator('.mode-editor')
const mainSettings = () => page.evaluate(() => window.electron.getSettings())
const idOf = async (title: string) =>
	(await mainSettings()).modes.find((m) => m.title === title)?.id ?? ''

const pick = async (title: string) => {
	await card(title).click()
	await expect(card(title)).toHaveAttribute('aria-checked', 'true')
	await expect(page.locator('.mode-card[aria-checked="true"]')).toHaveCount(1)
}

const saveMode = async (title: string, text: string) => {
	await editor().getByPlaceholder(en.modes.namePlaceholder).fill(title)
	await editor().getByPlaceholder(en.modes.instructionsPlaceholder).fill(text)
	await editor().getByRole('button', { name: en.common.save }).click()
	await expect(card(title)).toHaveAttribute('aria-checked', 'true')
}

// One dictation through main's real pipeline: the LLM must get exactly the prompt
// of mode `id` (no call at all for Raw). Returns that system prompt.
const expectNextDictation = async (id: string) => {
	const settings = await mainSettings()
	expect(settings.activeModeId).toBe(id)
	const before = await launched.evaluate(
		() => (globalThis as Stubbed).chats.length,
	)
	const pasted = await page.evaluate(() =>
		window.electron.transcribe(new ArrayBuffer(2000), 'audio/wav', 1000),
	)
	const sent = await launched.evaluate(
		(_e, n) => (globalThis as Stubbed).chats.slice(n),
		before,
	)
	const prep = preparePostProcess(SAID, settings)
	if (!prep) {
		expect(sent).toEqual([])
		expect(pasted).toBe(SAID)
		return ''
	}
	expect(sent).toHaveLength(1)
	const [system, user] = (sent[0] as Chat).messages.map((m) => m.content)
	expect(system).toBe(prep.systemPrompt)
	expect(user).toBe(prep.userMessage)
	expect((sent[0] as Chat).temperature).toBe(temperatureFor(prep.mode.kind))
	expect(pasted).toBe('processed')
	return system ?? ''
}

test.beforeAll(async () => {
	;({ app: launched, page } = await launch())
	await launched.evaluate((_e, said) => {
		const g = globalThis as Stubbed
		g.chats = []
		g.fetch = ((url: string, init: { body: string }) => {
			if (url.endsWith('/audio/transcriptions'))
				return Promise.resolve(Response.json({ text: said }))
			g.chats.push(JSON.parse(init.body))
			return Promise.resolve(
				Response.json({ choices: [{ message: { content: 'processed' } }] }),
			)
		}) as unknown as typeof fetch
	}, SAID)
	await page.getByRole('button', { exact: true, name: en.nav.prompts }).click()
	await page.evaluate(() => window.electron.saveSettings({ apiKey: 'e2e' }))
})
test.afterAll(() => launched.close().catch(() => undefined))

test('every built-in mode, once clicked, drives the next dictation', async () => {
	for (const id of [
		'email',
		'chat',
		'todo',
		'rewrite',
		'assistant',
		'translate',
		'raw',
		'clean',
	] as const) {
		await pick(en.modes[id].title)
		const system = await expectNextDictation(id)
		const mode = BUILTIN_MODES.find((m) => m.id === id)
		if (mode?.kind === 'agent')
			expect(system.startsWith(mode.promptText)).toBe(true)
		if (mode?.kind === 'wrapped') expect(system).toContain(mode.task)
	}
})

test('own modes: created, switched, edited, deleted — each drives the next dictation', async () => {
	await page.getByRole('button', { name: en.modes.addCustom }).click()
	await saveMode('Summary', 'Summarize the dictation in one sentence.')
	const summary = await idOf('Summary')
	expect(await expectNextDictation(summary)).toContain(
		'<TASK_INSTRUCTIONS>\nSummarize the dictation in one sentence.\n</TASK_INSTRUCTIONS>',
	)

	// Answering is the mode's own task, so it runs inside the same wrapper.
	await page.getByRole('button', { name: en.modes.addCustom }).click()
	await saveMode('Answer', 'Answer the question in the dictation.')
	const answer = await idOf('Answer')
	expect(await expectNextDictation(answer)).toContain(
		'<TASK_INSTRUCTIONS>\nAnswer the question in the dictation.\n</TASK_INSTRUCTIONS>',
	)

	await pick('Summary')
	await expectNextDictation(summary)

	await card('Summary').getByRole('button', { name: 'Edit mode' }).click()
	await saveMode('Summary', 'Summarize the dictation in three words.')
	expect(await expectNextDictation(summary)).toContain(
		'Summarize the dictation in three words.',
	)

	await pick(en.modes.translate.title)
	await expectNextDictation('translate')

	// Clicked in quick succession, no waiting in between: last click wins, UI and main.
	await card(en.modes.email.title).click()
	await card(en.modes.assistant.title).click()
	await card('Answer').click()
	await expect(card('Answer')).toHaveAttribute('aria-checked', 'true')
	await expectNextDictation(answer)

	// Deleting the active mode falls back to Clean, never strands the choice.
	await card('Answer').getByRole('button', { name: 'Edit mode' }).click()
	await editor().getByRole('button', { name: en.common.delete }).click()
	await expect(card('Answer')).toHaveCount(0)
	await expect(card(en.modes.clean.title)).toHaveAttribute(
		'aria-checked',
		'true',
	)
	await expectNextDictation('clean')

	// settings.json on disk = what the next launch starts with.
	const disk = await launched.evaluate(({ app }) =>
		JSON.parse(
			process
				.getBuiltinModule('node:fs')
				.readFileSync(`${app.getPath('userData')}/settings.json`, 'utf-8'),
		),
	)
	expect(disk.activeModeId).toBe('clean')
	expect(disk.modes).toEqual([
		{
			id: summary,
			promptText: 'Summarize the dictation in three words.',
			title: 'Summary',
		},
	])
})
