import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC_CHANNELS } from '../shared/ipc'
import type { AppAPI } from '../shared/api'
import type { ApiResult } from '../shared/errors'

export type { AppAPI } from '../shared/api'

function invoke<Value>(channel: string, ...args: unknown[]): Promise<ApiResult<Value>> {
  return ipcRenderer.invoke(channel, ...args)
}

function subscribe<Args extends unknown[]>(
  channel: string,
  callback: (...args: Args) => void
): () => void {
  const listener = (_event: IpcRendererEvent, ...args: Args): void => callback(...args)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: AppAPI = {
  settings: {
    get: () => invoke(IPC_CHANNELS.SETTINGS.GET),
    update: (patch) => invoke(IPC_CHANNELS.SETTINGS.UPDATE, patch),
    refresh: () => invoke(IPC_CHANNELS.SETTINGS.REFRESH)
  },
  songs: {
    getSongs: () => invoke(IPC_CHANNELS.SONGS.GET),
    searchSongs: (query, options) => invoke(IPC_CHANNELS.SONGS.SEARCH, query, options),
    downloadSong: (request) => invoke(IPC_CHANNELS.SONGS.DOWNLOAD, request),
    deleteSong: (id) => invoke(IPC_CHANNELS.SONGS.DELETE, id),
    updateSong: (id, patch) => invoke(IPC_CHANNELS.SONGS.UPDATE, id, patch),
    onDownloadProgress: (callback) => subscribe(IPC_CHANNELS.SONGS.PROGRESS, callback)
  },
  dialog: { openFolder: () => invoke(IPC_CHANNELS.DIALOG.OPEN_FOLDER) },
  youtubeAuth: {
    status: () => invoke(IPC_CHANNELS.YOUTUBE_AUTH.STATUS),
    openBrowser: () => invoke(IPC_CHANNELS.YOUTUBE_AUTH.OPEN_BROWSER),
    openHelp: () => invoke(IPC_CHANNELS.YOUTUBE_AUTH.OPEN_HELP),
    importCookies: () => invoke(IPC_CHANNELS.YOUTUBE_AUTH.IMPORT_COOKIES),
    signOut: () => invoke(IPC_CHANNELS.YOUTUBE_AUTH.SIGN_OUT),
    onChanged: (callback) => subscribe(IPC_CHANNELS.YOUTUBE_AUTH.CHANGED, callback)
  },
  updater: {
    check: () => invoke(IPC_CHANNELS.APP_UPDATE.CHECK),
    install: () => invoke(IPC_CHANNELS.APP_UPDATE.INSTALL),
    onAvailable: (callback) => subscribe(IPC_CHANNELS.APP_UPDATE.AVAILABLE, callback),
    onProgress: (callback) => subscribe(IPC_CHANNELS.APP_UPDATE.PROGRESS, callback),
    onDownloaded: (callback) => subscribe(IPC_CHANNELS.APP_UPDATE.DOWNLOADED, callback),
    onError: (callback) => subscribe(IPC_CHANNELS.APP_UPDATE.ERROR, callback)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('api', api)
} else {
  Object.assign(window, { electron: electronAPI, api })
}
