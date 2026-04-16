<script setup lang="ts">
import { accessSettings } from '@renderer/composables/useSettings'
import { accessVideoPlayer } from '@renderer/composables/useVideoPlayer'
import { Line } from '@shared/types'
import { gsap } from 'gsap'
import { computed, onMounted, onUnmounted, ref, watch, nextTick } from 'vue'

const videoPlayer = accessVideoPlayer()

const containerRef = ref<HTMLDivElement | null>(null)
const trackRef = ref<HTMLDivElement | null>(null)

const lineDivs = ref<HTMLDivElement[]>([])
const currentActiveLineIndex = ref<number>(-1)
const currentActiveSyllableIndex = ref<number>(-1)

const { settings } = accessSettings()

let ctx

onUnmounted(() => {
  if (ctx) {
    ctx.revert()
  }
})

const lines = computed(() => {
  const song = videoPlayer.currentSong.value
  return song?.lines || { P1: [], P2: [] }
})

const dynamicFontScale = ref(settings.value?.lyricsFontScale ?? 1)

async function adjustFontScale() {
  if (!containerRef.value) return
  let hasWrapping = true
  let attempts = 0

  while (hasWrapping && dynamicFontScale.value > 0.2 && attempts < 20) {
    hasWrapping = false
    const maxWidth = containerRef.value.clientWidth * 0.95 // 5% padding as safety boundary

    for (const div of lineDivs.value) {
      if (!div) continue

      // Fallback: Check inner content width against the container width
      if (div.scrollWidth > maxWidth) {
        hasWrapping = true
        break
      }

      // Check logical linebreaks by comparing span top offsets
      const spans = div.querySelectorAll('span')
      if (spans.length > 1) {
        const firstTop = spans[0].offsetTop
        for (let i = 1; i < spans.length; i++) {
          if (spans[i].offsetTop > firstTop + 5) {
            hasWrapping = true
            break
          }
        }
      }

      if (hasWrapping) break
    }

    if (hasWrapping) {
      dynamicFontScale.value -= 0.05
      await nextTick() // Wait for DOM to repaint with smaller font before next check
    }
    attempts++
  }
  console.log(`Final font scale: ${dynamicFontScale.value}, attempts: ${attempts}`)
}

watch(
  () => [lines.value, settings.value?.lyricsFontScale],
  async () => {
    dynamicFontScale.value = settings.value?.lyricsFontScale ?? 1
    await nextTick()
    await adjustFontScale()
    scrollToLine(0, false)
  },
  { immediate: true, deep: true }
)

function handleResize() {
  dynamicFontScale.value = settings.value?.lyricsFontScale ?? 1
  nextTick(() => {
    adjustFontScale()
  })
}

// jump at video start to line 0
watch(
  () => videoPlayer.isPlaying.value,
  (isPlaying) => {
    if (isPlaying && videoPlayer.video.value && videoPlayer.video.value.currentTime < 0.5) {
      scrollToLine(0, false)
    }
  }
)

const syncTimeline = () => {
  if (videoPlayer.video.value) {
    const offsetMs = -(settings.value?.syncOffsetMs ?? -200)
    const time = videoPlayer.video.value.currentTime * 1000 + offsetMs

    const activeLineIndex = lines.value.P1.findIndex(
      (item) => time >= item.startTimeMs && time <= item.endTimeMs
    )

    const newLine = scrollToLine(activeLineIndex)
    if (newLine) {
      console.log(`P1: ${lines.value.P1[activeLineIndex]?.syllables.map((s) => s.text).join('')}`)
    }
    activeSyllableEffect(activeLineIndex, time, newLine)
  }
}

function highlightSyllable(
  syllable: Line['syllables'][number],
  syllableIndex: number,
  lineIndex: number
) {
  const syllableSpan = lineDivs.value[lineIndex]?.querySelectorAll('span')[
    syllableIndex
  ] as HTMLElement
  if (!syllableSpan) return

  const syllableDuration = (syllable.endTimeMs - syllable.startTimeMs) / 1000
  const timeline = gsap.timeline({ paused: true })
  console.log(
    `Highlighting syllable: ${syllable.text} (line ${lineIndex}, syllable ${syllableIndex}, duration ${syllableDuration}s)`
  )
  timeline.to(
    syllableSpan,
    {
      scale: 1.1,
      opacity: 1,
      duration: 0.2,
      ease: 'power2.out'
    },
    0
  )
  timeline.to(
    syllableSpan,
    {
      scale: 1,
      opacity: 0.5,
      duration: 0.2,
      ease: 'power2.out'
    },
    syllableDuration + 0.2
  )
  timeline.play()
}

function activeSyllableEffect(lineIndex: number, timeMs: number, newLine: boolean) {
  // The active syllable should pop up slightly and then return to normal size
  const line = lines.value.P1[lineIndex]
  const previousLine = lines.value.P1[lineIndex - 1]
  if (!line) return
  const syllable = line.syllables.find((s) => timeMs >= s.startTimeMs && timeMs <= s.endTimeMs)
  if (!syllable) return
  const syllableIndex = line.syllables.indexOf(syllable)
  if (syllableIndex === currentActiveSyllableIndex.value && !newLine) return
  if (!newLine && syllableIndex - currentActiveSyllableIndex.value > 1) {
    // Highlight skipped syllables in same line
    for (let i = currentActiveSyllableIndex.value + 1; i <= syllableIndex; i++) {
      highlightSyllable(line.syllables[i], i, lineIndex)
    }
  } else if (newLine && currentActiveSyllableIndex.value + 1 !== previousLine.syllables.length) {
    // Highlight remaining syllables of previous line if we jumped to a new line
    for (let i = currentActiveSyllableIndex.value + 1; i < previousLine.syllables.length; i++) {
      highlightSyllable(previousLine.syllables[i], i, lineIndex - 1)
    }
  } else if (newLine && syllableIndex > 0) {
    // Highlight all previous syllables of new line if we jumped to a new line and are not on the first syllable
    for (let i = 0; i < syllableIndex; i++) {
      highlightSyllable(line.syllables[i], i, lineIndex)
    }
  }
  currentActiveSyllableIndex.value = syllableIndex
  highlightSyllable(syllable, syllableIndex, lineIndex)
}

function scrollToLine(index: number, activate: boolean = true) {
  const previousLineIndex = currentActiveLineIndex.value
  const previousLineDiv = lineDivs.value[previousLineIndex]
  currentActiveLineIndex.value = index
  if (previousLineDiv) {
    gsap.to(previousLineDiv, {
      duration: 0.3,
      opacity: 0.5,
      ease: 'power2.out',
      overwrite: 'auto'
    })
  }

  if (index === -1) {
    return false
  }

  const lineDiv = lineDivs.value[index]
  if (lineDiv) {
    const containerCenter = containerRef.value!.clientHeight / 2
    const lineTop = lineDiv.offsetTop
    const lineCenter = lineDiv.clientHeight / 2

    const targetY = containerCenter - (lineTop + lineCenter)
    if (activate) {
      gsap.to(lineDiv, {
        duration: 0.3,
        opacity: 1,
        ease: 'power2.out',
        overwrite: 'auto'
      })
    }
    gsap.to(trackRef.value, {
      y: targetY,
      duration: 0.3,
      ease: 'power2.out',
      overwrite: 'auto'
    })
    return index !== previousLineIndex
  }
  return false
}

onMounted(() => {
  gsap.ticker.add(syncTimeline)
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  if (ctx) {
    ctx.revert()
  }
  window.removeEventListener('resize', handleResize)
})
</script>
<template>
  <div ref="containerRef" :class="$style.lyricsContainer">
    <div
      ref="trackRef"
      :class="$style.track"
      :style="{
        fontSize: `${dynamicFontScale * 3}rem`
      }"
    >
      <div
        v-for="(line, index) in lines.P1"
        :key="videoPlayer.currentSong.value.index"
        :ref="(el) => (lineDivs[index] = el as any)"
        :class="$style.lyricsLine"
      >
        <div :class="$style.inner">
          <span
            v-for="(syllable, syllableIndex) in line.syllables"
            :key="syllable.text + syllableIndex"
            >{{ syllable.text }}</span
          >
        </div>
      </div>
    </div>
  </div>
</template>
<style lang="less" module>
.lyricsContainer {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  background-color: rgba(0, 0, 0, 0.3);
  user-select: none;
  cursor: none;

  mask-image: linear-gradient(
    to bottom,
    transparent 10%,
    rgb(0, 0, 0) 40%,
    rgb(0, 0, 0) 60%,
    transparent 90%
  );
}

.track {
  position: relative;

  font-size: 3rem;
}

.lyricsLine {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  color: white;
  text-align: center;
  opacity: 0.5;
  margin-bottom: 2rem;
  background-color: black;

  border-radius: 1rem;
  padding: 0 0.2rem;
  width: fit-content;
  text-shadow:
    0 0 5px rgba(255, 255, 255, 0.8),
    0 0 10px rgba(255, 255, 255, 0.6),
    0 0 20px rgba(0, 0, 0, 1);

  .inner {
  }

  span {
    opacity: 0.5;
    display: inline-block;
    white-space: pre;
  }
}
</style>
