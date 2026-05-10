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
    audio.value.loop = true
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

      const startAudio = () => {
        if (!audio.value) return
        const duration = audio.value.duration || 0
        if (duration > 15) {
          audio.value.currentTime = Math.random() * (duration - 15)
        } else {
          audio.value.currentTime = 0
        }
        audio.value.play().catch((err) => console.error('Error playing intro music:', err))

        gsap.to(audio.value, {
          volume: actualVolume.value,
          duration: 1,
          ease: 'power2.inOut'
        })
      }

      if (audio.value.readyState >= 1) {
        startAudio()
      } else {
        audio.value.addEventListener('loadedmetadata', startAudio, { once: true })
      }
    }
  }

  const disable = () => {
    isEnabled.value = false
    if (audio.value) {
      gsap.killTweensOf(audio.value)

      gsap.to(audio.value, {
        volume: 0,
        duration: 3,
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
