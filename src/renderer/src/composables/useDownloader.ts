import { ref } from 'vue'
import type { UsdbSong, SongImportResult, ImportCandidate, SongImportRequest } from '@shared/types'
import { DownloadError, getDownloadErrorCode, getDownloadErrorMessage } from '@shared/errors'
import { accessSongs } from './useSongs'
import { searchSources, type SourceSearchResult } from '../utils/searchSources'

export type DownloadState = {
  candidate: ImportCandidate
  progress: number
  status: 'downloading' | 'completed' | 'error'
  error?: string
}

// Globaler State für alle Downloads, damit Komponenten ihn teilen können
const downloads = ref<DownloadState[]>([])
let isListenerAttached = false
const ignoreSongsWithSameTitleAndArtist = true

export function useDownloader() {
  const { songs: downloadedSongs, refresh } = accessSongs()

  if (!isListenerAttached && window.api?.downloader) {
    window.api.downloader.onProgress((candidate, progress) => {
      const downloadState = downloads.value.find(
        (entry) =>
          entry.candidate.source === candidate.source && entry.candidate.id === candidate.id
      )
      if (downloadState) {
        if (progress > downloadState.progress) {
          downloadState.progress = progress
        }
      } else {
        downloads.value.push({ candidate, progress, status: 'downloading' })
      }
    })
    isListenerAttached = true
  }

  async function searchUsdb(params: { search: string }): Promise<UsdbSong[]> {
    let unfilteredResults: UsdbSong[]
    if (params.search.includes('-')) {
      const [interpret, title] = params.search.split('-').map((part) => part.trim())
      let response = await window.api.downloader.searchUsdb({
        interpret,
        title,
        limit: 100,
        start: 0
      })
      if (response.songs.length === 0) {
        response = await window.api.downloader.searchUsdb({
          interpret: title,
          title: interpret,
          limit: 100,
          start: 0
        })
      }

      unfilteredResults = response.songs
    } else {
      const byTitle = await window.api.downloader.searchUsdb({
        title: params.search,
        limit: 50,
        start: 0
      })
      const byArtist = await window.api.downloader.searchUsdb({
        interpret: params.search,
        limit: 50,
        start: 0
      })

      const all: UsdbSong[] = []
      while (byTitle.songs.length > 0 || byArtist.songs.length > 0) {
        if (byTitle.songs.length > 0) {
          all.push(byTitle.songs.shift()!)
        }
        if (byArtist.songs.length > 0) {
          all.push(byArtist.songs.shift()!)
        }
      }

      unfilteredResults = [...new Map(all.map((song) => [song.apiId, song])).values()]
    }
    const filteredResults = unfilteredResults.filter((song) => {
      const sanitizedTitle = song.title.replace(/\&amp;/g, '&')
      const sanitizedArtist = song.artist.replace(/\&amp;/g, '&')
      if (ignoreSongsWithSameTitleAndArtist) {
        return (
          !downloadedSongs.value.some(
            (other) => other.title === sanitizedTitle && other.artist === sanitizedArtist
          ) &&
          !song.title.toLowerCase().includes('[duet]') &&
          !song.artist.toLowerCase().includes('[duo]')
        )
      }
      return true
    })

    return filteredResults
  }

  async function importSong(request: SongImportRequest): Promise<SongImportResult | null> {
    const candidate = request.candidate
    let downloadState = downloads.value.find(
      (entry) => entry.candidate.source === candidate.source && entry.candidate.id === candidate.id
    )
    if (downloadState?.status === 'downloading') return null
    if (!downloadState) {
      downloads.value.push({ candidate, progress: 0, status: 'downloading' })
      downloadState = downloads.value[downloads.value.length - 1]
    } else {
      downloadState.candidate = candidate
      downloadState.progress = 0
      downloadState.status = 'downloading'
      downloadState.error = undefined
    }
    try {
      const response = await window.api.downloader.download(JSON.parse(JSON.stringify(request)))
      if (!response.ok) throw new DownloadError(response.error.code)
      const result = response.result
      downloadState.progress = 1
      downloadState.status = 'completed'
      try {
        await refresh()
      } catch (error) {
        console.warn('Song imported, but the library could not be refreshed:', error)
      }
      return result
    } catch (error) {
      console.error(`Import failed for ${candidate.source}:${candidate.id}:`, error)
      downloadState.status = 'error'
      downloadState.error = getDownloadErrorMessage(getDownloadErrorCode(error))
      return null
    }
  }

  async function downloadUsdbSong(song: UsdbSong): Promise<SongImportResult | null> {
    return await importSong({
      candidate: {
        source: 'usdb',
        id: String(song.apiId),
        title: song.title,
        artist: song.artist,
        song
      }
    })
  }

  async function inspectYoutube(
    url: string
  ): Promise<Extract<ImportCandidate, { source: 'youtube' }>> {
    return await window.api.downloader.inspectYoutube(url)
  }

  function cancelYoutubeSearch(): void {
    void window.api.downloader.searchYoutube('').catch(() => {})
  }

  async function searchAll(
    query: string,
    onResult?: (result: SourceSearchResult) => void
  ): Promise<SourceSearchResult> {
    return await searchSources(
      query,
      [
        {
          name: 'USDB',
          search: async (query) =>
            (await searchUsdb({ search: query })).map((song) => ({
              source: 'usdb' as const,
              id: String(song.apiId),
              title: song.title,
              artist: song.artist,
              song
            }))
        },
        {
          name: 'YouTube',
          search: async (query) =>
            (await window.api.downloader.searchYoutube(query)).filter(
              (candidate) =>
                !downloadedSongs.value.some(
                  (song) =>
                    song.source?.provider === candidate.source && song.source.id === candidate.id
                )
            )
        }
      ],
      onResult
    )
  }

  return {
    downloads,
    search: searchUsdb,
    download: downloadUsdbSong,
    importSong,
    inspectYoutube,
    cancelYoutubeSearch,
    searchAll
  }
}
