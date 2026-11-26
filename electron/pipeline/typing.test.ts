import { describe, expect, it } from 'bun:test'

import { isTypedBrowser, typingChunks } from './typing'

describe('typing instead of pasting (macOS Chromium)', () => {
	it('picks the Chromium browsers, their channels and web apps, nothing else', () => {
		expect(isTypedBrowser('com.google.Chrome')).toBe(true)
		expect(isTypedBrowser('com.google.Chrome.canary')).toBe(true)
		expect(isTypedBrowser('com.google.Chrome.app.abcdef')).toBe(true)
		expect(isTypedBrowser('com.microsoft.edgemac')).toBe(true)
		expect(isTypedBrowser('com.google.Chromebook')).toBe(false) // prefix, not a dot
		expect(isTypedBrowser('com.apple.Safari')).toBe(false)
	})

	it('chunks ≤ 20 UTF-16 units of whole characters, the last never alone', () => {
		const text = `${'a'.repeat(20)}b`
		expect(typingChunks(text)).toEqual(['a'.repeat(19), 'ab'])
		const emoji = '👍'.repeat(11) // 2 units each
		const chunks = typingChunks(emoji) ?? []
		expect(chunks.join('')).toBe(emoji)
		for (const c of chunks) expect(c.length).toBeLessThanOrEqual(20)
		expect(typingChunks('Crème brûlée at the café, naïve?')?.join('')).toBe(
			'Crème brûlée at the café, naïve?',
		)
	})

	it('never builds a chunk over 20 units, and pastes a character longer than that', () => {
		const family = '👨‍👩‍👧‍👦' // one character, 11 units
		const chunks = typingChunks(`${'a'.repeat(9)}${family}${family}`) ?? []
		expect(chunks.join('')).toBe(`${'a'.repeat(9)}${family}${family}`)
		for (const c of chunks) expect(c.length).toBeLessThanOrEqual(20)
		expect(typingChunks(`a${'👍'.repeat(11)}`.slice(0, 3))).not.toBeNull()
		expect(
			typingChunks(`ab${'\u{1F3F4}'}${'\u{E0067}\u{E0062}'.repeat(5)}`),
		).toBeNull() // one 12-unit flag + tags > 20
	})

	it('refuses what ⌘V would do differently: line breaks, tabs, one character, too long', () => {
		expect(typingChunks('one\ntwo')).toBeNull()
		expect(typingChunks('one\ttwo')).toBeNull()
		expect(typingChunks('a')).toBeNull()
		expect(typingChunks('a'.repeat(2001))).toBeNull()
	})
})
