<script setup lang="ts">
import { useSettingsView } from '@renderer/composables/useSettingsView'
import Slider from './Slider.vue'
import { accessSettings } from '@renderer/composables/useSettings'
import { onMounted, onUnmounted, watch, ref } from 'vue'
import Folders from './Folders.vue'
import gsap from 'gsap'
import { useSound } from '@renderer/composables/useSound'
import type { YoutubeAuthStatus } from '@shared/types'
import YoutubeAuthPopup from './YoutubeAuthPopup.vue'
import { useYoutubeAuth } from '@renderer/composables/useYoutubeAuth'

const { settingsOpened } = useSettingsView()
const { settings, update } = accessSettings()
const youtubeAuthOpened = ref(false)
const youtubeAuth = useYoutubeAuth()
const youtubeStatus = ref<YoutubeAuthStatus | null>(null)
const youtubeError = ref<string | null>(null)
const youtubeBusy = ref(false)
let unsubscribeYoutube: (() => void) | undefined
let active = true
let youtubeChanges = 0

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
  unsubscribeYoutube = youtubeAuth.onChanged((status) => {
    youtubeChanges++
    youtubeStatus.value = status
  })
  const version = youtubeChanges
  void youtubeAuth
    .status()
    .then((status) => {
      if (active && youtubeChanges === version) youtubeStatus.value = status
    })
    .catch(() => {
      if (active) youtubeError.value = 'Could not check your YouTube session.'
    })
  if (!settingsRef.value) return
  ctx = gsap.context(() => {
    tl = gsap.timeline()
    tl.from(settingsRef.value, { opacity: 0, duration: 0.2 })
  }, settingsRef.value)
})

onUnmounted(() => {
  active = false
  unsubscribeYoutube?.()
  ctx?.revert()
})

async function signOutYoutube(): Promise<void> {
  if (youtubeBusy.value) return
  youtubeBusy.value = true
  youtubeError.value = null
  try {
    if (settings.value) settings.value.youtubeSignInDismissed = true
    if (!(await update({ youtubeSignInDismissed: true }))) return
    const status = await youtubeAuth.signOut()
    if (active) youtubeStatus.value = status
  } catch {
    if (active) youtubeError.value = 'Could not sign out of YouTube.'
  } finally {
    youtubeBusy.value = false
  }
}

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
        <div :class="$style.settingsItem">
          <span>Alignment</span>
          <div :class="$style.alignmentControl" role="group" aria-label="Lyrics alignment">
            <label :class="$style.alignmentOption" title="Left-aligned lyrics">
              <input
                v-model="settings!.lyricsAlignment"
                type="radio"
                name="lyrics-alignment"
                value="left"
                aria-label="Left-aligned lyrics"
              />
              <v-icon name="md-formatalignleft" aria-hidden="true" />
            </label>
            <label :class="$style.alignmentOption" title="Centered lyrics">
              <input
                v-model="settings!.lyricsAlignment"
                type="radio"
                name="lyrics-alignment"
                value="center"
                aria-label="Centered lyrics"
              />
              <v-icon name="md-formataligncenter" aria-hidden="true" />
            </label>
          </div>
        </div>
      </div>
      <div :class="[$style.settingsMenu, $style.wideMenu]">
        <h2>Song Sources</h2>
        <Folders v-model="settings!.songFolders" />
      </div>
      <div :class="[$style.settingsMenu, $style.youtubeMenu]">
        <h2>YouTube Account</h2>
        <div :class="$style.youtubeControls">
          <span>{{ youtubeStatus?.authenticated ? 'Signed in' : 'Not signed in (optional)' }}</span>
          <button @click="youtubeAuthOpened = true">
            <v-icon name="fa-youtube" />
            Manage account
          </button>
          <button
            v-if="youtubeStatus?.authenticated"
            :disabled="youtubeBusy"
            @click="signOutYoutube"
          >
            <v-icon name="md-exittoapp-outlined" />
            Sign out
          </button>
        </div>
        <p
          v-if="youtubeError || youtubeStatus?.message"
          :class="$style.youtubeMessage"
          role="status"
        >
          {{ youtubeError || youtubeStatus?.message }}
        </p>
      </div>
      <div :class="[$style.settingsMenu, $style.wideMenu]">
        <h2>Performance</h2>
        <div :class="`${$style.settingsItem} ${$style.checkboxItem}`">
          <span>Low Performance Mode</span>
          <input type="checkbox" v-model="settings!.lowPerformanceMode" />
        </div>
      </div>
    </div>
    <div :class="$style.goBack">
      <button @click="closeSettings">
        <v-icon name="ri-arrow-go-back-line"></v-icon>
        Go back
      </button>
    </div>
    <YoutubeAuthPopup v-if="youtubeAuthOpened" manual @close="youtubeAuthOpened = false" />
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
  overflow: hidden;
  box-sizing: border-box;
}

.settingsBox {
  padding: 2rem;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2rem;
  align-content: start;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;

  &::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
    margin: 1rem 0;
  }

  &::-webkit-scrollbar-thumb {
    min-height: 32px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.18);

    &:hover {
      background: rgba(255, 255, 255, 0.35);
    }

    &:active {
      background: rgba(255, 255, 255, 0.5);
    }
  }

  &::-webkit-scrollbar-button {
    display: none;
  }

  &::-webkit-scrollbar-corner {
    background: transparent;
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
  box-sizing: border-box;
  flex-shrink: 0;
  svg {
    width: 2.5rem;
    height: 2.5rem;
    margin-right: 1rem;
  }
}

.settingsMenu {
  display: flex;
  min-width: 0;
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

    &.checkboxItem {
      grid-template-columns: auto 2rem;

      // modern styled checkbox
      input {
        width: 1.5rem;
        height: 1.5rem;
        cursor: pointer;
        margin: 0;
        accent-color: #d3d3d3;
        outline: none;
        border-radius: 0.54rem;
      }
    }

    span {
      color: white;
      font-size: 1.5rem;
    }
  }
}

.alignmentControl {
  display: flex;
  gap: 0.25rem;
}

.alignmentOption {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3.25rem;
  height: 3rem;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.25);
  color: white;

  input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  svg {
    width: 1.5rem;
    height: 1.5rem;
    pointer-events: none;
  }

  &:has(input:checked) {
    background: white;
    color: black;
  }

  &:has(input:focus-visible) {
    outline: 2px solid #9c62ff;
    outline-offset: 2px;
  }
}

.wideMenu,
.youtubeMenu {
  grid-column: 1 / -1;
}

.youtubeControls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  color: white;

  span {
    margin-right: auto;
    font-size: 1.25rem;
  }

  button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border: none;
    border-radius: 0.5rem;
    background: white;
    color: black;
    font-size: 1.1rem;
    cursor: pointer;

    svg {
      width: 1.25rem;
      height: 1.25rem;
    }
  }
}

.youtubeMessage {
  margin: 0;
  color: white;
  overflow-wrap: anywhere;
}

.goBack {
  width: 100%;
  display: flex;
  flex-shrink: 0;
  padding: 1rem 2rem 2rem;
  box-sizing: border-box;
  background-color: rgba(0, 0, 0, 0.4);
  border-top: 1px solid rgba(255, 255, 255, 0.1);

  button {
    width: 100%;
    height: fit-content;
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

@media (max-width: 760px) {
  .settingsBox {
    grid-template-columns: minmax(0, 1fr);
    padding: 1rem;
    gap: 1rem;
  }

  .header,
  .goBack {
    padding: 1rem;
  }

  .settingsMenu {
    padding: 1rem;

    .settingsItem {
      grid-template-columns: minmax(0, 1fr);
      gap: 0.75rem;

      &.checkboxItem {
        grid-template-columns: minmax(0, 1fr) 2rem;
      }
    }
  }
}
</style>
