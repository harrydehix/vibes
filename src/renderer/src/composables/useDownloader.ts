import { ref } from 'vue'
import type { UsdbSong, DownloadSongResult } from '@shared/types'
import { accessSongs } from './useSongs'

export type DownloadState = {
  song: UsdbSong
  progress: number
  status: 'downloading' | 'completed' | 'error'
}

// Globaler State für alle Downloads, damit Komponenten ihn teilen können
const downloads = ref<DownloadState[]>([])
let isListenerAttached = false
const ignoreSongsWithSameTitleAndArtist = true

export function useDownloader() {
  const { songs: downloadedSongs } = accessSongs()

  if (!isListenerAttached && window.api?.downloader) {
    window.api.downloader.onProgress((song, progress) => {
      const downloadState = downloads.value.find((d) => d.song.apiId === song.apiId)
      if (downloadState) {
        if (progress > downloadState.progress) {
          downloadState.progress = progress
        }
      } else {
        downloads.value.push({ song, progress, status: 'downloading' })
      }
    })
    isListenerAttached = true
  }

  async function search(params: { search: string }): Promise<UsdbSong[]> {
    let unfilteredResults: UsdbSong[]
    if (params.search.includes('-')) {
      const [interpret, title] = params.search.split('-').map((part) => part.trim())
      let response = await window.api.downloader.search({
        interpret,
        title,
        limit: 100,
        start: 0
      })
      if (response.songs.length === 0) {
        response = await window.api.downloader.search({
          interpret: title,
          title: interpret,
          limit: 100,
          start: 0
        })
      }

      unfilteredResults = response.songs
    } else {
      const byTitle = await window.api.downloader.search({
        title: params.search,
        limit: 50,
        start: 0
      })
      const byArtist = await window.api.downloader.search({
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

  async function download(song: UsdbSong): Promise<DownloadSongResult | null> {
    try {
      if (!downloads.value.find((d) => d.song.apiId === song.apiId)) {
        downloads.value.push({ song, progress: 0, status: 'downloading' })
      }
      const result = await window.api.downloader.download({ song, cookie: '' })
      const downloadState = downloads.value.find((d) => d.song.apiId === song.apiId)
      await new Promise((resolve) => setTimeout(resolve, 1500))
      if (downloadState) {
        downloadState.progress = 1
        downloadState.status = 'completed'
      }
      return result
    } catch (error) {
      console.error(`Download failed for song ${song.apiId}:`, error)
      const downloadState = downloads.value.find((d) => d.song.apiId === song.apiId)
      if (downloadState) {
        downloadState.status = 'error'
      }
      return null
    }
  }

  return {
    downloads,
    search,
    download
  }
}
