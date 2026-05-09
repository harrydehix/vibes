import { ref, watch, onMounted, onUnmounted, provide, inject, computed } from 'vue'
import gsap from 'gsap'
import introMusic from '@renderer/assets/vibes-intro.mp3'
import { accessSettings } from './useSettings'

export function useIntroMusic(
  autoplay: boolean = false,
  settings: ReturnType<typeof accessSettings>
) {
  const audio = ref<HTMLAudioElement | null>(null)
  const isEnabled = ref(false)
  const volume = ref(0.3)

  const actualVolume = computed(() => {
    return (settings.settings.value?.musicVolume ?? 1) * volume.value
  })

  watch(
    actualVolume,
    (newVolume) => {
      if (audio.value) {
        audio.value.volume = newVolume
      }
    },
    { immediate: true }
  )

  onMounted(() => {
    audio.value = new Audio(introMusic)
    audio.value.loop = false
    audio.value.volume = actualVolume.value

    if (autoplay) {
      enable()
    }
  })

  onUnmounted(() => {
    if (audio.value) {
      audio.value.pause()
      audio.value.src = ''
    }
  })

  const enable = () => {
    isEnabled.value = true
    if (audio.value) {
      gsap.killTweensOf(audio.value)
      audio.value.volume = 0
      audio.value.play().catch((err) => console.error('Error playing intro music:', err))

      gsap.to(audio.value, {
        volume: actualVolume.value,
        duration: 1,
        ease: 'power2.inOut'
      })
    }
  }

  const disable = () => {
    isEnabled.value = false
    if (audio.value) {
      gsap.killTweensOf(audio.value)

      gsap.to(audio.value, {
        volume: 0,
        duration: 1,
        ease: 'power2.inOut',
        onComplete: () => {
          if (audio.value) {
            audio.value.pause()
          }
        }
      })
    }
  }

  const introMusicApi = {
    isEnabled,
    volume,
    enable,
    disable
  }

  provide('introMusic', introMusicApi)
  return introMusicApi
}

export function accessIntroMusic() {
  return inject('introMusic') as ReturnType<typeof useIntroMusic>
}
