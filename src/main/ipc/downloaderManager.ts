import { ipcMain } from 'electron'
import { Cause, Runtime } from 'effect'
import { IPC_CHANNELS } from '../../shared/ipc'
import { getDownloadErrorCode, type SongDownloadResponse } from '../../shared/errors'
import { searchUsdb } from '../ultrastar-download/usdbDownloader'
import { basePathForDownload } from './settings'
import type { UsdbSearchParams, SongImportRequest } from '../../shared/types'
import { importSong } from '../song-import'
import { inspectYoutubeWithDefaultCaptions, searchYoutube } from '../song-import/youtube'

class DownloaderManager {
  private searchControllers = new Map<number, AbortController>()

  async defineIpcHandles(): Promise<void> {
    ipcMain.handle(IPC_CHANNELS.DOWNLOADER.SEARCH_USDB, async (_, params: UsdbSearchParams) => {
      return await searchUsdb(params)
    })

    ipcMain.handle(IPC_CHANNELS.DOWNLOADER.INSPECT_YOUTUBE, async (_, url: string) => {
      if (typeof url !== 'string') throw new Error('A YouTube URL is required')
      return await inspectYoutubeWithDefaultCaptions(url)
    })

    ipcMain.handle(IPC_CHANNELS.DOWNLOADER.SEARCH_YOUTUBE, async (event, query: string) => {
      if (typeof query !== 'string') throw new Error('A search query is required')
      const senderId = event.sender.id
      this.searchControllers.get(senderId)?.abort()
      if (!query.trim()) {
        this.searchControllers.delete(senderId)
        return []
      }
      const controller = new AbortController()
      this.searchControllers.set(senderId, controller)
      const onDestroyed = (): void => controller.abort()
      event.sender.once('destroyed', onDestroyed)
      try {
        return await searchYoutube(query, controller.signal)
      } finally {
        event.sender.removeListener('destroyed', onDestroyed)
        if (this.searchControllers.get(senderId) === controller) {
          this.searchControllers.delete(senderId)
        }
      }
    })

    ipcMain.handle(IPC_CHANNELS.DOWNLOADER.DOWNLOAD, async (event, request: SongImportRequest) => {
      try {
        const result = await importSong(request, basePathForDownload, (progress) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(IPC_CHANNELS.DOWNLOADER.PROGRESS, request.candidate, progress)
          }
        })
        return { ok: true, result } satisfies SongDownloadResponse
      } catch (error) {
        console.error('Song download failed:', error)
        const reason = Runtime.isFiberFailure(error)
          ? Cause.squash(error[Runtime.FiberFailureCauseId])
          : error
        return {
          ok: false,
          error: { code: getDownloadErrorCode(reason) }
        } satisfies SongDownloadResponse
      }
    })
  }
}

export const downloaderManager = new DownloaderManager()
