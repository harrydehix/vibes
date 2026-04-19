import { ref, computed, watch, onUnmounted, provide, inject } from 'vue'
import { accessSongs } from './useSongs'
import { accessLocalFile } from '@renderer/utils/accessLocalFile'
import gsap from 'gsap'
import { accessSettings } from './useSettings'

export function usePreviewPlayer(
  startIndex: number = 0,
  previewDefaultDurationSeconds: number = 20
) {
  const songsApi = accessSongs()
  const video = ref<HTMLVideoElement | null>(null)
  const { settings } = accessSettings()

  // State
  const currentIndex = ref(startIndex)
  const isPlaying = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const isLoading = ref(true)

  let fadeTween: gsap.core.Tween | null = null
  let isFading = false

  // Computed Properties
  const currentSong = computed(() => songsApi.songs.value[currentIndex.value])

  watch(
    () => settings.value?.musicVolume,
    (newVolume) => {
      if (!isFading && video.value) {
        video.value.volume = newVolume ?? 1
      }
    },
    { immediate: true }
  )

  // Event Listeners aufbauen, wenn das Video-Element verfügbar wird
  watch(
    video,
    (vElement) => {
      if (!vElement) return
      vElement.volume = settings.value?.musicVolume ?? 1

      vElement.addEventListener('timeupdate', () => {
        currentTime.value = vElement.currentTime ?? 0

        if (!currentSong.value) return
        const start =
          currentSong.value.previewStart ??
          (currentSong.value.gap ? currentSong.value.gap / 1000 : 30)
        const end = start + previewDefaultDurationSeconds
        const fadeDuration = 2

        if (currentTime.value >= end - fadeDuration && !isFading && isPlaying.value) {
          isFading = true
          fadeTween = gsap.to(vElement, {
            volume: 0,
            duration: fadeDuration,
            ease: 'none',
            onComplete: () => {
              vElement.currentTime = start
              fadeTween = gsap.to(vElement, {
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
      })

      vElement.addEventListener('loadedmetadata', () => {
        duration.value = vElement.duration ?? 0
      })

      vElement.addEventListener('canplay', () => {
        console.log('Video can play:', currentSong.value?.title)
        isLoading.value = false
        video.value?.play()
      })

      vElement.addEventListener('ended', () => {})

      vElement.addEventListener('play', () => (isPlaying.value = true))
      vElement.addEventListener('playing', () => (isPlaying.value = true))
      vElement.addEventListener('pause', () => (isPlaying.value = false))
    },
    { immediate: true }
  )

  onUnmounted(() => {
    if (fadeTween) fadeTween.kill()
    if (video.value) {
      video.value.pause()
      video.value.removeAttribute('src')
      video.value.load()
    }
  })

  const loadSong = (index: number) => {
    const song = songsApi.songs.value[index]
    if (!song) return

    console.log('Previewing song:', song.title)

    if (fadeTween) fadeTween.kill()
    isFading = false

    currentTime.value = song.previewStart ?? (song.gap ? song.gap / 1000 : 30)
    isLoading.value = true
    currentIndex.value = index

    if (video.value) {
      video.value.volume = settings.value?.musicVolume ?? 1
      video.value.src = accessLocalFile(song.video || song.audio)
      video.value.currentTime = currentTime.value
      video.value.load()
    }
  }

  const seek = (timeInSeconds: number) => {
    if (fadeTween) fadeTween.kill()
    isFading = false
    if (video.value) {
      video.value.volume = settings.value?.musicVolume ?? 1
      video.value.currentTime = timeInSeconds
    }
  }

  watch(currentIndex, (newIndex) => {
    loadSong(newIndex)
  })

  watch(
    [songsApi.songs, video],
    () => {
      if (songsApi.songs.value.length > 0 && video.value) {
        console.log('Songs loaded, starting preview with index:', startIndex)
        loadSong(startIndex)
      }
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
