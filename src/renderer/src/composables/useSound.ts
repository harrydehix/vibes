import clickSound from '@renderer/assets/sounds/click.mp3'
import hoverSound from '@renderer/assets/sounds/hover2.mp3'
import { accessSettings } from './useSettings'
import { watch } from 'vue'

const defaultSoundMap = {
  click: clickSound,
  hover: hoverSound
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

  const play = (type: keyof typeof defaultSoundMap) => {
    const audio = audioObjects[type]
    if (!audio) {
      console.warn(`Soundtyp '${type}' wurde nicht definiert.`)
      return
    }
    audio.currentTime = 0
    audio.play().catch((error) => {
      console.debug('Failed to play sound (often due to autoplay restrictions):', error)
    })
  }

  return { play }
}
