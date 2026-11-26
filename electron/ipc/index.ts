import { type IpcMainInvokeEvent, ipcMain } from 'electron'
import * as dictation from './dictation'
import * as history from './history'
import * as local from './local'
import * as settings from './settings'
import * as system from './system'

export type Handler = (e: IpcMainInvokeEvent, ...args: never[]) => unknown

/** Channel → handler; preload derives typed `Api` from this map. */
const handlers = {
	...dictation.handlers,
	...history.handlers,
	...local.handlers,
	...settings.handlers,
	...system.handlers,
}
export type Handlers = typeof handlers

export const registerIpc = () => {
	for (const [channel, handler] of Object.entries(handlers))
		ipcMain.handle(channel, handler)
}
