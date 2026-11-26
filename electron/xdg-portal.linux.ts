// xdg-desktop-portal client. Portal methods use Request/Response: call returns a
// Request object path, then the result arrives as a Response signal on that path.
// Listener registered before the call: path is predictable from our bus name and
// handle token. Portal signals are unicast to the caller; no match rules needed.
//
// Unsandboxed callers need xdg-desktop-portal ≥1.20's host Registry, which accepts
// the app id only when <appId>.desktop exists in an XDG applications dir.
//
// dbus-native required lazily: Windows and macOS never load it.
import type * as DbusNative from 'dbus-native'
import type { MessageBus } from 'dbus-native'

import { config } from './utils/config'

const DEST = 'org.freedesktop.portal.Desktop'
const PATH = '/org/freedesktop/portal/desktop'
const PORTAL_PREFIX = 'org.freedesktop.portal.'
const RESPONSE_TIMEOUT_MS = 30_000 // consent dialogs; readable, no PTT wedge

/** a{sv} entries: `Object.entries<Variant>({...})`. */
export type Variant = [signature: string, value: unknown]

/** a{sv} results; dbus-native unpacks into a plain object. */
export type Response = [code: number, results: Record<string, unknown>]

let busPromise: Promise<Portal> | null = null

export const portal = (): Promise<Portal> => {
	if (!busPromise) {
		busPromise = Portal.connect().catch((e) => {
			busPromise = null
			throw e
		})
	}
	return busPromise
}

export class Portal {
	private tokenSeq = 0
	private readonly bus: MessageBus
	private readonly senderPath: string

	private constructor(bus: MessageBus, senderPath: string) {
		this.bus = bus
		this.senderPath = senderPath
	}

	static async connect(): Promise<Portal> {
		const dbus: typeof DbusNative = require('dbus-native')
		const bus = dbus.sessionBus()
		// dbus-native leaves transport 'error' unhandled on purpose (bus.js:135), so
		// a stale DBUS_SESSION_BUS_ADDRESS would take the whole main process down.
		// Pending calls are already failed on 'close'; all that is left is to forget
		// the dead bus so the next paste reconnects instead of failing until relaunch.
		bus.connection.on('error', () => undefined)
		bus.connection.on('close', () => {
			busPromise = null
		})
		// First round-trip: proves portal up (or activates it), Hello assigned our name.
		try {
			await bus.invoke({
				body: [config.appId, []],
				destination: DEST,
				interface: 'org.freedesktop.host.portal.Registry',
				member: 'Register',
				path: PATH,
				signature: 'sa{sv}',
			})
			if (!bus.name) throw new Error('session bus assigned no unique name')
		} catch (e) {
			await bus.close() // caller retries next paste; don't leak a socket per attempt
			throw e
		}
		// Request paths embed unique name as ":1.42" → "1_42".
		return new Portal(bus, bus.name.slice(1).replaceAll('.', '_'))
	}

	/**
	 * Backend implements this interface? (GlobalShortcuts: GNOME 48+, Plasma 6,
	 * Hyprland; none on wlroots/sway, COSMIC, niri.) Every portal interface exposes `version`.
	 */
	async hasInterface(iface: string): Promise<boolean> {
		try {
			await this.bus.invoke({
				body: [PORTAL_PREFIX + iface, 'version'],
				destination: DEST,
				interface: 'org.freedesktop.DBus.Properties',
				member: 'Get',
				path: PATH,
				signature: 'ss',
			})
			return true
		} catch {
			return false
		}
	}

	async call<T = unknown>(
		iface: string,
		member: string,
		signature: string,
		body: unknown[],
	): Promise<T> {
		// dbus-native DBusPromise lacks toStringTag; await widens it.
		return await this.bus.invoke<T>({
			body,
			destination: DEST,
			interface: PORTAL_PREFIX + iface,
			member,
			path: PATH,
			signature,
		})
	}

	async closeSession(handle: string): Promise<void> {
		await this.bus.invoke({
			body: [],
			destination: DEST,
			interface: `${PORTAL_PREFIX}Session`,
			member: 'Close',
			path: handle,
			signature: '',
		})
	}

	request(
		iface: string,
		member: string,
		signature: string,
		body: (token: string) => unknown[],
	): Promise<Response> {
		this.tokenSeq += 1
		const token = `lethim${this.tokenSeq}`
		const key = this.bus.mangle(
			`${PATH}/request/${this.senderPath}/${token}`,
			'org.freedesktop.portal.Request',
			'Response',
		)
		const { promise, resolve, reject } = Promise.withResolvers<Response>()
		const onResponse = (b: unknown[]) => {
			clearTimeout(timer)
			resolve(b as Response)
		}
		const fail = (e: Error) => {
			clearTimeout(timer)
			this.bus.signals.off(key, onResponse)
			reject(e)
		}
		// Method reply comes at once; Response waits on the user (consent dialog).
		// Unanswered: paste chain must fall through, not hang.
		const timer = setTimeout(
			() => fail(new Error('portal request unanswered')),
			RESPONSE_TIMEOUT_MS,
		)
		this.bus.signals.once(key, onResponse)
		this.call(iface, member, signature, body(token)).catch(fail)
		return promise
	}

	/** Session-scoped signals carry session handle in body; callers filter on it. */
	onSignal(
		iface: string,
		member: string,
		handler: (body: unknown[]) => void,
	): void {
		this.bus.signals.on(
			this.bus.mangle(PATH, PORTAL_PREFIX + iface, member),
			handler,
		)
	}
}
