import { Children } from 'react'

// Splits a translated template like "F1–F12 … {ctrl} {alt} {shift}." into
// React children, replacing each {var} with the matching JSX node. A {var}
// without a slot stays literal. Children.toArray keys the parts by position:
// they never reorder.
export function renderTemplate(
	template: string,
	slots: Record<string, React.ReactNode>,
): React.ReactNode[] {
	return Children.toArray(
		String(template)
			.split(/(\{\w+\})/gu)
			.map((part) => {
				const name = part.match(/^\{(\w+)\}$/u)?.[1]
				return (name === undefined ? undefined : slots[name]) ?? part
			}),
	)
}
