// electron-builder afterPack hook — codesign the macOS app bundle.
//
// We ship without an Apple Developer certificate (mac.identity: null skips
// electron-builder's own signing), but the bundle still MUST be signed:
//   1. Apple Silicon refuses to launch a binary with no signature at all —
//      repacking invalidates the seal Electron's prebuilt binary shipped with,
//      and the kernel kills the process on first exec.
//   2. macOS TCC (Accessibility, Microphone) identifies an app by its code
//      signature. A bare ad-hoc signature ("-") has NO stable identity, so on
//      macOS 12+ the Accessibility grant the global hotkey needs often refuses
//      to stick across launches. A SELF-SIGNED certificate gives the app a
//      stable designated requirement, so the grant persists — even across
//      rebuilds and app updates signed with the same certificate.
//
// So we prefer a local self-signed certificate (create it once with
// build/make-signing-cert.sh) and fall back to ad-hoc if it isn't present, which
// keeps CI and fresh checkouts building without setup. Either way the build stays
// unsigned in Apple's eyes: Gatekeeper still asks for a one-time approval
// (System Settings → Privacy & Security → "Open Anyway", or
// `xattr -cr "/Applications/LetHim Voice.app"`). No hardened runtime — without a
// real Developer ID it would only break microphone/TCC and native modules.
const path = require('node:path')
const { execFileSync } = require('node:child_process')

interface AfterPackContext {
	electronPlatformName: string
	appOutDir: string
	packager: { appInfo: { productFilename: string } }
}

// Common Name of the local self-signed code-signing certificate (see
// build/make-signing-cert.sh). Kept in sync with that script.
const SIGN_IDENTITY = 'LetHim Voice Local Signing'

// Use the self-signed cert if it's in a keychain, otherwise ad-hoc ("-").
function resolveIdentity() {
	try {
		execFileSync('security', ['find-certificate', '-c', SIGN_IDENTITY], {
			stdio: 'ignore',
		})
		return SIGN_IDENTITY
	} catch {
		return '-'
	}
}

exports.default = function afterPack(context: AfterPackContext) {
	if (context.electronPlatformName !== 'darwin') return

	const appName = `${context.packager.appInfo.productFilename}.app`
	const appPath = path.join(context.appOutDir, appName)
	execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' })

	const identity = resolveIdentity()
	execFileSync('codesign', ['--force', '--deep', '--sign', identity, appPath], {
		stdio: 'inherit',
	})

	// Strip once more right before verifying: if the build tree lives in an
	// iCloud-synced folder (e.g. ~/Desktop with Desktop & Documents sync on), the
	// fileprovider daemon re-stamps com.apple.FinderInfo within seconds of the
	// sign step, and `codesign --verify --strict` then rejects the bundle. Building
	// from a checkout OUTSIDE any iCloud-synced folder (or in CI, as releases are)
	// avoids this entirely; this second strip just narrows the race so an in-place
	// build has a chance.
	execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' })

	// Verify the seal so a broken signature fails the build, not the user's Mac.
	execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], {
		stdio: 'inherit',
	})
}
