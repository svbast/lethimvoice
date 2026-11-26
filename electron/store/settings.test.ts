import { afterAll, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fake } from '../electron.mock'
import type * as Settings from './settings'

const userData = fake.userData
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-settings-'))
fake.userData = dir

// ?query: a private instance. Reloading the shared one (require.cache) would leave
// modules loaded before this file and test files after it on two different caches.
const settings: typeof Settings = require('./settings?test')
const file = path.join(dir, 'settings.json')

afterAll(() => {
	fake.userData = userData
	fs.rmSync(dir, { force: true, recursive: true })
})

it('keeps an undecryptable api key on disk', () => {
	fs.writeFileSync(file, JSON.stringify({ apiKeyEnc: 'Y2lwaGVy' }))

	const loaded = settings.loadSettings()
	expect(loaded.apiKey).toBe('')
	settings.saveSettings({ ...loaded, language: 'cs' })

	const stored = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
		apiKeyEnc?: string
		language?: string
	}
	expect(stored.apiKeyEnc).toBe('Y2lwaGVy')
	expect(stored.language).toBe('cs')

	fs.writeFileSync(file, JSON.stringify({ apiKey: 'plaintext-key' }))
	expect(settings.loadSettings().apiKey).toBe('plaintext-key')
})
