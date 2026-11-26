import {
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react'
import type { HistoryItem } from '../../../electron/store/history'

const PAGE = 50

/** The whole store, whatever the search: its size and newest entry. */
export interface Overall {
	n: number
	last?: HistoryItem
}

type Items = HistoryItem[] | null

/** What every list effect reads and writes. */
interface Page {
	loadedQuery: RefObject<string>
	query: string
	setItems: Dispatch<SetStateAction<Items>>
	setTotal: Dispatch<SetStateAction<number>>
}

// Search and paging run in the main process (electron/store/history.ts,
// local-only); this holds the page the tab has and follows new dictations live
// via the 'history-added' event.
export function useHistory(query: string) {
	// null = not read yet, as opposed to [] = read and genuinely empty. The tab is
	// remounted on every switch (key={section} in SettingsWindow), so starting at []
	// would paint the empty state for the length of the IPC round trip before the
	// list arrived.
	const [items, setItems] = useState<Items>(null)
	const [total, setTotal] = useState<number>(0)
	const sentinel = useRef<HTMLDivElement>(null)
	const loadedQuery = useRef<string>('')
	const { overall, refreshOverall, setOverall } = useOverall()
	const page: Page = { loadedQuery, query, setItems, setTotal }
	useFirstPage(page)
	useNextPage(page, { items, sentinel, total })
	useHistoryAdded(page, refreshOverall)

	async function remove(id: number): Promise<void> {
		await window.electron.deleteHistoryItem(id)
		setItems((prev) => (prev ?? []).filter((x) => x.id !== id))
		setTotal((n) => n - 1)
		refreshOverall()
	}
	async function clear(): Promise<void> {
		await window.electron.clearHistory()
		setItems([])
		setTotal(0)
		setOverall({ n: 0 })
	}
	return { clear, items, overall, remove, sentinel, total }
}

// The hero counts the whole store, not the search result. Re-read its newest row
// after every change instead of counting by hand: the store trims itself at its
// cap, which a hand count would miss.
function useOverall() {
	const [overall, setOverall] = useState<Overall | null>(null)
	const refreshOverall = useCallback((): void => {
		window.electron
			.getHistory({ limit: 1 })
			.then((r) => setOverall({ last: r.items[0], n: r.total }))
			.catch(() => setOverall({ n: 0 }))
	}, [])
	useEffect(refreshOverall, [refreshOverall])
	return { overall, refreshOverall, setOverall }
}

// First page for the current query; a reply for a superseded query is dropped.
// On failure settle on [] — the empty state is a better answer than a tab that
// stays blank forever waiting for a read that already gave up.
function useFirstPage({ loadedQuery, query, setItems, setTotal }: Page): void {
	useEffect(() => {
		let stale = false
		const settle = (items: HistoryItem[], total: number): void => {
			if (stale) return
			loadedQuery.current = query
			setItems(items)
			setTotal(total)
		}
		window.electron
			.getHistory({ limit: PAGE, query })
			.then((r) => settle(r.items, r.total))
			.catch(() => settle([], 0))
		return () => {
			stale = true
		}
	}, [loadedQuery, query, setItems, setTotal])
}

// Next page once the sentinel below the list scrolls into view.
function useNextPage(
	{ loadedQuery, query, setItems, setTotal }: Page,
	{
		items,
		sentinel,
		total,
	}: {
		items: Items
		sentinel: RefObject<HTMLDivElement | null>
		total: number
	},
): void {
	useEffect(() => {
		const el = sentinel.current
		const last = items?.at(-1)
		if (!(el && items && last) || items.length >= total) return
		if (loadedQuery.current !== query) return
		let stale = false
		const io = new IntersectionObserver(([entry]) => {
			if (!entry?.isIntersecting) return
			io.disconnect()
			window.electron
				.getHistory({ before: last.id, limit: PAGE, query })
				.then((r) => {
					if (stale) return
					setItems((prev) => [...(prev ?? []), ...r.items])
					setTotal(r.total)
				})
				.catch(() => undefined)
		})
		io.observe(el)
		return () => {
			stale = true
			io.disconnect()
		}
	}, [items, loadedQuery, query, sentinel, setItems, setTotal, total])
}

// New dictation finished elsewhere (pill) → prepend it without a refetch when it
// would be part of the current result set.
function useHistoryAdded(
	{ query, setItems, setTotal }: Page,
	refreshOverall: () => void,
): void {
	useEffect(() => {
		const q = query.trim().toLowerCase()
		const off = window.electron.on('history-added', (historyItem) => {
			refreshOverall()
			if (!historyItem.text.toLowerCase().includes(q)) return
			setItems((prev) => [historyItem, ...(prev || [])])
			setTotal((n) => n + 1)
		})
		return () => off()
	}, [query, refreshOverall, setItems, setTotal])
}

/** Which cards show their full text, and which one was just copied. */
export function useCards() {
	const [expanded, setExpanded] = useState<Set<number>>(() => new Set()) // ids shown in full
	const [copiedId, setCopiedId] = useState<number | null>(null)

	async function copy(it: HistoryItem): Promise<void> {
		try {
			await navigator.clipboard.writeText(it.text)
		} catch {
			return
		}
		setCopiedId(it.id)
		setTimeout(() => setCopiedId((c) => (c === it.id ? null : c)), 1500)
	}
	function toggleExpand(id: number): void {
		setExpanded((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}
	return { copiedId, copy, expanded, toggleExpand }
}

export type Cards = ReturnType<typeof useCards>

/** A dictation's length, or a sum of them: "42s", "3m 5s", "2h 14m". */
export function fmtDur(ms: number): string {
	const s = Math.round((ms || 0) / 1000)
	if (s < 60) return `${s}s`
	const m = Math.floor(s / 60)
	if (m < 60) return `${m}m ${s % 60}s`
	return `${Math.floor(m / 60)}h ${m % 60}m`
}
