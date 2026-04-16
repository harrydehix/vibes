import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc'
import { search, download, init as initDownloader } from '../ultrastar-download/downloader'
import { basePathForDownload } from './settings'
import type { UsdbSearchParams, DownloadSongParams } from '../../shared/types'

class DownloaderManager {
  async defineIpcHandles() {
    await initDownloader()

    ipcMain.handle(IPC_CHANNELS.DOWNLOADER.SEARCH, async (_, params: UsdbSearchParams) => {
      return await search(params as any)
    })

    ipcMain.handle(IPC_CHANNELS.DOWNLOADER.DOWNLOAD, async (event, params: DownloadSongParams) => {
      const downloadParams = {
        ...params,
        baseDir: params.baseDir || basePathForDownload,
        onProgress: (progress: number) => {
          event.sender.send(IPC_CHANNELS.DOWNLOADER.PROGRESS, params.song, progress)
        }
      }
      return await download(downloadParams as any)
    })
  }
}

export const downloaderManager = new DownloaderManager()
