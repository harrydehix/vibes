import { Song, SongDeleteResponse } from '@shared/types'
import { inject, onMounted, provide, ref } from 'vue'

export function useSongs() {
  const songs = ref<Song[]>([])

  onMounted(async () => {
    songs.value = await window.api.songs.get()
  })

  const refresh = async () => {
    songs.value = await window.api.songs.refresh()
  }

  const deleteSong = async (song: Song): Promise<SongDeleteResponse> => {
    const result = await window.api.songs.deleteSong(song.meta.id)
    if (result.ok) songs.value = result.songs
    return result
  }

  const songPlayed = async (song: Song) => {
    await window.api.songs.songPlayed(song.meta.id)
    song.meta.playCount++
  }

  const songApi = {
    songs,
    refresh,
    deleteSong,
    songPlayed
  }

  provide('songs', songApi)

  return songApi
}

export function accessSongs(): ReturnType<typeof useSongs> {
  return inject('songs') as ReturnType<typeof useSongs>
}
