import { afterAll, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fake } from '../electron.mock'
import type * as Stats from './stats'

const userData = fake.userData
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-stats-'))

// ?query: a private instance, see settings.test.ts.
const stats: typeof Stats = require('./stats?test')
const flush = fake.appHandlers['before-quit'] as () => void

afterAll(() => {
	fake.userData = userData
	fs.rmSync(dir, { force: true, recursive: true })
})

it('a save that fails never throws, and the next one writes everything', () => {
	fake.userData = path.join(dir, 'missing')
	stats.recordRecording({ durationMs: 1000 })
	expect(flush).not.toThrow()

	fake.userData = dir
	stats.recordRecording({ durationMs: 500 })
	flush()
	const { days } = JSON.parse(
		fs.readFileSync(path.join(dir, 'stats.json'), 'utf8'),
	) as { days: object }
	expect(Object.values(days)).toEqual([{ ms: 1500, n: 2 }])
})

it('parses Groq durations with "ms" before "m"', () => {
	expect(stats.parseDuration('500ms')).toBe(500)
	expect(stats.parseDuration('43.2s')).toBe(43_200)
	expect(stats.parseDuration('2m52.8s')).toBe(172_800)
	expect(stats.parseDuration('1h30m')).toBe(5_400_000)
	expect(stats.parseDuration(null)).toBe(0)
})
