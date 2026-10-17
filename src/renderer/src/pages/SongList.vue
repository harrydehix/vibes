<script setup lang="ts">
import LeavePopup from '@renderer/components/LeavePopup.vue'
import Popup from '@renderer/components/Popup.vue'
import { accessBackgroundMusic } from '@renderer/composables/useBackgroundMusic'
import { accessController } from '@renderer/composables/useController'
import { usePreviewPlayer } from '@renderer/composables/usePreviewPlayer'
import { useSettingsView } from '@renderer/composables/useSettingsView'
import { accessSongManagement } from '@renderer/composables/useSongManagement'
import { getApiErrorCode, getApiErrorMessage } from '@shared/errors'
import { useSound } from '@renderer/composables/useSound'
import router from '@renderer/router'
import { accessLocalFile } from '@renderer/utils/accessLocalFile'
import { onKeyStroke } from '@vueuse/core'
import gsap from 'gsap'
import { computed, onMounted, onUnmounted, ref, useCssModule, watch } from 'vue'
import type { Song } from '@shared/types'
import { useRoute } from 'vue-router'
import defaultCover from '@renderer/assets/cover-fallback.png'

const showExitPopup = ref(false)
const songToDelete = ref<Song | null>(null)
const deleting = ref(false)
const deletionError = ref('')
let deleteOpener: HTMLElement | null = null
onKeyStroke('Escape', () => {
  if (songToDelete.value) {
    closeDelete()
    return
  }
  showExitPopup.value = true
  console.log('Showing exit popup')
})

const route = useRoute()
const { songs, getSongs, deleteSong } = accessSongManagement()
const artistCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
const displayedSongs = computed(() =>
  [...songs.value].sort(
    (first, second) =>
      artistCollator.compare(first.artist, second.artist) ||
      artistCollator.compare(first.title, second.title)
  )
)

const previewPlayer = usePreviewPlayer(
  route.query.songIndex
    ? parseInt(route.query.songIndex as string)
    : (displayedSongs.value[0]?.index ?? 0)
)
const carouselIndex = computed(() =>
  displayedSongs.value.findIndex(
    (song) => song.meta.id === previewPlayer.currentSong.value?.meta.id
  )
)
watch(displayedSongs, (newSongs, previousSongs) => {
  if (!previousSongs.length && newSongs.length && !route.query.songIndex) {
    previewPlayer.currentIndex.value = newSongs[0].index
  }
})
const backgroundMusic = accessBackgroundMusic()
onMounted(() => {
  backgroundMusic.disable()
})
const $style = useCssModule()
const { play } = useSound()

function getRealIndex(index: number) {
  if (index < 0) {
    index = displayedSongs.value.length + index
  }
  return index % (displayedSongs.value.length || 1)
}

function getPositionClass(index: number) {
  if (getRealIndex(index) === carouselIndex.value) {
    return $style.current
  } else if (getRealIndex(index - 1) === carouselIndex.value) {
    return $style.next
  } else if (getRealIndex(index + 1) === carouselIndex.value) {
    return $style.prev
  } else if (getRealIndex(index - 2) === carouselIndex.value) {
    return $style.farNext
  } else if (getRealIndex(index + 2) === carouselIndex.value) {
    return $style.farPrev
  } else if (getRealIndex(index - 3) === carouselIndex.value) {
    return $style.farFarNext
  } else if (getRealIndex(index + 3) === carouselIndex.value) {
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
  if (songToDelete.value) return
  event.preventDefault()
  prev()
})
onKeyStroke(['ArrowRight', 'Tab'], (event) => {
  if (songToDelete.value) return
  event.preventDefault()
  next()
})
onKeyStroke(['Enter'], (event) => {
  if (songToDelete.value || (event.target instanceof HTMLElement && event.target.closest('button')))
    return
  event.preventDefault()
  startSong()
})

onKeyStroke('Delete', (event) => {
  if (songToDelete.value || !previewPlayer.currentSong.value) return
  event.preventDefault()
  openDelete(previewPlayer.currentSong.value)
})

function startSong() {
  if (songToDelete.value || !previewPlayer.currentSong.value) return
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
  if (songToDelete.value) return
  const song = displayedSongs.value[getRealIndex(carouselIndex.value - 1)]
  if (!song) return
  previewPlayer.currentIndex.value = song.index
  play('hover')
}

function next() {
  if (songToDelete.value) return
  const song = displayedSongs.value[getRealIndex(carouselIndex.value + 1)]
  if (!song) return
  previewPlayer.currentIndex.value = song.index
  play('hover')
}

function clickedCover(index: number) {
  if (index === carouselIndex.value) {
    startSong()
  } else {
    if (getRealIndex(index + 1) === carouselIndex.value) {
      prev()
    } else if (getRealIndex(index - 1) === carouselIndex.value) {
      next()
    } else if (getRealIndex(index + 2) === carouselIndex.value) {
      prev()
    } else if (getRealIndex(index - 2) === carouselIndex.value) {
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
  const song = displayedSongs.value[Math.floor(Math.random() * displayedSongs.value.length)]
  if (!song) return
  play('click')
  previewPlayer.currentIndex.value = song.index
}

const { settingsOpened } = useSettingsView()
function openSettings() {
  play('click')
  settingsOpened.value = true
}

function refreshSongs() {
  play('click')
  void getSongs().catch((error) => console.error('Could not refresh songs:', error))
}

function deleteFocusFallback(): HTMLElement | null | undefined {
  return deleteOpener?.isConnected
    ? deleteOpener
    : gsapScope.value?.querySelector<HTMLButtonElement>(`.${$style.current} button`)
}

function openDelete(song: Song, event?: MouseEvent): void {
  if (deleting.value) return
  play('click')
  const opener = event?.currentTarget ?? document.activeElement
  deleteOpener = opener instanceof HTMLElement ? opener : null
  deletionError.value = ''
  songToDelete.value = song
}

function closeDelete(): void {
  if (deleting.value) return
  songToDelete.value = null
  deletionError.value = ''
}

async function confirmDelete(): Promise<void> {
  if (!songToDelete.value || deleting.value) return
  deleting.value = true
  deletionError.value = ''
  previewPlayer.stop()
  try {
    await deleteSong(songToDelete.value.meta.id)
    songToDelete.value = null
    if (!songs.value.length) await router.replace({ path: '/search' })
  } catch (error) {
    console.error('Song deletion failed:', error)
    deletionError.value = getApiErrorMessage(getApiErrorCode(error))
    void previewPlayer.reload()
  } finally {
    deleting.value = false
  }
}
</script>
<template>
  <main :class="$style.main" ref="gsapScope">
    <leave-popup :show="showExitPopup" @cancel="showExitPopup = false" />
    <Teleport to="body">
      <Popup
        v-if="songToDelete"
        title="Delete song?"
        icon="io-trash-bin-sharp"
        initial-focus="cancel"
        :fallback-focus="deleteFocusFallback"
        :visible="true"
        :okText="deleting ? 'Deleting...' : 'Delete'"
        okIcon="io-trash-bin-sharp"
        :okDisabled="deleting"
        cancelText="Cancel"
        cancelIcon="io-close-sharp"
        :cancelDisabled="deleting"
        @ok="confirmDelete"
        @cancel="closeDelete"
      >
        <p v-if="deletionError" :class="$style.deletionError" role="alert">{{ deletionError }}</p>
      </Popup>
    </Teleport>
    <div :class="$style.content" :inert="!!songToDelete">
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
          v-for="(song, index) in displayedSongs"
          :key="song.meta.id"
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
            <button
              v-if="index === carouselIndex"
              type="button"
              :class="$style.deleteButton"
              :aria-label="`Delete ${song.title} by ${song.artist}`"
              title="Delete song"
              @click.stop="openDelete(song, $event)"
            >
              <v-icon name="io-trash-bin-sharp" aria-hidden="true" />
            </button>
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

    &:hover,
    &:focus-within {
      .playCount,
      .deleteButton {
        opacity: 1;
      }
      .deleteButton {
        pointer-events: auto;
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

.deleteButton {
  position: absolute;
  top: 1rem;
  right: 1rem;
  width: 2rem;
  height: 2rem;
  padding: 0.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 0.5rem;
  background: white;
  color: black;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.3s ease,
    background-color 0.2s;
  cursor: pointer;
  svg {
    width: 1.25rem;
    height: 1.25rem;
  }
  &:hover {
    background: #ffc2b8;
    color: #8b1e1e;
  }
  &:focus-visible {
    outline: 2px solid #eacb69;
    outline-offset: 2px;
  }
}

.deletionError {
  color: #ffc2b8;
  overflow-wrap: anywhere;
  margin: 0;
}

@media (hover: none) {
  .song.current .deleteButton {
    opacity: 1;
    pointer-events: auto;
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
