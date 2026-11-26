import type { IconName } from '../../components/PixelIcon'
import type { Key } from '../../i18n'

export type Section =
	| 'main'
	| 'settings'
	| 'online'
	| 'local'
	| 'prompts'
	| 'stats'
	| 'history'
	| 'info'

/** Each section's icon, menu label and the one-line description under its title. */
export const SECTIONS: {
	id: Section
	icon: IconName
	label: Key
	desc: Key
}[] = [
	{ desc: 'navDesc.home', icon: 'home', id: 'main', label: 'nav.home' },
	{
		desc: 'navDesc.settings',
		icon: 'settings',
		id: 'settings',
		label: 'common.settings',
	},
	{ desc: 'navDesc.online', icon: 'online', id: 'online', label: 'nav.online' },
	{ desc: 'navDesc.local', icon: 'local', id: 'local', label: 'nav.local' },
	{
		desc: 'navDesc.prompts',
		icon: 'prompts',
		id: 'prompts',
		label: 'nav.prompts',
	},
	{ desc: 'navDesc.stats', icon: 'stats', id: 'stats', label: 'nav.stats' },
	{
		desc: 'navDesc.history',
		icon: 'history',
		id: 'history',
		label: 'nav.history',
	},
	{ desc: 'navDesc.about', icon: 'about', id: 'info', label: 'nav.about' },
]
