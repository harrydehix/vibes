import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc'
import { handleApi } from '../utils/ipcHandle'
import { youtubeAuthEvents, youtubeAuthManager } from './index'

export function defineYoutubeAuthIpc(): void {
  youtubeAuthEvents.on('changed', (status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.YOUTUBE_AUTH.CHANGED, status)
    }
  })
  handleApi(
    IPC_CHANNELS.YOUTUBE_AUTH.STATUS,
    () => youtubeAuthManager.getStatus(),
    'authentication_failed'
  )
  handleApi(
    IPC_CHANNELS.YOUTUBE_AUTH.IMPORT_COOKIES,
    () => youtubeAuthManager.importCookies(),
    'authentication_failed'
  )
  handleApi(
    IPC_CHANNELS.YOUTUBE_AUTH.SIGN_OUT,
    () => youtubeAuthManager.signOut(),
    'authentication_failed'
  )
  handleApi(
    IPC_CHANNELS.YOUTUBE_AUTH.OPEN_BROWSER,
    () => youtubeAuthManager.openBrowser(),
    'authentication_failed'
  )
  handleApi(
    IPC_CHANNELS.YOUTUBE_AUTH.OPEN_HELP,
    () => youtubeAuthManager.openHelp(),
    'authentication_failed'
  )
}
