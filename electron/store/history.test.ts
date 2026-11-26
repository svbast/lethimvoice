import { afterAll, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { gc } from 'bun'
import { fake } from '../electron.mock'
import type * as History from './history'

const CAP = 500
const userData = fake.userData
const dirs: string[] = []

const history: typeof History = require('./history')
const closeDb = fake.appHandlers['will-quit'] as () => void

const useDir = (): string => {
	closeDb()
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-history-'))
	dirs.push(dir)
	fake.userData = dir
	return dir
}

const added = (input: Parameters<typeof history.add>[0]): History.HistoryItem =>
	history.add(input) as History.HistoryItem

afterAll(() => {
	closeDb()
	fake.userData = userData
	// Windows keeps history.db locked until the closed connection's statements
	// are garbage-collected; deleting an open file fails there with EBUSY.
	gc(true)
	for (const dir of dirs) fs.rmSync(dir, { force: true, recursive: true })
})

it('stores, pages, searches and deletes dictations', () => {
	const dir = useDir()
	expect(history.add({ text: '   ' })).toBeNull()
	const a = added({ backend: 'local', durationMs: 1234.6, text: 'ŠKODA auto' })
	const b = added({ text: 'hello world' })
	const c = added({ text: 'Auto pilot' })
	expect(a).toMatchObject({ backend: 'local', lang: 'auto', ms: 1235 })
	expect(b.backend).toBe('cloud')

	expect(history.list().items.map((i) => i.id)).toEqual([c.id, b.id, a.id])
	expect(history.list({ before: c.id, limit: 1 })).toEqual({
		items: [b],
		total: 3,
	})
	expect(history.list({ limit: 1.5 }).items).toEqual([c])

	const auto = history.list({ query: 'škoda' })
	expect(auto.items.map((i) => i.text)).toEqual(['ŠKODA auto'])
	expect(history.list({ query: ' AUTO ' }).total).toBe(2)

	history.remove(b.id)
	expect(history.list().total).toBe(2)
	history.clear()
	expect(history.list()).toEqual({ items: [], total: 0 })
	expect(added({ text: 'after clear' }).id).toBeGreaterThan(c.id)
	expect(fs.existsSync(path.join(dir, 'history.db'))).toBe(true)
})

it('caps the stored dictations', () => {
	useDir()
	for (let i = 0; i <= CAP + 1; i++) history.add({ text: `entry ${i}` })
	expect(history.list().total).toBe(CAP)
	expect(history.list({ query: 'entry 0' }).total).toBe(0)
	expect(history.list({ limit: 1 }).items[0]?.text).toBe(`entry ${CAP + 1}`)
})

it('keeps working when the database cannot be opened', () => {
	closeDb()
	fake.userData = path.join(useDir(), 'no-such-dir')
	expect(history.add({ text: 'unlucky' })).toBeNull()
	expect(history.list()).toEqual({ items: [], total: 0 })
})
