import fs from 'node:fs'

/**
 * The parsed file, or undefined when there is none. A file that does not parse is
 * renamed to `.bak` (kept for diagnostics, never silently overwritten) and reads as
 * missing.
 */
export const readJson = (file: string): unknown => {
	try {
		if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'))
	} catch {
		try {
			fs.renameSync(file, `${file}.bak`)
		} catch {
			/* best effort */
		}
	}
	return undefined
}

/** Replaces the file in one rename: a crash mid-write never leaves half a file. */
export const writeJson = (file: string, data: unknown, indent?: number) => {
	fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, indent))
	fs.renameSync(`${file}.tmp`, file)
}
