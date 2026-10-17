import { ref, computed, watch, onUnmounted, provide, inject } from 'vue'
import { accessSongManagement } from './useSongManagement'
import { accessLocalFile } from '@renderer/utils/accessLocalFile'
import gsap from 'gsap'
import { accessSettings } from './useSettings'

export function usePreviewPlayer(
  startIndex: number = 0,
  previewDefaultDurationSeconds: number = 20
) {
  const songsApi = accessSongManagement()
  const { settings } = accessSettings()
  const video = ref<HTMLVideoElement | null>(null)
  const audio = ref<HTMLAudioElement>(new Audio())
  const isUsingAudio = ref(false)
  const isUsingVideo = ref(false)

  // State
  const currentIndex = ref(startIndex)
  const isPlaying = ref(false)
  const duration = ref(0)
  const isLoading = ref(true)

  let fadeTween: gsap.core.Tween | null = null
  let isFading = false
  let syncRequestId: number | null = null
  let loadVersion = 0

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

  watch(
    () => settings.value?.musicVolume,
    (newVolume) => {
      if (!isFading) {
        const vol = newVolume ?? 1
        if (isUsingAudio.value) {
          audio.value.volume = vol
          if (video.value) video.value.volume = 0 // Muted if audio is present
        } else if (video.value) {
          video.value.volume = vol
        }
      }
    },
    { immediate: true }
  )

  const setupTimeUpdate = (mediaElement: HTMLMediaElement) => {
    if (!currentSong.value) return
    const start =
      currentSong.value.previewStartSeconds ??
      (currentSong.value.gapMilliseconds ? currentSong.value.gapMilliseconds / 1000 : 30)
    const end = start + previewDefaultDurationSeconds
    const fadeDuration = 2

    const currentMediaTime = mediaElement.currentTime

    if (currentMediaTime >= end - fadeDuration && !isFading && isPlaying.value) {
      isFading = true

      fadeTween = gsap.to(mediaElement, {
        volume: 0,
        duration: fadeDuration,
        ease: 'none',
        onComplete: () => {
          mediaElement.currentTime = start

          // Wenn Video dabei ist und das Video aber NICHT master ist (weil Audio spielt), muss das Video gesynced zurückgesetzt werden
          if (isUsingAudio.value && isUsingVideo.value && video.value) {
            const gap = currentSong.value?.videoGapSeconds ?? 0
            video.value.currentTime = Math.max(0.01, start + gap)
          }

          fadeTween = gsap.to(mediaElement, {
            volume: settings.value?.musicVolume ?? 1,
            duration: fadeDuration,
            ease: 'none',
            onComplete: () => {
              isFading = false
            }
          })
        }
      })
    }
  }

  // Event Listeners aufbauen, wenn das Video-Element verfügbar wird
  watch(
    video,
    (vElement) => {
      if (!vElement) return

      vElement.addEventListener('timeupdate', () => {
        if (!isUsingAudio.value && isUsingVideo.value) {
          setupTimeUpdate(vElement)
        }
      })

      vElement.addEventListener('loadedmetadata', () => {
        if (isUsingVideo.value && !isUsingAudio.value) {
          duration.value = vElement.duration ?? 0
        }
      })

      vElement.addEventListener('canplay', () => {
        console.log('Video can play:', currentSong.value?.title)
      })
    },
    { immediate: true }
  )

  // Audio Event Listeners
  audio.value.addEventListener('timeupdate', () => {
    if (isUsingAudio.value) {
      setupTimeUpdate(audio.value)
    }
  })

  audio.value.addEventListener('loadedmetadata', () => {
    if (isUsingAudio.value) {
      duration.value = audio.value.duration ?? 0
    }
  })

  onUnmounted(() => {
    stop()
  })

  const stop = () => {
    // Invalidate pending play() completions and release media handles before Windows deletes files.
    loadVersion++
    isPlaying.value = false
    isLoading.value = false
    if (fadeTween) fadeTween.kill()
    fadeTween = null
    isFading = false
    if (syncRequestId !== null) {
      cancelAnimationFrame(syncRequestId)
      syncRequestId = null
    }
    if (video.value) {
      video.value.pause()
      video.value.removeAttribute('src')
      video.value.load()
    }
    audio.value.pause()
    audio.value.removeAttribute('src')
    audio.value.load()
    isUsingAudio.value = false
    isUsingVideo.value = false
    duration.value = 0
  }

  const loadSong = async (index: number) => {
    const version = ++loadVersion
    isPlaying.value = false
    if (fadeTween) fadeTween.kill()
    isFading = false

    if (syncRequestId !== null) {
      cancelAnimationFrame(syncRequestId)
      syncRequestId = null
    }

    const song = songsApi.songs.value[index]
    if (!song || !video.value) {
      stop()
      return
    }

    console.log('Previewing song:', song.title)
    isLoading.value = true
    currentIndex.value = index

    isUsingAudio.value = song.usesAudio
    isUsingVideo.value = song.usesVideo

    video.value.src = song.video ? accessLocalFile(song.video) : ''
    audio.value.src = song.audio ? accessLocalFile(song.audio) : ''
    video.value.muted = song.usesAudio

    const initialTime =
      song.previewStartSeconds ?? (song.gapMilliseconds ? song.gapMilliseconds / 1000 : 30)

    const loadPromises = [
      new Promise<void>((resolve) => {
        if (!video.value || !song.usesVideo) {
          resolve()
          return
        }

        const onLoadedMetadata = () => {
          if (video.value) {
            video.value.currentTime = isUsingAudio.value
              ? Math.max(0, initialTime + (song.videoGapSeconds ?? 0))
              : initialTime
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
          video.value.currentTime = isUsingAudio.value
            ? Math.max(0, initialTime + (song.videoGapSeconds ?? 0))
            : initialTime
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

        const onLoadedMetadataAudio = () => {
          audio.value.currentTime = initialTime
        }
        audio.value.addEventListener('loadedmetadata', onLoadedMetadataAudio)

        const onCanPlayAudio = () => {
          audio.value.removeEventListener('canplay', onCanPlayAudio)
          audio.value.removeEventListener('loadedmetadata', onLoadedMetadataAudio)
          resolve()
        }

        if (audio.value.readyState >= 3) {
          audio.value.removeEventListener('loadedmetadata', onLoadedMetadataAudio)
          audio.value.currentTime = initialTime
          resolve()
        } else {
          audio.value.addEventListener('canplay', onCanPlayAudio)
        }
      })
    ]

    const baseVolume = settings.value?.musicVolume ?? 1
    if (isUsingAudio.value) {
      audio.value.volume = baseVolume
      video.value.volume = 0
    } else {
      video.value.volume = baseVolume
    }

    if (song.usesVideo) video.value.load()
    if (song.usesAudio) audio.value.load()

    await Promise.all(loadPromises)
    if (version !== loadVersion) return
    isLoading.value = false
    play()
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
          video.value.currentTime = desiredVideoTime
        }
        syncRequestId = requestAnimationFrame(sync)
      }
      syncRequestId = requestAnimationFrame(sync)

      const song = currentSong.value
      const initialTime =
        song?.previewStartSeconds ?? (song?.gapMilliseconds ? song.gapMilliseconds / 1000 : 30)

      audio.value.currentTime = initialTime
      video.value!.currentTime = Math.max(0.01, initialTime + (song?.videoGapSeconds ?? 0))

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
    isPlaying.value = false
    if (isUsingAudio.value) {
      audio.value.pause()
    }
    if (isUsingVideo.value && video.value) {
      video.value.pause()
    }
  }

  const seek = (timeInSeconds: number) => {
    if (fadeTween) fadeTween.kill()
    isFading = false

    const vol = settings.value?.musicVolume ?? 1
    if (isUsingAudio.value) {
      audio.value.volume = vol
      audio.value.currentTime = timeInSeconds
      if (isUsingVideo.value && video.value) {
        video.value.currentTime = Math.max(
          0,
          timeInSeconds + (currentSong.value?.videoGapSeconds ?? 0)
        )
      }
    } else if (isUsingVideo.value && video.value) {
      video.value.volume = vol
      video.value.currentTime = timeInSeconds
    }
  }

  watch(currentIndex, (newIndex) => {
    loadSong(newIndex)
  })

  watch(
    [songsApi.songs, video],
    ([songs, element], previous) => {
      if (!songs.length || !element) {
        stop()
        if (!songs.length) currentIndex.value = 0
        return
      }
      const previousSong = previous?.[0]?.[currentIndex.value]
      const preservedIndex = previousSong
        ? songs.findIndex((song) => song.meta.id === previousSong.meta.id)
        : -1
      const index =
        preservedIndex >= 0
          ? preservedIndex
          : Math.min(Math.max(0, currentIndex.value), songs.length - 1)
      if (index !== currentIndex.value) currentIndex.value = index
      else loadSong(index)
    },
    {
      immediate: true
    }
  )

  const previewPlayerApi = {
    // State
    video,
    currentSong,
    currentIndex,
    isPlaying,
    isLoading,
    currentTime,
    duration,
    songs: songsApi?.songs,
    // Actions
    play,
    pause,
    stop,
    reload: () => loadSong(currentIndex.value),
    seek
  }

  /* make it globally accessible via */
  provide('previewPlayer', previewPlayerApi)
  return previewPlayerApi
}

type PreviewPlayer = ReturnType<typeof usePreviewPlayer>

export function accessPreviewPlayer() {
  const previewPlayer = inject<PreviewPlayer>('previewPlayer')
  if (!previewPlayer) {
    throw new Error('No preview player provided')
  }
  return previewPlayer
}
