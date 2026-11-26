import koffi from 'koffi'

// The Win32 keyboard calls both the paste (main process) and the shortcut hook (its
// utility process) need; each process loads its own copy.
export const user32 = koffi.load('user32.dll')
const GetAsyncKeyState = user32.func('int16 GetAsyncKeyState(int vKey)')
export const MapVirtualKeyW = user32.func(
	'uint32 MapVirtualKeyW(uint32 uCode, uint32 uMapType)',
)
const keybd_event = user32.func(
	'void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr_t dwExtraInfo)',
)

export const VK = {
	CONTROL: 0x11,
	LWIN: 0x5b,
	MENU: 0x12, // Alt
	RWIN: 0x5c,
	SHIFT: 0x10,
	UNASSIGNED: 0xe8,
	V: 0x56,
}
const KEYEVENTF_KEYUP = 0x00_02
const MAPVK_VK_TO_VSC = 0

export const down = (vk: number) => (GetAsyncKeyState(vk) & 0x80_00) !== 0

export const anyModifierDown = () =>
	[VK.SHIFT, VK.CONTROL, VK.MENU, VK.LWIN, VK.RWIN].some(down)

// With its scan code: apps reading the physical key (games, remote desktop, some
// Java/Qt) ignore a scan-code-0 event.
export const key = (vk: number, up: boolean) =>
	keybd_event(
		vk,
		MapVirtualKeyW(vk, MAPVK_VK_TO_VSC),
		up ? KEYEVENTF_KEYUP : 0,
		0n,
	)
