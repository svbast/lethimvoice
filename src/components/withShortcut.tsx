import { renderTemplate } from './renderTemplate'

// Turns the {shortcut} placeholder into key caps showing the user's ACTUAL
// configured shortcut (not a hardcoded default), one cap per key.
export function withShortcut(text: string, keys: string[]): React.ReactNode {
	return renderTemplate(text, {
		shortcut: keys.map((k, i) => (
			<span key={k}>
				{i > 0 && ' '}
				<kbd className='kbd'>{k}</kbd>
			</span>
		)),
	})
}
