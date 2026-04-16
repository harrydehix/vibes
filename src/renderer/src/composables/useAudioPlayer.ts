import { ref, computed, onMounted, onUnmounted, provide, inject, watch } from 'vue'
import { accessSongs } from './useSongs'
import { accessLocalFile } from '@renderer/utils/accessLocalFile'

export function useAudioPlayer() {
  const songsApi = accessSongs()
  const audio = ref<HTMLAudioElement | null>(null)

  // State
  const currentIndex = ref(0)
  const isPlaying = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const shuffle = ref(false)
  const isLoading = ref(true)
  const autoPlayNext = ref(false)

  // Computed Properties
  const currentSong = computed(() => songsApi.songs.value[currentIndex.value])
  const hasNext = computed(() => currentIndex.value < songsApi.songs.value.length - 1)
  const hasPrev = computed(() => currentIndex.value > 0)

  onMounted(() => {
    audio.value = new Audio()

    audio.value.addEventListener('timeupdate', () => {
      currentTime.value = audio.value?.currentTime ?? 0
    })

    audio.value.addEventListener('loadedmetadata', () => {
      duration.value = audio.value?.duration ?? 0
    })

    audio.value.addEventListener('canplay', () => {
      console.log('Track can play:', currentSong.value?.title)
      isLoading.value = false
    })

    audio.value.addEventListener('ended', () => {
      if (shuffle.value) {
        const randomIndex = Math.floor(Math.random() * songsApi.songs.value.length)
        loadSong(randomIndex)
        play()
        return
      } else {
        next(true)
      }
    })

    audio.value.addEventListener('play', () => (isPlaying.value = true))
    audio.value.addEventListener('pause', () => (isPlaying.value = false))
  })

  onUnmounted(() => {
    if (audio.value) {
      audio.value.pause()
      audio.value.src = ''
    }
  })

  const loadSong = (index: number) => {
    console.log('Loading track:', songsApi.songs.value[index]?.title)
    currentTime.value = 0
    isLoading.value = true
    if (!audio.value || index < 0 || index >= songsApi.songs.value.length) return
    currentIndex.value = index
    audio.value.src = accessLocalFile(songsApi.songs.value[index].audio)
    audio.value.load()
  }

  const play = () => audio.value?.play()
  const pause = () => audio.value?.pause()
  const stop = () => {
    if (audio.value) {
      audio.value.pause()
      audio.value.currentTime = 0
    }
  }

  const next = (forceAutoPlay = false) => {
    const wasPlaying = isPlaying.value
    if (hasNext.value) {
      loadSong(currentIndex.value + 1)
    } else {
      loadSong(0)
    }
    if ((wasPlaying || forceAutoPlay) && autoPlayNext.value) {
      play()
    }
  }

  const prev = () => {
    if (currentTime.value > 3) {
      seek(0)
      return
    }

    const wasPlaying = isPlaying.value
    if (hasPrev.value) {
      loadSong(currentIndex.value - 1)
    } else {
      loadSong(songsApi.songs.value.length - 1)
    }
    if (wasPlaying) {
      play()
    }
  }

  const seek = (timeInSeconds: number) => {
    if (audio.value) {
      audio.value.currentTime = timeInSeconds
    }
  }

  watch(
    songsApi.songs,
    () => {
      if (songsApi.songs.value.length > 0) {
        loadSong(0)
      }
    },
    { immediate: true }
  )

  const audioPlayerApi = {
    // State
    audio,
    currentSong,
    currentIndex,
    isPlaying,
    isLoading,
    currentTime,
    duration,
    hasNext,
    hasPrev,
    autoPlayNext,
    shuffle,
    // Actions
    play,
    pause,
    stop,
    next,
    prev,
    seek
  }

  provide('audioPlayer', audioPlayerApi)
  return audioPlayerApi
}

export function accessAudioPlayer() {
  return inject('audioPlayer') as ReturnType<typeof useAudioPlayer>
}
