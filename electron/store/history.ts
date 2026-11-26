// Dictation history stays local in userData/history.db, never sent anywhere.
// node:sqlite (built into Electron's Node) — nothing resident but SQLite's page
// cache, µs writes, search and paging in SQL instead of the renderer.

import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'

export interface HistoryItem {
	id: number
	ts: number
	text: string
	ms: number
	backend: 'cloud' | 'local'
	lang: string
}

interface HistoryPage {
	items: HistoryItem[]
	total: number
}

export interface ListOptions {
	query?: string
	/** Cursor: rows older than this id only. Immune to mid-scroll inserts, unlike OFFSET. */
	before?: number
	limit?: number
}

const PAGE = 50
const MAX_ENTRIES = 500
const NO_CURSOR = Number.MAX_SAFE_INTEGER
const CACHE_KIB = 512
const COLS = 'id, ts, text, ms, backend, lang'

const prepare = (db: DatabaseSync) => ({
	clear: db.prepare('DELETE FROM history'),
	count: db.prepare('SELECT count(*) AS n FROM history'),
	countQ: db.prepare('SELECT count(*) AS n FROM history WHERE has(text, ?)'),
	db,
	insert: db.prepare(
		`INSERT INTO history (ts, text, ms, backend, lang) VALUES (?, ?, ?, ?, ?) RETURNING ${COLS}`,
	),
	page: db.prepare(
		`SELECT ${COLS} FROM history WHERE id < ? ORDER BY id DESC LIMIT ?`,
	),
	pageQ: db.prepare(
		`SELECT ${COLS} FROM history WHERE id < ? AND has(text, ?) ORDER BY id DESC LIMIT ?`,
	),
	remove: db.prepare('DELETE FROM history WHERE id = ?'),
	trim: db.prepare(
		'DELETE FROM history WHERE id <= (SELECT id FROM history ORDER BY id DESC LIMIT 1 OFFSET ?)',
	),
})
type Store = ReturnType<typeof prepare>

let _store: Store | null = null

const dbPath = () => path.join(app.getPath('userData'), 'history.db')

const open = (): Store => {
	const db = new DatabaseSync(dbPath())
	db.exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA synchronous = NORMAL;
		PRAGMA cache_size = -${CACHE_KIB};
		CREATE TABLE IF NOT EXISTS history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			ts INTEGER NOT NULL,
			text TEXT NOT NULL,
			ms INTEGER NOT NULL,
			backend TEXT NOT NULL,
			lang TEXT NOT NULL
		) STRICT
	`)
	// JS toLowerCase: SQLite LIKE/lower() are ASCII-only, search must stay Unicode-aware.
	db.function(
		'has',
		{ deterministic: true, directOnly: true },
		(text, needle) =>
			(text as string).toLowerCase().includes(needle as string) ? 1 : 0,
	)
	return prepare(db)
}

const store = (): Store | null => {
	if (_store) return _store
	try {
		_store = open()
	} catch {
		try {
			fs.renameSync(dbPath(), `${dbPath()}.bak`)
			_store = open()
		} catch {
			return null
		}
	}
	return _store
}

const guard = <T>(run: (s: Store) => T, fallback: T): T => {
	try {
		const s = store()
		return s ? run(s) : fallback
	} catch {
		return fallback
	}
}

const posInt = (value: unknown, max: number) => {
	const n = Math.trunc(Number(value))
	return n >= 1 && n <= max ? n : max
}

export const add = ({
	text,
	durationMs,
	backend,
	lang,
}: {
	text?: unknown
	durationMs?: unknown
	backend?: string
	lang?: string
}): HistoryItem | null => {
	const clean = String(text || '').trim()
	if (!clean) return null
	return guard<HistoryItem | null>((s) => {
		const item = s.insert.get(
			Date.now(),
			clean,
			Number(durationMs) > 0 ? Math.round(Number(durationMs)) : 0,
			backend === 'local' ? 'local' : 'cloud',
			lang || 'auto',
		) as unknown as HistoryItem
		s.trim.run(MAX_ENTRIES)
		return item
	}, null)
}

export const list = ({ query, before, limit }: ListOptions = {}): HistoryPage =>
	guard<HistoryPage>(
		(s) => {
			const q = query?.trim().toLowerCase()
			const cursor = posInt(before, NO_CURSOR)
			const rows = posInt(limit, PAGE)
			const items = (q
				? s.pageQ.all(cursor, q, rows)
				: s.page.all(cursor, rows)) as unknown as HistoryItem[]
			const { n } = (q ? s.countQ.get(q) : s.count.get()) as { n: number }
			return { items, total: n }
		},
		{ items: [], total: 0 },
	)

export const remove = (id: number) => {
	guard<void>((s) => {
		s.remove.run(id)
	}, undefined)
}

export const clear = () => {
	guard<void>((s) => {
		s.clear.run()
	}, undefined)
}

// Close on quit so WAL is checkpointed into history.db.
app.on('will-quit', () => {
	_store?.db.close()
	_store = null
})
