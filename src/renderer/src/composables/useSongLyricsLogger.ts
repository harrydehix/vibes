import { computed, watch } from 'vue'
import { accessSongPlayer } from './useSongPlayer'
import { Line } from '@shared/types'
import { ref } from 'vue'

export function useSongLyricsLogger(offsetMs = -150) {
  const videoPlayer = accessSongPlayer()

  const p1LeftLines = ref<Line[]>([])
  const p2LeftLines = ref<Line[]>([])

  const lines = computed(() => {
    const currentSong = videoPlayer.currentSong.value
    return currentSong?.lines || []
  })

  watch(lines, (newLines) => {
    p1LeftLines.value = newLines.P1
    p2LeftLines.value = newLines.P2 || []
  })

  // react on video player time updates, trigger console.log with text if times elapsed
  watch(
    () => videoPlayer.currentTime.value,
    (currentTime) => {
      const currentTimeMs = currentTime * 1000 - offsetMs

      const activeLineP1 = p1LeftLines.value.filter((line) => {
        return currentTimeMs >= line.startTimeMs
      })[0]

      const activeLineP2 = p2LeftLines.value.filter((line) => {
        return currentTimeMs >= line.startTimeMs
      })[0]

      if (activeLineP1) {
        console.log(`P1 ${activeLineP1.syllables.map((s) => s.text).join('')}`)
      }

      if (activeLineP2) {
        console.log(`P2 ${activeLineP2.syllables.map((s) => s.text).join('')}`)
      }

      p1LeftLines.value = p1LeftLines.value.filter((line) => {
        return line !== activeLineP1
      })
      p2LeftLines.value = p2LeftLines.value.filter((line) => {
        return line !== activeLineP2
      })
    }
  )

  return {
    lines
  }
}
