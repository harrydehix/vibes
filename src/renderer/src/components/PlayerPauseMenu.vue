<script setup lang="ts">
import { accessVideoPlayer } from '@renderer/composables/useVideoPlayer'
import { ref, watch } from 'vue'
import { accessLocalFile } from '@renderer/utils/accessLocalFile'
import PauseMenuItem from './PauseMenuItem.vue'
import { accessBackgroundMusic } from '@renderer/composables/useBackgroundMusic'
import { accessController } from '@renderer/composables/useController'
import router from '@renderer/router'
import { onKeyStroke } from '@vueuse/core'
import { useSettingsView } from '@renderer/composables/useSettingsView'
import { formatDuration } from '@renderer/utils/formatDuration'

const props = defineProps<{
  animationBeforeLeave: () => Promise<void>
}>()

const { controller } = accessController()
const player = accessVideoPlayer()
const { settingsOpened } = useSettingsView()

const activeIndex = ref(0)
const menu = {
  items: [
    { id: 'resume', text: 'Resume', icon: 'md-musicnote' },
    { id: 'restart', text: 'Restart', icon: 'md-restartalt-twotone' },
    { id: 'back-to-song-list', text: 'Back to song list', icon: 'md-queuemusic-outlined' },
    { id: 'settings', text: 'Settings', icon: 'md-settingssuggest' },
    { id: 'exit', text: 'Exit to desktop', icon: 'md-transitenterexit' },
    { id: 'edit', text: 'Edit', icon: 'md-edit', type: 'special' }
  ]
}
const menuItemRefs = ref<(HTMLButtonElement | null)[]>([])

watch(
  () =>
    controller.value &&
    (controller.value.dpad.down.pressed || controller.value.stick.left.vertical > 0.75),
  (isPressed) => {
    if (isPressed && player.pausedByUser.value) {
      activeIndex.value = (activeIndex.value + 1) % menu.items.length
    }
  }
)

watch(
  () =>
    controller.value &&
    (controller.value.dpad.up.pressed || controller.value.stick.left.vertical < -0.75),
  (isPressed) => {
    if (isPressed && player.pausedByUser.value) {
      activeIndex.value = (activeIndex.value - 1 + menu.items.length) % menu.items.length
    }
  }
)

onKeyStroke(['ArrowDown'], (event) => {
  if (!player.pausedByUser.value) return
  event.preventDefault()
  activeIndex.value = (activeIndex.value + 1) % menu.items.length
})
onKeyStroke(['ArrowUp'], (event) => {
  if (!player.pausedByUser.value) return
  event.preventDefault()
  activeIndex.value = (activeIndex.value - 1 + menu.items.length) % menu.items.length
})

watch(
  () => controller.value && controller.value.buttons.a.pressed,
  (isPressed) => {
    if (isPressed && player.pausedByUser.value) {
      menuItemRefs.value[activeIndex.value]?.click()
    }
  }
)

async function handleMenuItemClick(item: (typeof menu.items)[number]) {
  switch (item.id) {
    case 'resume':
      player.play()
      break
    case 'restart':
      await player.seek(0)
      player.play()
      break
    case 'back-to-song-list':
      await props.animationBeforeLeave()
      router.push({
        path: '/song-list',
        query: { songIndex: player.currentIndex.value }
      })
      break
    case 'settings':
      settingsOpened.value = true
      break
    case 'edit':
      alert('Song editor not implemented yet!')
      break
    case 'exit':
      window.close()
  }
}

watch(player.isPlaying, (isPlaying) => {
  if (!isPlaying) {
    backgroundMusic.enable()
  } else {
    backgroundMusic.disable()
  }
})

const backgroundMusic = accessBackgroundMusic()
</script>
<template>
  <div :class="`${$style.pauseMenu} ${!player.pausedByUser.value && $style.hidden}`">
    <div :class="$style.header">
      <v-icon name="md-pausecircle-sharp"></v-icon>
      Paused
    </div>
    <div :class="$style.songInfo">
      <img :src="accessLocalFile(player.currentSong.value?.cover!)" alt="Thumbnail" />
      <div :class="$style.songDetails">
        <h2>{{ player.currentSong.value?.title }}</h2>
        <h3>{{ player.currentSong.value?.artist }}</h3>
        <div :class="$style.songState">
          <span :class="$style.current">{{ formatDuration(player.currentTime.value) }}</span>
          <span>/</span>
          <span>{{ formatDuration(player.duration.value) }}</span>
        </div>
      </div>
    </div>
    <div :class="$style.progressContainer">
      <div
        :class="$style.progressBar"
        :style="{ width: `${(player.currentTime.value / player.duration.value) * 100}%` }"
      ></div>
    </div>
    <div :class="$style.menu">
      <PauseMenuItem
        v-for="(item, index) in menu.items.filter((i) => i.type !== 'special')"
        :key="item.id"
        :text="item.text"
        :icon="item.icon"
        :isActive="activeIndex === index"
        @click="handleMenuItemClick(item)"
        @focus="activeIndex = index"
        :ref="(e) => menuItemRefs.push(e as HTMLButtonElement | null)"
      />
    </div>
  </div>
</template>
<style lang="less" module>
.pauseMenu {
  position: fixed;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 10;
  backdrop-filter: blur(20px);
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  user-select: none;

  &.hidden {
    pointer-events: none;
    opacity: 0;
    backdrop-filter: blur(0px);
  }
}

.header {
  background-color: black;
  width: 100%;
  color: white;
  display: flex;
  align-items: center;
  flex-direction: row;
  padding: 1rem 2rem;
  font-size: 2rem;
  svg {
    width: 2.5rem;
    height: 2.5rem;
    margin-right: 1rem;
  }
}

.songInfo {
  display: flex;
  background-color: rgba(255, 255, 255, 0.11);
  flex-direction: row;
  gap: 1rem;
  padding: 2rem 4rem;

  img {
    width: 12rem;
    height: 12rem;
    object-fit: cover;
    border-radius: 8px;

    @media (max-height: 900px) {
      width: 10rem;
      height: 10rem;
    }

    @media (max-height: 800px) {
      width: 8rem;
      height: 8rem;
    }
  }

  .songDetails {
    color: white;
    margin-left: 2rem;
    display: flex;
    flex-direction: column;

    h2 {
      margin: 0;
      font-size: 4rem;
      font-weight: 600;
      padding: 0;

      @media (max-height: 900px) {
        font-size: 3.5rem;
      }

      @media (max-height: 800px) {
        font-size: 2.75rem;
      }
    }

    h3 {
      margin: 0;
      font-size: 2.2rem;
      font-weight: 300;

      @media (max-height: 900px) {
        font-size: 2rem;
      }

      @media (max-height: 800px) {
        font-size: 1.6rem;
      }
    }

    .songState {
      margin-top: auto;
      display: flex;
      flex-direction: row;
      gap: 0.5rem;
      background-color: black;
      border-radius: 1rem;
      padding: 0.5rem 1rem;
      width: fit-content;

      .current {
        font-weight: 800;
      }
    }
  }
}

.progressContainer {
  position: relative;
  width: 100%;
  height: 0.5rem;
  background-color: rgba(255, 255, 255, 0.3);

  .progressBar {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    background-color: #9c62ff;
  }
}

.menu {
  flex-grow: 1;
  width: 100%;
  display: flex;
  flex-direction: column;
  padding-left: 10rem;
  justify-content: center;
  gap: 2rem;
  box-sizing: border-box;

  @media (max-height: 1000px) {
    gap: 1.5rem;
  }

  // small height screens
  @media (max-height: 900px) {
    gap: 1rem;
  }

  @media (max-height: 800px) {
    gap: 0.75rem;
  }
}
</style>
