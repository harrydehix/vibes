<script setup lang="ts">
import { useSettingsView } from '@renderer/composables/useSettingsView'
import Slider from './Slider.vue'
import { accessSettings } from '@renderer/composables/useSettings'
import { onMounted, onUnmounted, watch, ref } from 'vue'
import Folders from './Folders.vue'
import gsap from 'gsap'
import { useSound } from '@renderer/composables/useSound'

const { settingsOpened } = useSettingsView()
const { settings, update } = accessSettings()

const { play } = useSound()

watch(
  settings,
  (newSettings) => {
    if (newSettings) {
      update()
    }
  },
  { deep: true }
)

const settingsRef = ref<HTMLElement | null>(null)
let ctx: gsap.Context
let tl: gsap.core.Timeline

onMounted(() => {
  if (!settingsRef.value) return
  ctx = gsap.context(() => {
    tl = gsap.timeline()
    tl.from(settingsRef.value, { opacity: 0, duration: 0.2 })
  }, settingsRef.value)
})

onUnmounted(() => {
  ctx?.revert()
})

function closeSettings() {
  play('click')
  if (tl) {
    tl.reverse().then(() => {
      settingsOpened.value = false
    })
  } else {
    settingsOpened.value = false
  }
}
</script>
<template>
  <div ref="settingsRef" :class="$style.settings" v-if="settingsOpened && settings">
    <div :class="$style.header">
      <v-icon name="md-settingssuggest"></v-icon>
      Settings
    </div>
    <div :class="$style.settingsBox">
      <div :class="$style.settingsMenu">
        <h2>Sound</h2>
        <div :class="$style.settingsItem">
          <span>Music</span>
          <Slider
            :min="0"
            :max="1"
            :default-value="0.5"
            :showValue="true"
            :formatValue="(v) => Math.round(v * 100) + '%'"
            v-model="settings!.musicVolume"
          />
        </div>
        <div :class="$style.settingsItem">
          <span>Effects</span>
          <Slider
            :min="0"
            :max="1"
            :default-value="0.5"
            :showValue="true"
            :formatValue="(v) => Math.round(v * 100) + '%'"
            v-model="settings!.sfxVolume"
          />
        </div>
      </div>
      <div :class="$style.settingsMenu">
        <h2>Game</h2>
        <div :class="$style.settingsItem">
          <span>Sync Time</span>
          <Slider
            :min="-1500"
            :max="+500"
            :step="1"
            :default-value="-100"
            :showValue="true"
            :formatValue="(v) => v + 'ms'"
            v-model="settings!.syncOffsetMs"
          />
        </div>
        <div :class="$style.settingsItem">
          <span>Font Scale</span>
          <Slider
            :min="0.5"
            :max="2"
            :default-value="1"
            :showValue="true"
            :formatValue="(v) => Math.round(v * 100) + '%'"
            v-model="settings!.lyricsFontScale"
          />
        </div>
      </div>
      <div
        :class="$style.settingsMenu"
        :style="{
          gridColumnStart: 1,
          gridColumnEnd: 3
        }"
      >
        <h2>Song Sources</h2>
        <Folders v-model="settings!.songFolders" />
      </div>
      <div :class="$style.goBack">
        <button @click="closeSettings">
          <v-icon name="ri-arrow-go-back-line"></v-icon>
          Go back
        </button>
      </div>
    </div>
  </div>
</template>
<style lang="less" module>
.settings {
  position: fixed;
  z-index: 999999;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.8);
  top: 0;
  left: 0;
  backdrop-filter: blur(30px);
  user-select: none;
  display: flex;
  flex-direction: column;
}

.settingsBox {
  padding: 2rem;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2rem;
  grid-template-rows: auto auto 1fr;
  height: 100%;
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

.settingsMenu {
  display: flex;
  padding: 1.7rem;
  background-color: rgba(255, 255, 255, 0.11);
  flex-direction: column;
  gap: 1rem;
  border-radius: 1.5rem;

  h2 {
    color: white;
    margin: 0;
    font-size: 2rem;
    font-weight: 500;
  }

  .settingsItem {
    display: grid;
    grid-template-columns: 9rem auto;
    align-items: center;
    padding: 0.75rem 1.25em;
    background-color: rgba(255, 255, 255, 0.11);
    border-radius: 8px;

    span {
      color: white;
      font-size: 1.5rem;
    }
  }
}

.goBack {
  width: 100%;
  grid-column-start: 1;
  grid-column-end: 3;
  grid-row: 3;
  display: flex;

  button {
    width: 100%;
    height: fit-content;
    margin-top: auto;
    display: flex;
    align-items: center;
    gap: 0.8rem;
    border-radius: 1rem;
    outline: none;
    border: none;
    font-size: 1.7rem;
    font-weight: 600;
    color: rgba(0, 0, 0, 0.664);

    background-color: #ffffff;
    padding: 1rem 1.25rem;
    color: black;
    cursor: pointer;

    svg {
      width: 1.5rem;
      height: 1.5rem;
      path:nth-child(2) {
        stroke-width: 2px;
        stroke: black;
      }
    }
  }
}
</style>
