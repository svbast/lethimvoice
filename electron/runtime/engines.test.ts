import { afterAll, describe, expect, it } from 'bun:test'
import type * as EnginesModule from './engines'

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
if (!platformDescriptor) throw new Error('process.platform descriptor missing')

const loadOn = (platform: NodeJS.Platform) => {
	Object.defineProperty(process, 'platform', {
		...platformDescriptor,
		value: platform,
	})
	delete require.cache[require.resolve('./engines')]
	const engines: typeof EnginesModule = require('./engines')
	return { engines, osKey: engines.osKey() }
}

afterAll(() => {
	Object.defineProperty(process, 'platform', platformDescriptor)
	delete require.cache[require.resolve('./engines')]
})

describe.each([
	['win32', 'win'],
	['darwin', 'mac'],
	['linux', 'linux'],
] as const)('on %s', (platform, expected) => {
	const { engines, osKey } = loadOn(platform)

	it(`osKey() is '${expected}'`, () => {
		expect(osKey).toBe(expected)
	})

	it('catalog ids are unique', () => {
		const ids = engines.CATALOG.map((b) => b.id)
		expect(new Set(ids).size).toBe(ids.length)
	})

	// download() verifies the archive against sha256 unconditionally, so a row
	// without one would fail every install.
	it('every variant has a pinned hash, the right archive extension and executable suffix', () => {
		for (const variant of engines.CATALOG) {
			expect(variant.sha256).toHaveLength(64)
			expect(
				variant.url.endsWith(variant.platform === 'win' ? '.zip' : '.tar.gz'),
			).toBe(true)
			expect(variant.server.endsWith('.exe')).toBe(variant.platform === 'win')
		}
	})
})

describe('selectVariant on mac', () => {
	const { engines: mac } = loadOn('darwin')

	it('picks the Metal llama variant', () => {
		expect(
			mac.selectVariant('llama', { arch: 'arm64', platform: 'mac' })?.id,
		).toBe('llama-mac-arm64-metal')
	})

	// No whisper.cpp prebuilt exists for macOS and we host none, so selection must
	// report nothing instead of a row that can only fail to download.
	it('has no whisper variant', () => {
		expect(
			mac.selectVariant('whisper', { arch: 'arm64', platform: 'mac' }),
		).toBeNull()
	})
})

describe('selectVariant on linux', () => {
	const { engines: linux } = loadOn('linux')

	it('prefers the Vulkan llama variant on x64 when the probe reports vulkan', () => {
		expect(
			linux.selectVariant('llama', {
				accel: 'vulkan',
				arch: 'x64',
				platform: 'linux',
			})?.id,
		).toBe('llama-linux-x64-vulkan')
	})

	it('prefers the Vulkan llama variant on arm64 too', () => {
		expect(
			linux.selectVariant('llama', {
				accel: 'vulkan',
				arch: 'arm64',
				platform: 'linux',
			})?.id,
		).toBe('llama-linux-arm64-vulkan')
	})

	it('falls back to CPU on arm64 when the probe reports no GPU', () => {
		expect(
			linux.selectVariant('llama', {
				accel: 'cpu',
				arch: 'arm64',
				platform: 'linux',
			})?.id,
		).toBe('llama-linux-arm64-cpu')
	})

	it('whisper on linux is CPU-only', () => {
		expect(
			linux.selectVariant('whisper', {
				accel: 'vulkan',
				arch: 'x64',
				platform: 'linux',
			})?.id,
		).toBe('whisper-linux-x64-cpu')
	})
})
