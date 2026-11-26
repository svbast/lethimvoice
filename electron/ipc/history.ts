import * as history from '../store/history'
import * as stats from '../store/stats'
import type { Handler } from '.'

export const handlers = {
	'clear-history': () => history.clear(),
	'delete-history-item': (_e, id: number) => history.remove(id),
	'get-history': (_e, opts?: history.ListOptions) => history.list(opts),
	'get-stats': () => stats.getStats(),
} satisfies Record<string, Handler>
