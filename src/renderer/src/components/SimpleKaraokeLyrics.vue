<script setup lang="ts">
import { accessSettings } from '@renderer/composables/useSettings'
import { accessSongPlayer } from '@renderer/composables/useSongPlayer'
import { getLyricsRows, type LyricsRow } from '@renderer/utils/singingPauses'
import type { Line } from '@shared/types'
import { gsap } from 'gsap'
import { computed, onMounted, onUnmounted, ref, watch, nextTick } from 'vue'

const videoPlayer = accessSongPlayer()
const phraseTiming = computed(() => videoPlayer.currentSong.value?.lyricsTiming === 'phrase')

const containerRef = ref<HTMLDivElement | null>(null)
const trackRef = ref<HTMLDivElement | null>(null)

const lineDivs = ref<HTMLDivElement[]>([])
const currentActiveLineIndex = ref<number>(-1)
const currentActiveSyllableIndex = ref<number>(-1)
const lineHeights = ref<number[]>([])
const lineWidths = ref<number[]>([])
const virtualizationEnabled = ref(false)
const lyricsMode = ref<'scale-active-syllable' | 'highlight-left-to-right'>(
  'highlight-left-to-right'
)
const syllableTimelines = new Set<gsap.core.Timeline>()
let lastMediaTimeMs: number | null = null

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

const playbackTimeMs = ref(0)
const lyricsRows = computed(() => getLyricsRows(lines.value.P1))

function pauseProgress(row: LyricsRow): number {
  return Math.max(
    0,
    Math.min(1, (playbackTimeMs.value - row.startTimeMs) / (row.endTimeMs - row.startTimeMs))
  )
}

function resetSyllableHighlights(): void {
  for (const timeline of syllableTimelines) timeline.kill()
  syllableTimelines.clear()
  const spans = lineDivs.value.flatMap((div) =>
    div ? Array.from(div.querySelectorAll('span')) : []
  )
  if (spans.length) gsap.set(spans, { clearProps: 'opacity,transform' })
  currentActiveSyllableIndex.value = -1
}

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

      if (div.scrollWidth > maxWidth) {
        hasWrapping = true
        break
      }

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
    virtualizationEnabled.value = false
    dynamicFontScale.value = settings.value?.lyricsFontScale ?? 1
    await nextTick()
    await adjustFontScale()
    await nextTick()
    lineHeights.value = lineDivs.value.map((div) =>
      div ? Math.ceil(div.getBoundingClientRect().height) : 0
    )
    lineWidths.value = lineDivs.value.map((div) =>
      div ? Math.ceil(div.getBoundingClientRect().width) : 0
    )
    virtualizationEnabled.value = true
    scrollToLine(Math.max(0, currentActiveLineIndex.value), false)
  },
  { immediate: true, deep: true }
)

function handleResize() {
  virtualizationEnabled.value = false
  dynamicFontScale.value = settings.value?.lyricsFontScale ?? 1
  nextTick(async () => {
    await adjustFontScale()
    lineHeights.value = lineDivs.value.map((div) =>
      div ? Math.ceil(div.getBoundingClientRect().height) : 0
    )
    lineWidths.value = lineDivs.value.map((div) =>
      div ? Math.ceil(div.getBoundingClientRect().width) : 0
    )
    virtualizationEnabled.value = true
    scrollToLine(Math.max(0, currentActiveLineIndex.value), false)
  })
}

// jump at video start to line 0
watch(
  () => videoPlayer.isPlaying.value,
  (isPlaying) => {
    if (isPlaying && videoPlayer.video.value && videoPlayer.getCurrentTime() < 0.5) {
      scrollToLine(0, false)
    }
  }
)

const syncTimeline = () => {
  if (videoPlayer.video.value) {
    const mediaTimeMs = videoPlayer.getCurrentTime() * 1000
    if (lastMediaTimeMs !== null && mediaTimeMs < lastMediaTimeMs) {
      resetSyllableHighlights()
      currentActiveLineIndex.value = -1
    }
    lastMediaTimeMs = mediaTimeMs
    const storedOffsetMs = videoPlayer.currentSong.value?.fixOffsetMs ?? 0
    const previewOffsetMs = videoPlayer.songOffsetPreviewMs.value ?? storedOffsetMs
    const offsetMs = -(settings.value?.syncOffsetMs ?? -200) - (previewOffsetMs - storedOffsetMs)
    const time = mediaTimeMs + offsetMs
    // Use the lyrics clock so pause, seeking and sync-offset changes cannot drift.
    playbackTimeMs.value = time

    const activeLineIndex = lyricsRows.value.findIndex(
      (item) => time >= item.startTimeMs && time < item.endTimeMs
    )

    const newLine = scrollToLine(activeLineIndex)
    const activeRow = lyricsRows.value[activeLineIndex]
    if (newLine && activeRow?.kind === 'lyrics') {
      console.log(`P1: ${activeRow.syllables.map((syllable) => syllable.text).join('')}`)
    }
    if (!phraseTiming.value && activeRow?.kind === 'lyrics')
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
  const timeline = gsap.timeline({
    paused: true,
    onComplete: () => {
      syllableTimelines.delete(timeline)
    }
  })
  syllableTimelines.add(timeline)
  console.log(
    `Highlighting syllable: ${syllable.text} (line ${lineIndex}, syllable ${syllableIndex}, duration ${syllableDuration}s)`
  )

  if (lyricsMode.value === 'scale-active-syllable') {
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
  } else if (lyricsMode.value === 'highlight-left-to-right') {
    timeline.to(
      syllableSpan,
      {
        opacity: 1,
        duration: 0.2,
        ease: 'power2.out'
      },
      0
    )
    timeline.to(
      syllableSpan,
      {
        scale: 1.05,
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
        duration: 0.2,
        ease: 'power2.out'
      },
      syllableDuration + 0.2
    )
  }

  timeline.play()
}

function activeSyllableEffect(lineIndex: number, timeMs: number, newLine: boolean) {
  // The active syllable should pop up slightly and then return to normal size
  const line = lyricsRows.value[lineIndex]
  const previousRow = lyricsRows.value[lineIndex - 1]
  const previousLine = previousRow?.kind === 'lyrics' ? previousRow : undefined
  if (!line || line.kind !== 'lyrics') return
  const syllable = line.syllables.find((s) => timeMs >= s.startTimeMs && timeMs <= s.endTimeMs)
  if (!syllable) return
  const syllableIndex = line.syllables.indexOf(syllable)
  if (syllableIndex === currentActiveSyllableIndex.value && !newLine) return
  if (!newLine && syllableIndex - currentActiveSyllableIndex.value > 1) {
    // Highlight skipped syllables in same line
    for (let i = currentActiveSyllableIndex.value + 1; i <= syllableIndex; i++) {
      highlightSyllable(line.syllables[i], i, lineIndex)
    }
  } else if (
    newLine &&
    previousLine &&
    currentActiveSyllableIndex.value + 1 !== previousLine.syllables.length
  ) {
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
  if (activate && previousLineIndex === index) return false
  if (activate) currentActiveLineIndex.value = index

  if (index === -1) {
    return false
  }

  const lineDiv = lineDivs.value[index]
  if (lineDiv) {
    const containerCenter = containerRef.value!.clientHeight / 2
    const lineTop = lineDiv.offsetTop
    const lineCenter = lineDiv.clientHeight / 2

    const targetY = containerCenter - (lineTop + lineCenter)
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
  gsap.ticker.remove(syncTimeline)
  resetSyllableHighlights()
  if (ctx) {
    ctx.revert()
  }
  window.removeEventListener('resize', handleResize)
})
</script>
<template>
  <div
    :class="$style.highContrast"
    v-if="settings?.highContrastMode || !videoPlayer.isUsingVideo.value"
  ></div>
  <div ref="containerRef" :class="`${$style.lyricsContainer}`">
    <div
      ref="trackRef"
      :class="[$style.track, { [$style.centered]: settings?.lyricsAlignment === 'center' }]"
      :style="{
        fontSize: `${dynamicFontScale * 3}rem`
      }"
    >
      <div
        v-for="(row, index) in lyricsRows"
        :key="videoPlayer.currentSong.value.index + '-' + index"
        :ref="(el) => (lineDivs[index] = el as any)"
        :class="`${$style.lyricsLine} ${row.kind === 'pause' ? $style.pauseCue : phraseTiming ? $style.phrase : ''} ${settings?.highContrastMode && videoPlayer.isUsingVideo.value ? $style.contrast : ''} ${!settings?.lowPerformanceMode ? $style.highPerformance : ''}`"
        :data-active="index === currentActiveLineIndex"
        :role="row.kind === 'pause' ? 'progressbar' : undefined"
        :aria-label="row.kind === 'pause' ? 'Time until singing' : undefined"
        :aria-valuemin="row.kind === 'pause' ? 0 : undefined"
        :aria-valuemax="row.kind === 'pause' ? 100 : undefined"
        :aria-valuenow="row.kind === 'pause' ? Math.round(pauseProgress(row) * 100) : undefined"
        :aria-valuetext="
          row.kind === 'pause'
            ? `Singing in ${Math.max(0, Math.ceil((row.endTimeMs - playbackTimeMs) / 1000))} seconds`
            : undefined
        "
        :style="{
          ...(virtualizationEnabled && lineHeights[index]
            ? {
                containIntrinsicSize: `${lineWidths[index]}px ${lineHeights[index]}px`,
                contentVisibility: 'auto'
              }
            : {}),
          '--pause-fill': row.kind === 'pause' ? `${pauseProgress(row) * 100}%` : undefined
        }"
      >
        <template v-if="row.kind === 'pause'">
          <div :class="$style.pauseBackground" aria-hidden="true"></div>
          <v-icon name="md-musicnote" :class="$style.pauseNote" aria-hidden="true" />
          <v-icon
            name="md-musicnote"
            :class="`${$style.pauseNote} ${$style.pauseFill}`"
            aria-hidden="true"
          />
        </template>
        <div v-else :class="$style.inner">
          <span v-if="phraseTiming">{{
            row.syllables.map((syllable) => syllable.text).join('')
          }}</span>
          <template v-else>
            <span
              v-for="(syllable, syllableIndex) in row.syllables"
              :key="syllable.text + syllableIndex"
              >{{ syllable.text }}</span
            >
          </template>
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

.highContrast {
  position: fixed;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  // make it a cool colorful gradient or something in the future, only from blue to purple to not mess too much with the visibility of the lyrics
  background: linear-gradient(
    45deg,
    rgba(0, 0, 255, 0.5) 0%,
    rgba(128, 0, 128, 0.5) 50%,
    rgba(0, 0, 255, 0.5) 100%
  );
  pointer-events: none;
  z-index: 0;
}

.track {
  position: relative;
  font-size: 3rem;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;

  &.centered {
    align-items: center;
    text-align: center;
  }
}

.lyricsLine.pauseCue {
  position: relative;
  width: 8rem;
  height: 5.5rem;
  box-sizing: border-box;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  background-color: black;
  border-radius: 1rem;
  pointer-events: none;
}

.pauseBackground {
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--pause-fill);
  background-color: rgba(165, 105, 234, 0.25);
}

.pauseNote {
  grid-area: 1 / 1;
  width: 4rem;
  height: 4rem;
  color: rgba(255, 255, 255, 0.3);
}

.pauseFill {
  color: #a169ea;
  clip-path: inset(0 calc(100% - var(--pause-fill)) 0 0);
}

.lyricsLine {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  color: white;
  text-align: inherit;
  opacity: 0.5;
  transition: opacity 0.3s;
  margin-bottom: 2rem;
  background-color: black;
  border-radius: 1rem;
  padding: 0 0.2rem;
  width: fit-content;
  &[data-active='true'] {
    opacity: 1;
  }
  &.highPerformance {
    text-shadow:
      0 0 5px rgba(255, 255, 255, 0.8),
      0 0 10px rgba(255, 255, 255, 0.6),
      0 0 20px rgba(0, 0, 0, 1);
  }

  .inner {
  }

  &.contrast {
    background-color: black;
    color: white;
    span {
      opacity: 0.8;
    }
  }

  span {
    opacity: 0.5;
    display: inline-block;
    white-space: pre;
  }
}

.phrase {
  max-width: calc(100vw - 3rem);
  span {
    white-space: normal;
    overflow-wrap: anywhere;
    opacity: 1;
  }
}
</style>
