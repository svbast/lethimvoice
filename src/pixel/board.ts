import { type Fx, px } from './engine'

// The status card's dot-matrix board: the shortcut in 5 × 7 letters of blue dots.

// 5 × 7 dot-matrix font: letters, digits, + - and the macOS modifier symbols.
// Anything else prints as a hollow box.
const GLYPHS: Record<string, string> = {
	' ': '000 000 000 000 000 000 000',
	'-': '00000 00000 00000 11111 00000 00000 00000',
	'?': '11111 10001 10001 10001 10001 10001 11111',
	'+': '00000 00100 00100 11111 00100 00100 00000',
	0: '01110 10001 10011 10101 11001 10001 01110',
	1: '00100 01100 00100 00100 00100 00100 01110',
	2: '01110 10001 00001 00010 00100 01000 11111',
	3: '11111 00010 00100 00010 00001 10001 01110',
	4: '00010 00110 01010 10010 11111 00010 00010',
	5: '11111 10000 11110 00001 00001 10001 01110',
	6: '00110 01000 10000 11110 10001 10001 01110',
	7: '11111 00001 00010 00100 01000 01000 01000',
	8: '01110 10001 10001 01110 10001 10001 01110',
	9: '01110 10001 10001 01111 00001 00010 01100',
	A: '01110 10001 10001 10001 11111 10001 10001',
	B: '11110 10001 10001 11110 10001 10001 11110',
	C: '01110 10001 10000 10000 10000 10001 01110',
	D: '11100 10010 10001 10001 10001 10010 11100',
	E: '11111 10000 10000 11110 10000 10000 11111',
	F: '11111 10000 10000 11110 10000 10000 10000',
	G: '01110 10001 10000 10111 10001 10001 01111',
	H: '10001 10001 10001 11111 10001 10001 10001',
	I: '01110 00100 00100 00100 00100 00100 01110',
	J: '00111 00010 00010 00010 00010 10010 01100',
	K: '10001 10010 10100 11000 10100 10010 10001',
	L: '10000 10000 10000 10000 10000 10000 11111',
	M: '10001 11011 10101 10101 10001 10001 10001',
	N: '10001 10001 11001 10101 10011 10001 10001',
	O: '01110 10001 10001 10001 10001 10001 01110',
	P: '11110 10001 10001 11110 10000 10000 10000',
	Q: '01110 10001 10001 10001 10101 10010 01101',
	R: '11110 10001 10001 11110 10100 10010 10001',
	S: '01111 10000 10000 01110 00001 00001 11110',
	T: '11111 00100 00100 00100 00100 00100 00100',
	U: '10001 10001 10001 10001 10001 10001 01110',
	V: '10001 10001 10001 10001 10001 01010 00100',
	W: '10001 10001 10001 10101 10101 10101 01010',
	X: '10001 10001 01010 00100 01010 10001 10001',
	Y: '10001 10001 10001 01010 00100 00100 00100',
	Z: '11111 00001 00010 00100 01000 10000 11111',
	'⇧': '00100 01010 10001 11011 01010 01010 01110',
	'⌃': '00100 01010 10001 00000 00000 00000 00000',
	'⌘': '11011 10101 01110 00100 01110 10101 11011',
	'⌥': '11011 00100 00100 00010 00010 00001 00000',
}

/** The text as dot columns: 7 booleans each, one empty column between letters. */
export const columns = (text: string): (boolean[] | null)[] => {
	const cols: (boolean[] | null)[] = []
	for (const ch of text) {
		const rows = (GLYPHS[ch] ?? (GLYPHS['?'] as string)).split(' ')
		const width = (rows[0] as string).length
		for (let x = 0; x < width; x++) cols.push(rows.map((r) => r[x] === '1'))
		cols.push(null)
	}
	cols.pop()
	return cols
}

// The shortcut lit in blue dots, a white sheen passing over it. Too long to fit, it
// scrolls. One board dot is 2 × 2 cells of 2 px.
export const drawBoard =
	(cols: (boolean[] | null)[]) => (fx: Fx, t: number) => {
		const DW = Math.floor(fx.cols / 2)
		const DH = Math.floor(fx.rows / 2)
		const top = Math.floor((DH - 7) / 2)
		const fits = cols.length <= DW - 2
		const start = Math.floor((DW - cols.length) / 2)
		const period = cols.length + 10
		const shift = Math.floor(t * 8) % period
		const sweep = ((t % 3.2) / 3.2) * (DW + 16) - 8
		for (let dx = 0; dx < DW; dx++) {
			const c = fits ? dx - start : (dx + shift) % period
			const col = c >= 0 && c < cols.length ? cols[c] : null
			const edge = fits
				? 1
				: Math.max(0.2, Math.min(1, dx / 4, (DW - 1 - dx) / 4))
			for (let dy = 0; dy < DH; dy++) {
				const gy = dy - top
				if (!(col && gy >= 0 && gy < 7 && col[gy])) continue
				const i = dx * 2
				const j = dy * 2
				const shine = Math.max(0, 1 - Math.abs(dx + dy * 0.5 - sweep) / 2.5)
				const ci = shine > 0.3 ? 1 : 2
				px(fx, i, j, edge, ci)
				px(fx, i + 1, j, edge * 0.85, ci)
				px(fx, i, j + 1, edge * 0.85, ci)
				px(fx, i + 1, j + 1, edge * 0.65, ci)
			}
		}
	}
