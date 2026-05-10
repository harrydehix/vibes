<script setup lang="ts">
import LeavePopup from '@renderer/components/LeavePopup.vue'
import { accessBackgroundMusic } from '@renderer/composables/useBackgroundMusic'
import { accessController } from '@renderer/composables/useController'
import { usePreviewPlayer } from '@renderer/composables/usePreviewPlayer'
import { useSettingsView } from '@renderer/composables/useSettingsView'
import { accessSongs } from '@renderer/composables/useSongs'
import { useSound } from '@renderer/composables/useSound'
import router from '@renderer/router'
import { accessLocalFile } from '@renderer/utils/accessLocalFile'
import { onKeyStroke } from '@vueuse/core'
import gsap from 'gsap'
import { onMounted, onUnmounted, ref, useCssModule, watch } from 'vue'
import { useRoute } from 'vue-router'
import defaultCover from '@renderer/assets/cover-fallback.png'

const showExitPopup = ref(false)
onKeyStroke('Escape', () => {
  showExitPopup.value = true
  console.log('Showing exit popup')
})

const route = useRoute()

const previewPlayer = usePreviewPlayer(
  route.query.songIndex ? parseInt(route.query.songIndex as string) : 0
)
const backgroundMusic = accessBackgroundMusic()
onMounted(() => {
  backgroundMusic.disable()
})
const $style = useCssModule()
const { play } = useSound()

function getRealIndex(index: number) {
  if (index < 0) {
    index = previewPlayer.songs?.value.length + index
  }
  return index % (previewPlayer.songs?.value.length || 1)
}

function getPositionClass(index: number) {
  if (getRealIndex(index) === previewPlayer.currentIndex.value) {
    return $style.current
  } else if (getRealIndex(index - 1) === previewPlayer.currentIndex.value) {
    return $style.next
  } else if (getRealIndex(index + 1) === previewPlayer.currentIndex.value) {
    return $style.prev
  } else if (getRealIndex(index - 2) === previewPlayer.currentIndex.value) {
    return $style.farNext
  } else if (getRealIndex(index + 2) === previewPlayer.currentIndex.value) {
    return $style.farPrev
  } else if (getRealIndex(index - 3) === previewPlayer.currentIndex.value) {
    return $style.farFarNext
  } else if (getRealIndex(index + 3) === previewPlayer.currentIndex.value) {
    return $style.farFarPrev
  } else {
    return $style.hidden
  }
}

const { controller } = accessController()

let ctx
const gsapScope = ref<null | HTMLElement>(null)
watch(gsapScope, (container) => {
  if (container) {
    ctx?.revert()
    ctx = gsap.context(() => {
      gsap.to(`.${$style.content}`, { opacity: 1, scale: 1, duration: 1, delay: 0.5 })
      gsap.to(`.${$style.video}`, { opacity: 0.5, duration: 1, delay: 2 })
    }, container)
  }
})

onUnmounted(() => {
  ctx?.revert()
})

watch(
  () =>
    controller.value?.dpad.left.pressed || (controller.value?.stick.left.horizontal ?? 0) < -0.5,
  (pressedLeft) => {
    if (pressedLeft) {
      prev()
    }
  }
)
watch(
  () =>
    controller.value?.dpad.right.pressed || (controller.value?.stick.left.horizontal ?? 0) > 0.5,
  (pressedRight) => {
    if (pressedRight) {
      next()
    }
  }
)

watch(
  () => controller.value && controller.value.buttons.a.pressed,
  (pressedA) => {
    if (pressedA) {
      startSong()
    }
  }
)

onKeyStroke(['ArrowLeft'], (event) => {
  event.preventDefault()
  prev()
})
onKeyStroke(['ArrowRight', 'Tab'], (event) => {
  event.preventDefault()
  next()
})
onKeyStroke(['Enter'], (event) => {
  event.preventDefault()
  startSong()
})

function startSong() {
  play('click')

  ctx?.add(() => {
    const t1 = gsap.timeline({ defaults: { overwrite: 'auto' }, delay: 0.4 })
    t1.to(`.${$style.current}`, { scale: 1.4, duration: 0.2, ease: 'power2.in' }, 0)
    t1.to(`.${$style.content}`, { opacity: 0, duration: 0.3 })
    t1.to(`.${$style.video}`, { opacity: 0, duration: 0.3 })
    t1.then(() => {
      router.push({
        path: '/song-player',
        query: { songIndex: previewPlayer.currentIndex.value }
      })
    })
  })
}

function fadeOut(callback: () => void) {
  if (gsapScope.value) {
    gsap.to(gsapScope.value, {
      opacity: 0,
      duration: 0.3,
      ease: 'power2.in',
      onComplete: callback
    })
  } else {
    callback()
  }
}

function prev() {
  previewPlayer.currentIndex.value = getRealIndex(previewPlayer.currentIndex.value - 1)
  play('hover')
}

function next() {
  previewPlayer.currentIndex.value = getRealIndex(previewPlayer.currentIndex.value + 1)
  play('hover')
}

function clickedCover(index: number) {
  if (index === previewPlayer.currentIndex.value) {
    startSong()
  } else {
    if (getRealIndex(index + 1) === previewPlayer.currentIndex.value) {
      prev()
    } else if (getRealIndex(index - 1) === previewPlayer.currentIndex.value) {
      next()
    } else if (getRealIndex(index + 2) === previewPlayer.currentIndex.value) {
      prev()
    } else if (getRealIndex(index - 2) === previewPlayer.currentIndex.value) {
      next()
    }
  }
}

function navigateToSearch() {
  play('click')
  fadeOut(() => {
    router.push({
      path: '/search',
      query: { songIndex: previewPlayer.currentIndex.value }
    })
  })
}

function jumpToRandomSong() {
  play('click')
  const randomIndex = Math.floor(Math.random() * (previewPlayer.songs?.value.length || 1))
  previewPlayer.currentIndex.value = randomIndex
}

const { settingsOpened } = useSettingsView()
function openSettings() {
  play('click')
  settingsOpened.value = true
}

const { refresh } = accessSongs()
function refreshSongs() {
  play('click')
  refresh()
}
</script>
<template>
  <main :class="$style.main" ref="gsapScope">
    <leave-popup :show="showExitPopup" @cancel="showExitPopup = false" />
    <div :class="$style.content">
      <div :class="$style.buttons">
        <div :class="$style.search" @click="navigateToSearch">
          <v-icon name="fa-search"></v-icon>
          Search
        </div>
        <div :class="$style.settings" @click="refreshSongs">
          <v-icon name="md-refresh"></v-icon>
        </div>
        <div :class="$style.settings" @click="openSettings">
          <v-icon name="md-settingssuggest"></v-icon>
        </div>
        <div :class="$style.settings" @click="jumpToRandomSong">
          <v-icon name="md-shuffle"></v-icon>
        </div>
      </div>
      <div :class="$style.carousel">
        <div
          v-for="(song, index) in previewPlayer.songs?.value"
          :key="index"
          :class="`${$style.song} ${getPositionClass(index)}`"
          @click="clickedCover(index)"
        >
          <div :class="$style.cover">
            <img
              :src="song.cover ? accessLocalFile(song.cover) : defaultCover"
              alt="Cover"
              :class="$style.coverImage"
            />
            <div :class="$style.playCount">
              <v-icon name="fa-play"></v-icon>
              {{ song.meta.playCount }}
            </div>
          </div>
        </div>
      </div>
      <div :class="$style.songDetails">
        <h2>{{ previewPlayer.currentSong.value?.title }}</h2>
        <p>{{ previewPlayer.currentSong.value?.artist }}</p>
        <div :class="$style.background"></div>
      </div>
    </div>
    <video :ref="previewPlayer.video" :class="$style.video" playsinline></video>
  </main>
</template>
<style lang="less" module>
.main {
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.6);
  user-select: none;
}

.content {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  overflow: hidden;
  transform: scale(0.8);
  opacity: 0;
}

.video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  position: fixed;
  top: 0;
  left: 0;
  z-index: -1;
  background-color: black;
  opacity: 0;
}

.carousel {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30rem;
  height: 30rem;
  position: relative;
  overflow: visible;
}

.song {
  position: absolute;
  transition: all 0.5s ease;
  cursor: pointer;

  .cover {
    box-sizing: border-box;
    width: 20rem;
    height: 20rem;
    overflow: hidden;

    transition: all 0.5s ease;
    border: 1rem solid transparent;
    border-radius: 1.5rem;

    .playCount {
      position: absolute;
      top: 1rem;
      left: 1rem;
      background-color: white;

      color: black;
      padding: 0.25rem 0.5rem;
      border-radius: 0.5rem;
      display: flex;
      align-items: center;
      gap: 0.25rem;
      opacity: 0;
      transition: opacity 0.3s ease;
      font-weight: bold;

      svg {
        width: 1rem;
        height: 1rem;
        fill: black;
      }
    }

    .coverImage {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }

  &.hidden {
    pointer-events: none;
    opacity: 0;
    transform: translateX(0) scale(0);
  }

  &.current {
    opacity: 1;
    z-index: 3;
    transform: translateX(0) scale(1);

    &:hover {
      .playCount {
        opacity: 1;
      }
    }

    .cover {
      border: 0.5rem solid white;
    }
  }

  &.prev,
  &.next {
    opacity: 0.8;
    z-index: 2;
  }

  &.prev {
    transform: translateX(-120%) scale(0.8);
  }

  &.next {
    transform: translateX(120%) scale(0.8);
  }

  &.farPrev,
  &.farNext {
    opacity: 0.5;
    z-index: 1;
  }

  &.farPrev {
    transform: translateX(-200%) scale(0.4);
  }

  &.farNext {
    transform: translateX(200%) scale(0.4);
  }

  &.farFarPrev,
  &.farFarNext {
    opacity: 0.3;
    z-index: 1;
  }

  &.farFarPrev {
    transform: translateX(-250%) scale(0.3);
  }

  &.farFarNext {
    transform: translateX(250%) scale(0.3);
  }
}

.songDetails {
  display: flex;
  width: 100%;
  height: 6rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 0.75rem;
  color: white;
  padding: 1rem;
  position: relative;

  .background {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 80%;
    max-width: 47rem;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(156, 98, 255, 0.8), transparent);
    z-index: -1;
  }

  h2 {
    font-size: 2.4rem;
    margin: 0;
  }

  p {
    font-size: 1.6rem;
    margin: 0;
  }
}

.buttons {
  position: fixed;
  top: 1rem;
  right: 1rem;
  z-index: 1;
  display: flex;
  gap: 1rem;
  flex-direction: row;

  .search,
  .settings {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background-color: rgba(255, 255, 255, 0.445);
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    outline: none;
    border: none;
    font-size: 1.2rem;
    font-weight: 300;
    cursor: pointer;
    font-weight: bold;
    color: black;

    svg {
      width: 2rem;
      height: 2rem;
      fill: black;
      color: black;
    }
  }
}
</style>
