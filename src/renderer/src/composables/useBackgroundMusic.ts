import { ref, watch, onMounted, onUnmounted, provide, inject } from 'vue'
import gsap from 'gsap'
import backgroundMusic from '@renderer/assets/background.mp3'

export function useBackgroundMusic(autoplay: boolean = false) {
  const audio = ref<HTMLAudioElement | null>(null)
  const isEnabled = ref(false)
  const volume = ref(0.25)

  onMounted(() => {
    audio.value = new Audio(backgroundMusic)
    audio.value.loop = true
    audio.value.volume = volume.value

    if (autoplay) {
      enable()
    }
  })

  watch(volume, (newVolume) => {
    if (audio.value) {
      audio.value.volume = newVolume
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
      audio.value.play().catch((err) => console.error('Error playing background music:', err))

      gsap.to(audio.value, {
        volume: volume.value,
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

  const backgroundMusicApi = {
    isEnabled,
    volume,
    enable,
    disable
  }

  provide('backgroundMusic', backgroundMusicApi)
  return backgroundMusicApi
}

export function accessBackgroundMusic() {
  return inject('backgroundMusic') as ReturnType<typeof useBackgroundMusic>
}
