import { expect, it } from 'bun:test'
import { formatShortcut, loneModifier } from './keyCode'

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

it('captures a modifier held alone, on every platform', () => {
	const key = (code: string) => ({ code })
	const right = loneModifier()
	right.down(key('ControlRight'))
	expect(right.up(key('ControlRight'))).toBe('CtrlRight')

	// Another key in between: a chord being typed, not a lone hold.
	const chord = loneModifier()
	chord.down(key('ControlLeft'))
	chord.down(key('ShiftLeft'))
	expect(chord.up(key('ShiftLeft'))).toBeNull()
	expect(chord.up(key('ControlLeft'))).toBeNull()
	// ...and the next clean hold still counts.
	chord.down(key('AltRight'))
	expect(chord.up(key('AltRight'))).toBe('AltRight')
})
