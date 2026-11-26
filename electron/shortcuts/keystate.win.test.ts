import { describe, expect, it } from 'bun:test'

// Real user32: the uiohook-code → VK mapping is the part a wrong guess about the
// encoding would break, and only Windows can answer it.
describe.if(process.platform === 'win32')('keystate.win', () => {
	it('maps uiohook scan codes to VKs, left and right apart', () => {
		const { vkOf } = require('./keystate.win')
		expect(vkOf(0x00_10)).toBe(0x51) // Q
		expect(vkOf(0x00_38)).toBe(0xa4) // left Alt  → VK_LMENU
		expect(vkOf(0x0e_38)).toBe(0xa5) // right Alt → VK_RMENU
		expect(vkOf(0x0e_1d)).toBe(0xa3) // right Ctrl → VK_RCONTROL
		expect(vkOf(0x0e_5c)).toBe(0x5c) // right Win → VK_RWIN
	})
})
