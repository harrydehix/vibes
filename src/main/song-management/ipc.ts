import { IPC_CHANNELS } from '../../shared/ipc'
import type { SongImportRequest, SongMetadataUpdate, SongSearchOptions } from '../../shared/types'
import { handleApi } from '../utils/ipcHandle'
import { deleteSong, downloadSong, getSongs, searchSongs, updateSong } from './index'

export async function defineSongIpc(): Promise<void> {
  const searches = new Map<number, AbortController>()
  await getSongs()
  handleApi(IPC_CHANNELS.SONGS.GET, () => getSongs(), 'library_unavailable')
  handleApi(IPC_CHANNELS.SONGS.DELETE, (_, id: string) => deleteSong(id))
  handleApi(IPC_CHANNELS.SONGS.UPDATE, (_, id: string, patch: SongMetadataUpdate) =>
    updateSong(id, patch)
  )
  handleApi(
    IPC_CHANNELS.SONGS.SEARCH,
    async (event, query: string, options: SongSearchOptions = {}) => {
      const sender = event.sender
      searches.get(sender.id)?.abort()
      searches.delete(sender.id)
      if (typeof query !== 'string' || !query.trim()) return searchSongs(query, options)
      const controller = new AbortController()
      searches.set(sender.id, controller)
      const onDestroyed = (): void => controller.abort()
      sender.once('destroyed', onDestroyed)
      try {
        return await searchSongs(query, options, controller.signal)
      } finally {
        sender.removeListener('destroyed', onDestroyed)
        if (searches.get(sender.id) === controller) searches.delete(sender.id)
      }
    }
  )
  handleApi(IPC_CHANNELS.SONGS.DOWNLOAD, (event, request: SongImportRequest) =>
    downloadSong(request, (candidate, progress) => {
      if (!event.sender.isDestroyed())
        event.sender.send(IPC_CHANNELS.SONGS.PROGRESS, candidate, progress)
    })
  )
}
