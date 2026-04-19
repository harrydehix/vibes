import { ref, computed, watch, onUnmounted, provide, inject } from 'vue'
import { accessSongs } from './useSongs'
import { accessLocalFile } from '@renderer/utils/accessLocalFile'
import { accessSettings } from './useSettings'

export function useVideoPlayer() {
  const songsApi = accessSongs()
  const { settings } = accessSettings()
  const video = ref<HTMLVideoElement | null>(null)

  // State
  const currentIndex = ref(0)
  const isPlaying = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const isLoading = ref(true)
  const pausedByUser = ref(false)

  // Computed Properties
  const currentSong = computed(() => songsApi.songs.value[currentIndex.value])

  // Event Listeners aufbauen, wenn das Video-Element verfügbar wird
  watch(
    video,
    (vElement) => {
      if (!vElement) return

      vElement.addEventListener('timeupdate', () => {
        currentTime.value = vElement.currentTime ?? 0
      })

      vElement.addEventListener('loadedmetadata', () => {
        duration.value = vElement.duration ?? 0
      })

      vElement.addEventListener('canplay', () => {
        console.log('Video can play:', currentSong.value?.title)
        isLoading.value = false
      })

      vElement.addEventListener('play', () => (isPlaying.value = true))
      vElement.addEventListener('playing', () => (isPlaying.value = true))
      vElement.addEventListener('pause', () => (isPlaying.value = false))
    },
    { immediate: true }
  )

  watch(
    () => settings.value?.musicVolume,
    (newVolume) => {
      if (video.value) {
        video.value.volume = newVolume ?? 1
      }
    },
    { immediate: true }
  )

  watch([songsApi.songs, video], ([newSongs, newVideo]) => {
    if (newVideo && newSongs.length > 0) {
      loadSong(currentIndex.value)
    }
  })

  onUnmounted(() => {
    if (video.value) {
      video.value.pause()
      video.value.removeAttribute('src')
      video.value.load()
    }
  })

  const loadSong = (index: number): Promise<void> => {
    const song = songsApi.songs.value[index]
    if (!song) return Promise.resolve()

    console.log(`Loading song (at ${song.start ? song.start : 0}): ${song.title}`)
    isLoading.value = true
    currentIndex.value = index

    if (!video.value) {
      throw new Error('Video element not set. Cannot load song.')
    }
    video.value.src = accessLocalFile(song.video || song.audio)
    video.value.currentTime = song.start ? song.start : 0

    const promise = new Promise<void>((resolve) => {
      const onCanPlay = () => {
        video.value?.removeEventListener('canplay', onCanPlay)
        resolve()
      }
      video.value?.addEventListener('canplay', onCanPlay)
      if (!video.value) resolve()
    })
    video.value.load()
    return promise
  }

  const play = () => {
    video.value?.play()
    pausedByUser.value = false
  }
  const pause = () => {
    video.value?.pause()
    pausedByUser.value = true
  }

  const seek = (timeInSeconds: number): Promise<void> => {
    return new Promise<void>((resolve) => {
      if (!video.value) {
        resolve()
        return
      }

      console.log(`Seeking to ${timeInSeconds} seconds`)
      const onSeeked = () => {
        video.value?.removeEventListener('seeked', onSeeked)
        console.log('Seeked!')
        resolve()
      }
      video.value.addEventListener('seeked', onSeeked)
      video.value.currentTime = timeInSeconds
    })
  }

  watch(currentIndex, async (newIndex) => {
    const wasPlaying = isPlaying.value
    await loadSong(newIndex)
    if (wasPlaying) {
      play()
    }
  })

  const videoPlayerApi = {
    // State
    video,
    currentSong,
    currentIndex,
    isPlaying,
    isLoading,
    currentTime,
    duration,
    pausedByUser,
    // Actions
    play,
    pause,
    seek
  }

  /* make it globally accessible via */
  provide('videoPlayer', videoPlayerApi)
  return videoPlayerApi
}

type VideoPlayer = ReturnType<typeof useVideoPlayer>

export function accessVideoPlayer() {
  const videoPlayer = inject<VideoPlayer>('videoPlayer')
  if (!videoPlayer) {
    throw new Error('No video player provided')
  }
  return videoPlayer
}
