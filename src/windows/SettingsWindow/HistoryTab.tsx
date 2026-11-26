import { useState } from 'react'
import { useCards, useHistory } from './HistoryData'
import {
	HistoryHead,
	HistoryHero,
	HistoryList,
	HistoryNote,
	HistorySearch,
} from './HistoryParts'

interface HistorySettings {
	historyEnabled?: boolean
}

interface Props {
	settings: HistorySettings
	onSave: (patch: HistorySettings) => void
}

// Recording history — a searchable log of past dictations so the user can look
// back up what was recorded. Data and paging: HistoryData.ts; the tab's blocks
// (hero, search, list, notes): HistoryParts.tsx.
export default function HistoryTab({ settings, onSave }: Props) {
	const [query, setQuery] = useState<string>('')
	const [confirmClear, setConfirmClear] = useState<boolean>(false)
	const { clear, items, overall, remove, sentinel, total } = useHistory(query)
	const cards = useCards()
	const enabled = settings.historyEnabled !== false
	const searching = query.trim() !== ''

	function toggleSave(): void {
		onSave({ historyEnabled: !enabled })
	}
	async function clearAll(): Promise<void> {
		await clear()
		setConfirmClear(false)
	}

	return (
		<>
			<HistoryHero enabled={enabled} onToggle={toggleSave} overall={overall} />
			<HistorySearch onChange={setQuery} query={query} />
			{items && items.length > 0 && (
				<>
					<HistoryHead
						confirming={confirmClear}
						onClear={clearAll}
						onConfirm={setConfirmClear}
						searching={searching}
						total={total}
					/>
					<HistoryList
						cards={cards}
						items={items}
						more={items.length < total}
						onDelete={remove}
						sentinel={sentinel}
					/>
				</>
			)}
			<HistoryNote
				empty={overall !== null && overall.last === undefined}
				enabled={enabled}
				noMatch={overall !== null && searching && items?.length === 0}
			/>
		</>
	)
}
