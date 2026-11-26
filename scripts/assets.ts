// Generates every runtime image from build/icon.png (1024×1024, the only
// hand-authored render of the mascot). electron-builder derives the
// installer/bundle icons from the same master on its own, so nothing under
// assets/ is edited by hand.
//
//   assets/window.ico        Windows dev window icon (packaged builds use the exe icon)
//   assets/window.png        Linux X11 window icon
//   assets/tray.ico          Windows tray — Electron picks the entry matching SM_CXSMICON
//   assets/tray.png          Linux tray (StatusNotifierItem)
//   assets/trayTemplate.png  macOS menu bar, black + alpha, 16 px and 32 px @2x
import { mkdir, writeFile } from 'node:fs/promises'

import sharp from 'sharp'

const MASTER = 'build/icon.png'
const OUT = 'assets'
// SM_CXSMICON at 100/125/150/200 % DPI, plus the window sizes Electron documents.
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 256]
const TRAY_ICO_SIZES = [16, 20, 24, 32, 48]
const TRAY_INSET = 0.06

const png = (image: sharp.Sharp) =>
	image.png({ compressionLevel: 9 }).toBuffer()

const app = (size: number) => png(sharp(MASTER).resize(size, size))

/** Trims the master to its content and centers it with a small inset. */
const tray = (size: number) => {
	const pad = Math.round(size * TRAY_INSET)
	return sharp(MASTER)
		.trim()
		.resize(size - 2 * pad, size - 2 * pad, {
			background: '#0000',
			fit: 'contain',
		})
		.extend({
			background: '#0000',
			bottom: pad,
			left: pad,
			right: pad,
			top: pad,
		})
}

/** macOS template image: black with luminance-weighted alpha, so dark details stay cut out. */
const template = async (size: number) => {
	const raw = { channels: 1, height: size, width: size } as const
	const alpha = await tray(size)
		.flatten({ background: '#000' })
		.greyscale()
		.linear(2, 0)
		.raw()
		.toBuffer()
	return png(
		sharp({
			create: { background: '#000', channels: 3, height: size, width: size },
		}).joinChannel(alpha, { raw }),
	)
}

/** ICO container with PNG-compressed entries (Vista+, what Windows' own icons use). */
const ico = async (
	sizes: number[],
	render: (size: number) => Promise<Buffer>,
) => {
	const entries = await Promise.all(
		sizes.map(async (size) => [size, await render(size)] as const),
	)
	const header = Buffer.alloc(6 + 16 * entries.length)
	header.writeUInt16LE(1, 2)
	header.writeUInt16LE(entries.length, 4)
	let at = 6
	let offset = header.length
	for (const [size, image] of entries) {
		header[at] = size % 256
		header[at + 1] = size % 256
		header.writeUInt16LE(1, at + 4)
		header.writeUInt16LE(32, at + 6)
		header.writeUInt32LE(image.length, at + 8)
		header.writeUInt32LE(offset, at + 12)
		at += 16
		offset += image.length
	}
	return Buffer.concat([header, ...entries.map(([, image]) => image)])
}

await mkdir(OUT, { recursive: true })
const write = async (name: string, data: Promise<Buffer>) =>
	writeFile(`${OUT}/${name}`, await data)
await Promise.all([
	write('window.ico', ico(ICO_SIZES, app)),
	write('window.png', app(256)),
	write(
		'tray.ico',
		ico(TRAY_ICO_SIZES, (size) => png(tray(size))),
	),
	write('tray.png', png(tray(32))),
	write('trayTemplate.png', template(16)),
	write('trayTemplate@2x.png', template(32)),
])
