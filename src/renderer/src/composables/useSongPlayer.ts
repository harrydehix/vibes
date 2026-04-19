import { ref, computed, watch, onUnmounted, provide, inject } from 'vue'
import { accessSongs } from './useSongs'
import { accessLocalFile } from '@renderer/utils/accessLocalFile'
import { accessSettings } from './useSettings'

export function useSongPlayer() {
  const songsApi = accessSongs()
  const { settings } = accessSettings()
  const video = ref<HTMLVideoElement | null>(null)
  const audio = ref<HTMLAudioElement>(new Audio()) // Fallback für reine Audio-Songs
  const isUsingAudio = ref(false)
  const isUsingVideo = ref(false)
  const isLoaded = ref(false)

  // State
  const currentIndex = ref(0)
  const isPlaying = ref(false)
  const duration = ref(0)
  const isLoading = ref(true)
  const ended = ref(false)

  let syncRequestId: number | null = null
  let playTimeoutId: ReturnType<typeof setTimeout> | null = null

  // Computed Properties
  const currentSong = computed(() => songsApi.songs.value[currentIndex.value])
  const currentTime = computed(() => {
    if (isUsingAudio.value) {
      return audio.value.currentTime
    } else if (isUsingVideo.value) {
      return video.value?.currentTime ?? 0
    }
    return 0
  })
  const pausedByUser = computed(() => {
    return !isPlaying.value && isLoaded.value === true
  })

  // Event Listeners aufbauen, wenn das Video-Element verfügbar wird
  watch(
    video,
    (vElement) => {
      if (!vElement) return

      vElement.addEventListener('canplay', () => {
        console.log('Video can play:', currentSong.value?.title)
      })
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
    if (playTimeoutId !== null) {
      clearTimeout(playTimeoutId)
      playTimeoutId = null
    }
    if (syncRequestId !== null) {
      cancelAnimationFrame(syncRequestId)
      syncRequestId = null
    }
    if (video.value) {
      video.value.pause()
      video.value.removeAttribute('src')
      video.value.load()
    }
  })

  const loadSong = async (index: number): Promise<void> => {
    isLoaded.value = false
    ended.value = false
    if (playTimeoutId !== null) {
      clearTimeout(playTimeoutId)
      playTimeoutId = null
    }
    if (syncRequestId !== null) {
      cancelAnimationFrame(syncRequestId)
      syncRequestId = null
    }
    const song = songsApi.songs.value[index]
    if (!song) return Promise.resolve()

    console.log(
      `Loading song (at ${song.videoStartSeconds ? song.videoStartSeconds : 0}): ${song.title}`
    )
    isLoading.value = true
    currentIndex.value = index

    if (!video.value) {
      throw new Error('Video element not set. Cannot load song.')
    }

    video.value.src = song.video ? accessLocalFile(song.video) : ''
    audio.value.src = song.audio ? accessLocalFile(song.audio) : ''
    isUsingAudio.value = song.usesAudio
    isUsingVideo.value = song.usesVideo

    video.value.muted = song.usesAudio

    const loadPromises = [
      new Promise<void>((resolve) => {
        if (!video.value || !song.usesVideo) {
          resolve()
          return
        }

        video.value.onended = () => {
          ended.value = true
        }

        const onLoadedMetadata = () => {
          if (video.value) {
            video.value.currentTime = song.videoStartSeconds ?? 0
          }
        }
        video.value.addEventListener('loadedmetadata', onLoadedMetadata)

        const onCanPlay = () => {
          video.value?.removeEventListener('canplay', onCanPlay)
          video.value?.removeEventListener('loadedmetadata', onLoadedMetadata)
          resolve()
        }

        if (video.value.readyState >= 3) {
          video.value.removeEventListener('loadedmetadata', onLoadedMetadata)
          video.value.currentTime = song.videoStartSeconds ?? 0
          resolve()
        } else {
          video.value.addEventListener('canplay', onCanPlay)
        }
      }),
      new Promise<void>((resolve) => {
        if (!song.usesAudio) {
          resolve()
          return
        }

        audio.value.onended = () => {
          ended.value = true
        }

        const onCanPlayAudio = () => {
          audio.value.removeEventListener('canplay', onCanPlayAudio)
          resolve()
        }

        if (audio.value.readyState >= 3) {
          resolve()
        } else {
          audio.value.addEventListener('canplay', onCanPlayAudio)
        }
      })
    ]

    if (song.usesVideo) video.value.load()
    if (song.usesAudio) audio.value.load()

    await Promise.all(loadPromises).then(() => {
      isLoading.value = false
      isLoaded.value = true
    })

    duration.value = song.usesVideo
      ? (video.value?.duration ?? 0)
      : song.usesAudio
        ? audio.value.duration
        : 0
  }

  const play = async () => {
    if (isUsingAudio.value && isUsingVideo.value) {
      if (syncRequestId !== null) {
        cancelAnimationFrame(syncRequestId)
      }

      const sync = () => {
        if (!video.value || !audio.value) return
        const videoTime = video.value.currentTime
        const audioTime = audio.value.currentTime
        const gap = (currentSong.value?.videoGapSeconds ?? 0) || 0
        const desiredVideoTime = Math.max(0.01, audioTime - gap)
        const timeDiff = desiredVideoTime - videoTime

        if (Math.abs(timeDiff) > 0.15) {
          console.log(`Syncing video. Time diff: ${timeDiff.toFixed(3)}s`)
          video.value.currentTime = desiredVideoTime
        }
        syncRequestId = requestAnimationFrame(sync)
      }
      syncRequestId = requestAnimationFrame(sync)
      audio.value.play()
      video.value?.play()
    } else if (isUsingVideo.value) {
      video.value?.play()
    } else if (isUsingAudio.value) {
      audio.value.play()
    }
    isPlaying.value = true
  }

  const pause = () => {
    if (playTimeoutId !== null) {
      clearTimeout(playTimeoutId)
      playTimeoutId = null
    }
    if (syncRequestId !== null) {
      cancelAnimationFrame(syncRequestId)
      syncRequestId = null
    }
    if (isUsingAudio.value) {
      audio.value.pause()
    }
    if (isUsingVideo.value) {
      video.value?.pause()
    }
    isPlaying.value = false
  }

  const seek = (timeInSeconds: number, fromSpecifiedStart = false): Promise<void> => {
    return new Promise<void>((resolve) => {
      console.log(`Seeking to ${timeInSeconds} seconds`)
      ended.value = false

      if (isUsingAudio.value) {
        const startOffset = fromSpecifiedStart ? (currentSong.value?.audioStartSeconds ?? 0) : 0
        const onAudioSeeked = () => {
          audio.value.removeEventListener('seeked', onAudioSeeked)
          console.log('Audio seeked!')
          resolve()
        }
        audio.value.addEventListener('seeked', onAudioSeeked)
        audio.value.currentTime = timeInSeconds + startOffset
      } else if (isUsingVideo.value) {
        const startOffset = fromSpecifiedStart ? (currentSong.value?.videoStartSeconds ?? 0) : 0
        if (!video.value) {
          resolve()
          return
        }
        const onSeeked = () => {
          video.value?.removeEventListener('seeked', onSeeked)
          console.log('Seeked!')
          resolve()
        }
        video.value.addEventListener('seeked', onSeeked)
        video.value.currentTime = timeInSeconds + startOffset
      }
    })
  }

  watch(currentIndex, async (newIndex) => {
    const wasPlaying = isPlaying.value
    await loadSong(newIndex)
    if (wasPlaying) {
      play()
    }
  })

  const songPlayerApi = {
    // State
    video,
    isUsingAudio,
    isUsingVideo,
    currentSong,
    currentIndex,
    isPlaying,
    isLoading,
    currentTime,
    duration,
    ended,
    getCurrentTime: () => {
      if (isUsingAudio.value) {
        return audio.value.currentTime
      } else if (isUsingVideo.value) {
        return video.value?.currentTime ?? 0
      }
      return 0
    },
    pausedByUser,
    isLoaded,
    // Actions
    play,
    pause,
    seek
  }

  /* make it globally accessible via */
  provide('songPlayer', songPlayerApi)
  return songPlayerApi
}

type SongPlayer = ReturnType<typeof useSongPlayer>

export function accessSongPlayer() {
  const songPlayer = inject<SongPlayer>('songPlayer')
  if (!songPlayer) {
    throw new Error('No song player provided')
  }
  return songPlayer
}
