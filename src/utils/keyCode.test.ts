import { expect, it } from 'bun:test'
import { formatShortcut } from './keyCode'

it('names the Meta key the way each platform does', () => {
	expect(formatShortcut('Meta', 'win32')).toBe('Win')
	expect(formatShortcut('Meta', 'linux')).toBe('Super')
	expect(formatShortcut('MetaRight', 'linux')).toBe('Right Super')
	expect(formatShortcut('Meta', 'darwin')).toBe('⌘')
})

it('leaves the other modifiers and combos alone off macOS', () => {
	expect(formatShortcut('Alt', 'linux')).toBe('Alt')
	expect(formatShortcut('Ctrl+Shift+Space', 'linux')).toBe('Ctrl+Shift+Space')
	expect(formatShortcut('Ctrl+Q', 'darwin')).toBe('⌃ Q')
	expect(formatShortcut(null, 'linux')).toBe('')
})
