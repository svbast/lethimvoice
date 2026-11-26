import type { RefObject } from 'react'
import type { HistoryItem } from '../../../electron/store/history'
import Hero from '../../components/Hero'
import PixelIcon from '../../components/PixelIcon'
import { fmtWhen, useT } from '../../i18n'
import { type Cards, fmtDur, type Overall } from './HistoryData'

interface HeroProps {
	overall: Overall | null
	enabled: boolean
	onToggle: () => void
}

// The hero says how many dictations are saved and when the last one was, or that
// none are yet; blank for the one round trip before the first read, so no wrong
// text flashes.
export function HistoryHero({ enabled, onToggle, overall }: HeroProps) {
	const t = useT()
	const last = overall?.last
	let badge = ''
	let title = ''
	if (last) {
		badge = t('history.last', { when: fmtWhen(last.ts, true) })
		title = t('common.recordings', { n: overall?.n ?? 0 })
	} else if (overall) {
		badge = t('history.nothingSaved')
		title = t('history.empty')
	}
	return (
		<Hero
			anim='detective'
			badge={badge}
			desc={t(enabled ? 'history.localNote' : 'history.disabledNote')}
			plate={{
				kind: 'switch',
				label: t('history.save.label'),
				on: enabled,
				onToggle,
			}}
			title={title}
			tone={last && enabled ? 'plain' : 'muted'}
		/>
	)
}

export function HistorySearch({
	onChange,
	query,
}: {
	onChange: (query: string) => void
	query: string
}) {
	const t = useT()
	return (
		<div className='hstack gap-4'>
			<div className='input-wrap grow'>
				<PixelIcon className='pxi-ctl input-icon' name='search' />
				<input
					aria-label={t('history.search')}
					className='input'
					onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
						onChange(e.target.value)
					}
					placeholder={t('history.search')}
					type='search'
					value={query}
				/>
			</div>
		</div>
	)
}

interface HeadProps {
	confirming: boolean
	onClear: () => void
	onConfirm: (on: boolean) => void
	searching: boolean
	total: number
}

// "Recent" (the match count while searching) and Clear all, which asks once.
export function HistoryHead({
	confirming,
	onClear,
	onConfirm,
	searching,
	total,
}: HeadProps) {
	const t = useT()
	return (
		<div className='hstack between history-head'>
			<h2 className='section-title'>
				{searching ? t('common.recordings', { n: total }) : t('history.recent')}
			</h2>
			{confirming ? (
				<span className='hstack gap-2'>
					<button
						className='btn btn-destructive btn-sm'
						onClick={onClear}
						type='button'
					>
						<PixelIcon className='pxi-ctl' name='trash' />
						{t('history.confirmClear')}
					</button>
					<button
						className='btn btn-ghost btn-sm'
						onClick={() => onConfirm(false)}
						type='button'
					>
						{t('common.cancel')}
					</button>
				</span>
			) : (
				<button
					className='btn btn-ghost btn-sm'
					onClick={() => onConfirm(true)}
					type='button'
				>
					<PixelIcon className='pxi-ctl' name='trash' />
					{t('history.clearAll')}
				</button>
			)}
		</div>
	)
}

interface ListProps {
	cards: Cards
	items: HistoryItem[]
	/** More pages to load: shows the sentinel that loads the next one. */
	more: boolean
	onDelete: (id: number) => void
	sentinel: RefObject<HTMLDivElement | null>
}

export function HistoryList({
	cards,
	items,
	more,
	onDelete,
	sentinel,
}: ListProps) {
	return (
		<div className='stack gap-3'>
			{items.map((it) => (
				<HistoryCard
					copied={cards.copiedId === it.id}
					expanded={cards.expanded.has(it.id)}
					it={it}
					key={it.id}
					onCopy={() => cards.copy(it)}
					onDelete={() => onDelete(it.id)}
					onExpand={() => cards.toggleExpand(it.id)}
				/>
			))}
			{/* Only while there is more to load, so a full list ends without a stray gap. */}
			{more && <div ref={sentinel} />}
		</div>
	)
}

interface CardProps {
	copied: boolean
	expanded: boolean
	it: HistoryItem
	onCopy: () => void
	onDelete: () => void
	onExpand: () => void
}

// One dictation: its meta row, then the text, two lines until clicked.
function HistoryCard({
	copied,
	expanded,
	it,
	onCopy,
	onDelete,
	onExpand,
}: CardProps) {
	const t = useT()
	return (
		<article className='card stack gap-2 history-item'>
			<HistoryMeta
				copied={copied}
				it={it}
				onCopy={onCopy}
				onDelete={onDelete}
			/>
			<button
				aria-expanded={expanded}
				className={
					expanded ? 'text-sm history-text' : 'clamp-2 text-sm history-text'
				}
				onClick={onExpand}
				title={t('history.expand')}
				type='button'
			>
				{it.text}
			</button>
		</article>
	)
}

// When, how long, which engine, then copy and delete on the right.
function HistoryMeta({
	copied,
	it,
	onCopy,
	onDelete,
}: Omit<CardProps, 'expanded' | 'onExpand'>) {
	const t = useT()
	const local = it.backend === 'local'
	return (
		<div className='hstack gap-2 text-xs muted'>
			<span>{fmtWhen(it.ts)}</span>
			<span aria-hidden='true'>·</span>
			<span className='tabular'>{fmtDur(it.ms)}</span>
			<span className={local ? 'badge badge-outline' : 'badge badge-secondary'}>
				{t(local ? 'stats.local' : 'stats.cloud')}
			</span>
			<span className='hstack gap-1 history-actions'>
				<button
					aria-label={t('history.copy')}
					className='btn btn-ghost btn-icon btn-sm'
					onClick={onCopy}
					type='button'
				>
					<PixelIcon className='pxi-ctl' name={copied ? 'check' : 'copy'} />
				</button>
				<button
					aria-label={t('common.delete')}
					className='btn btn-ghost btn-icon btn-sm'
					onClick={onDelete}
					type='button'
				>
					<PixelIcon className='pxi-ctl' name='trash' />
				</button>
			</span>
		</div>
	)
}

// Under the search: nothing stored yet (said only while saving is on), or no match.
export function HistoryNote({
	empty,
	enabled,
	noMatch,
}: {
	empty: boolean
	enabled: boolean
	noMatch: boolean
}) {
	const t = useT()
	let text: string | null = null
	if (empty) text = enabled ? t('history.emptyDesc') : null
	else if (noMatch) text = t('history.noMatch')
	if (text === null) return null
	return (
		<div className='stack gap-1 history-empty'>
			<span className='muted history-empty-text'>{text}</span>
		</div>
	)
}
