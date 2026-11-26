import { afterAll, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readJson, writeJson } from './jsonFile'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-json-'))
const file = path.join(dir, 'data.json')

afterAll(() => fs.rmSync(dir, { force: true, recursive: true }))

it('writes in one rename and reads it back', () => {
	expect(readJson(file)).toBeUndefined()
	writeJson(file, { a: 1 }, 2)
	expect(readJson(file)).toEqual({ a: 1 })
	expect(fs.existsSync(`${file}.tmp`)).toBe(false)
})

it('keeps a file that does not parse as .bak and reads it as missing', () => {
	fs.writeFileSync(file, '{ broken')
	expect(readJson(file)).toBeUndefined()
	expect(fs.existsSync(file)).toBe(false)
	expect(fs.readFileSync(`${file}.bak`, 'utf-8')).toBe('{ broken')
})
