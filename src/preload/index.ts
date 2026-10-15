import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { ipcRenderer } from 'electron/renderer'
import {
  AppSettings,
  Song,
  SongDeleteResponse,
  UsdbSearchParams,
  UsdbSearchPage,
  SongImportRequest,
  ImportCandidate,
  YoutubeAuthStatus
} from '../shared/types'
import { IPC_CHANNELS } from '../shared/ipc'
import type { SongDownloadResponse } from '../shared/errors'
import type { ProgressInfo, UpdateInfo } from 'electron-updater'

// Custom APIs for renderer
const api = {
  settings: {
    get: async (): Promise<AppSettings> => {
      return await ipcRenderer.invoke(IPC_CHANNELS.SETTINGS.GET)
    },
    update: async (newSettings: Partial<AppSettings>): Promise<AppSettings> => {
      return await ipcRenderer.invoke(IPC_CHANNELS.SETTINGS.UPDATE, newSettings)
    },
    refresh: async (): Promise<AppSettings> => {
      return await ipcRenderer.invoke(IPC_CHANNELS.SETTINGS.REFRESH)
    }
  },
  songs: {
    get: async (): Promise<Song[]> => {
      return await ipcRenderer.invoke(IPC_CHANNELS.SONGS.GET)
    },
    refresh: async (): Promise<Song[]> => {
      return await ipcRenderer.invoke(IPC_CHANNELS.SONGS.REFRESH)
    },
    deleteSong: async (id: string): Promise<SongDeleteResponse> => {
      return await ipcRenderer.invoke(IPC_CHANNELS.SONGS.DELETE, id)
    },
    fixOffset: async (song: Song, songOffsetMs: number): Promise<Song> => {
      return await ipcRenderer.invoke(IPC_CHANNELS.SONGS.FIX_OFFSET, song, songOffsetMs)
    },
    songPlayed: async (id: string): Promise<void> => {
      return await ipcRenderer.invoke(IPC_CHANNELS.SONGS.SONG_PLAYED, id)
    }
  },
  dialog: {
    openFolder: async (): Promise<string | null> => {
      return await ipcRenderer.invoke(IPC_CHANNELS.DIALOG.OPEN_FOLDER)
    }
  },
  youtubeAuth: {
    status: async (): Promise<YoutubeAuthStatus> => {
      return await ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_AUTH.STATUS)
    },
    openBrowser: async (): Promise<void> => {
      await ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_AUTH.OPEN_BROWSER)
    },
    openHelp: async (): Promise<void> => {
      await ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_AUTH.OPEN_HELP)
    },
    importCookies: async (): Promise<YoutubeAuthStatus> => {
      return await ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_AUTH.IMPORT_COOKIES)
    },
    signOut: async (): Promise<YoutubeAuthStatus> => {
      return await ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_AUTH.SIGN_OUT)
    },
    onChanged: (callback: (status: YoutubeAuthStatus) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: YoutubeAuthStatus) =>
        callback(status)
      ipcRenderer.on(IPC_CHANNELS.YOUTUBE_AUTH.CHANGED, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.YOUTUBE_AUTH.CHANGED, listener)
    }
  },
  downloader: {
    searchUsdb: async (params: UsdbSearchParams): Promise<UsdbSearchPage> => {
      console.log('Invoking downloader search with params:', params)
      return await ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADER.SEARCH_USDB, params)
    },
    inspectYoutube: async (
      url: string
    ): Promise<Extract<ImportCandidate, { source: 'youtube' }>> => {
      return await ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADER.INSPECT_YOUTUBE, url)
    },
    searchYoutube: async (query: string): Promise<ImportCandidate[]> => {
      return await ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADER.SEARCH_YOUTUBE, query)
    },
    download: async (params: SongImportRequest): Promise<SongDownloadResponse> => {
      return await ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADER.DOWNLOAD, params)
    },
    onProgress: (
      callback: (candidate: ImportCandidate, progress: number) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        candidate: ImportCandidate,
        progress: number
      ) => {
        callback(candidate, progress)
      }
      ipcRenderer.on(IPC_CHANNELS.DOWNLOADER.PROGRESS, listener)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.DOWNLOADER.PROGRESS, listener)
      }
    }
  },
  updater: {
    install: async (): Promise<void> => {
      return await ipcRenderer.invoke(IPC_CHANNELS.APP_UPDATE.INSTALL)
    },
    onProgress: (callback: (progress: ProgressInfo) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: ProgressInfo) => {
        callback(progress)
      }
      ipcRenderer.on(IPC_CHANNELS.APP_UPDATE.PROGRESS, listener)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.APP_UPDATE.PROGRESS, listener)
      }
    },
    onDownloaded: (callback: (update: UpdateInfo) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, update: UpdateInfo) => {
        callback(update)
      }
      ipcRenderer.on(IPC_CHANNELS.APP_UPDATE.DOWNLOADED, listener)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.APP_UPDATE.DOWNLOADED, listener)
      }
    }
  }
}

export type AppAPI = typeof api

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
