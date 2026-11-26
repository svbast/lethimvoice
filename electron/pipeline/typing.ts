// What paste.mac.ts types instead of pasting, kept apart from its CoreGraphics
// calls so it can be tested anywhere.

// Chromium browsers drop a synthetic ⌘V's insert in waves (Chrome 155: paste and
// beforeinput fire, nothing is inserted); typed unicode events never dropped. Same
// list and rules as OpenWhispr's macos-fast-paste.swift (MIT, PR #2934). Channels
// and installed web apps run as "<id>.<suffix>".
const TYPED_BROWSERS = [
	'com.google.Chrome',
	'org.chromium.Chromium',
	'com.brave.Browser',
	'com.microsoft.edgemac',
	'company.thebrowser.Browser',
	'company.thebrowser.dia',
	'com.vivaldi.Vivaldi',
	'com.operasoftware.Opera',
	'ai.perplexity.comet',
]
export const isTypedBrowser = (id: string) =>
	TYPED_BROWSERS.some((b) => id === b || id.startsWith(`${b}.`))

const MAX_TYPED = 2000
const MAX_CHUNK = 20

// Chunks of whole characters, at most 20 UTF-16 units; null when typing could do
// what ⌘V wouldn't. A typed line break or tab is a key press (Return submits a
// form, sends a chat), and a lone character reaches the page as a plain keypress (a
// one-key site shortcut), so a single character, also as the last chunk, is out.
export const typingChunks = (text: string): string[] | null => {
	if (text.length > MAX_TYPED || /[\p{Cc}\u2028\u2029]/u.test(text)) return null
	const chars = Array.from(new Intl.Segmenter().segment(text), (s) => s.segment)
	// One event carries at most 20 units; a longer character (a family emoji) can't
	// be split, so that text is pasted.
	if (chars.length < 2 || chars.some((c) => c.length > MAX_CHUNK)) return null
	const chunks: string[][] = []
	let length = 0
	for (const c of chars) {
		const current = chunks.at(-1)
		if (current && length + c.length <= MAX_CHUNK) {
			current.push(c)
			length += c.length
		} else {
			chunks.push([c])
			length = c.length
		}
	}
	const last = chunks.at(-1)
	const before = chunks.at(-2)
	const moved = before?.at(-1)
	if (
		last?.length === 1 &&
		before &&
		before.length > 1 &&
		moved &&
		moved.length + (last[0]?.length ?? 0) <= MAX_CHUNK
	)
		last.unshift(before.pop() as string)
	return chunks.map((c) => c.join(''))
}
