import { Song } from '@shared/types'
import { inject, onMounted, provide, ref } from 'vue'

export function useSongs() {
  const songs = ref<Song[]>([])

  onMounted(async () => {
    songs.value = await window.api.songs.get()
  })

  const refresh = async () => {
    songs.value = await window.api.songs.refresh()
  }

  const songApi = {
    songs,
    refresh
  }

  provide('songs', songApi)

  return songApi
}

export function accessSongs(): ReturnType<typeof useSongs> {
  return inject('songs') as ReturnType<typeof useSongs>
}
