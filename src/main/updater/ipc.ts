import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc'
import { handleApi } from '../utils/ipcHandle'
import { checkForUpdates, initializeUpdater, installUpdate, updaterEvents } from './index'

export function defineUpdaterIpc(): void {
  const broadcast = (channel: string, payload: unknown): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(channel, payload)
    }
  }
  updaterEvents.on('available', (info) => broadcast(IPC_CHANNELS.APP_UPDATE.AVAILABLE, info))
  updaterEvents.on('progress', (progress) => broadcast(IPC_CHANNELS.APP_UPDATE.PROGRESS, progress))
  updaterEvents.on('downloaded', (info) => broadcast(IPC_CHANNELS.APP_UPDATE.DOWNLOADED, info))
  updaterEvents.on('failed', (error) => broadcast(IPC_CHANNELS.APP_UPDATE.ERROR, error))
  initializeUpdater()
  handleApi(IPC_CHANNELS.APP_UPDATE.CHECK, () => checkForUpdates(), 'update_failed')
  handleApi(IPC_CHANNELS.APP_UPDATE.INSTALL, () => installUpdate(), 'update_failed')
}
