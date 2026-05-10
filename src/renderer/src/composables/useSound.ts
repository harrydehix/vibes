import clickSound from '@renderer/assets/sounds/click.mp3'
import hoverSound from '@renderer/assets/sounds/hover2.mp3'
import downloadSuccessSound from '@renderer/assets/sounds/download-success.mp3'
import introCinematicSound from '@renderer/assets/sounds/test-1.mp3'
import { accessSettings } from './useSettings'
import { watch } from 'vue'
import gsap from 'gsap'

const defaultSoundMap = {
  click: clickSound,
  hover: hoverSound,
  downloadSuccess: downloadSuccessSound,
  'intro-cinematic': introCinematicSound
}

export function useSound(soundMap = defaultSoundMap) {
  const audioObjects: Record<string, HTMLAudioElement> = {}
  const { settings } = accessSettings()

  for (const [type, url] of Object.entries(soundMap)) {
    if (typeof window !== 'undefined') {
      audioObjects[type] = new Audio(url)
      audioObjects[type].volume = settings.value?.sfxVolume ?? 1
      audioObjects[type].preload = 'auto'
    }
  }

  watch(
    () => settings.value?.sfxVolume,
    (newVolume) => {
      for (const audio of Object.values(audioObjects)) {
        audio.volume = newVolume ?? 1
      }
    },
    { immediate: true }
  )

  const play = (type: keyof typeof defaultSoundMap, loop = false, fadeIn = false) => {
    const audio = audioObjects[type]
    if (!audio) {
      console.warn(`Soundtyp '${type}' wurde nicht definiert.`)
      return
    }
    audio.currentTime = 0
    audio.loop = loop
    if (fadeIn) {
      audio.volume = 0
      gsap.to(audio, {
        volume: settings.value?.sfxVolume ?? 1,
        duration: 0.5,
        ease: 'power2.inOut'
      })
    }
    audio.play().catch((error) => {
      console.debug('Failed to play sound (often due to autoplay restrictions):', error)
    })
  }

  const pause = (type: keyof typeof defaultSoundMap, fadeOut = false) => {
    const audio = audioObjects[type]
    // fade out audio using gsap
    if (audio) {
      if (fadeOut) {
        gsap.to(audio, {
          volume: 0,
          duration: 0.5,
          onComplete: () => {
            audio.pause()
            audio.currentTime = 0
            audio.volume = settings.value?.sfxVolume ?? 1
          }
        })
      } else {
        audio.pause()
        audio.currentTime = 0
      }
    }
  }

  return { play, pause }
}
