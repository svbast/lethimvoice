import { down, key, MapVirtualKeyW, VK } from '../utils/keyboard.win'
import type { Keys } from './keystate'

const MAPVK_VSC_TO_VK_EX = 3

// uiohook keycodes are set-1 scan codes; 0x0Exx marks the E0-prefixed (extended)
// ones (Right Alt 0x0E38, Right Ctrl 0x0E1D). _EX keeps left and right apart.
export const vkOf = (keycode: number): number =>
	MapVirtualKeyW(
		(keycode & 0xff) | (keycode & 0xff_00 ? 0xe0_00 : 0),
		MAPVK_VSC_TO_VK_EX,
	)

const modifiersDown = (m: Keys): boolean =>
	(m.alt && down(VK.MENU)) ||
	(m.ctrl && down(VK.CONTROL)) ||
	(m.shift && down(VK.SHIFT)) ||
	(m.meta && (down(VK.LWIN) || down(VK.RWIN)))

export const isHeld = (keys: Keys): boolean | undefined => {
	const vk = vkOf(keys.keycode)
	if (!vk) return undefined
	return down(vk) || (!keys.modifierOnly && modifiersDown(keys))
}

// Alt (Win) going up with no key pressed since it went down opens the menu bar (the
// Start menu), and the key a global shortcut eats no longer counts. One unassigned
// key while it is held stands in (Handy; AutoHotkey's "menu mask key").
export const maskMenu = () => {
	key(VK.UNASSIGNED, false)
	key(VK.UNASSIGNED, true)
}
