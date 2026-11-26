// Accessibility, not Input Monitoring: uiohook tap is kCGEventTapOptionDefault
// (may modify events); macOS gates it behind AXIsProcessTrusted. Same grant
// covers synthetic ⌘V paste. Microphone: macOS prompts on first getUserMedia,
// never reprompts once denied.
import { shell, systemPreferences } from 'electron'

const PANE = { accessibility: 'Accessibility', microphone: 'Microphone' }

export const isAccessibilityTrusted = (prompt = false): boolean =>
	systemPreferences.isTrustedAccessibilityClient(prompt)

export interface PermissionStatus {
	microphone: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'
	accessibility: boolean
}

/** Legacy pane URLs; Ventura+ honors them via compatibility shim. */
export const openSettingsPane = (target: string): void => {
	const pane = PANE[target as keyof typeof PANE]
	if (pane)
		shell
			.openExternal(
				`x-apple.systempreferences:com.apple.preference.security?Privacy_${pane}`,
			)
			.catch(() => undefined)
}

export const getPermissionStatus = (): PermissionStatus => ({
	accessibility: isAccessibilityTrusted(),
	microphone: systemPreferences.getMediaAccessStatus('microphone'),
})

/**
 * `isTrustedAccessibilityClient(true)` shows Apple's sheet once per install;
 * pane opened too, for when that sheet was already dismissed.
 */
export const promptAccessibility = (): boolean => {
	const trusted = isAccessibilityTrusted(true)
	if (!trusted) openSettingsPane('accessibility')
	return trusted
}
