<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue'
import { useBackgroundMusic } from './composables/useBackgroundMusic'
import { useController } from './composables/useController'
import PlayerSettings from './components/PlayerSettings.vue'
import { useSettings } from './composables/useSettings'
import { useSongManagement } from './composables/useSongManagement'
import { useUpdater } from './composables/useUpdater'
import { useRoute } from 'vue-router'
import UpdatePopup from './components/UpdatePopup.vue'
import YoutubeAuthPopup from './components/YoutubeAuthPopup.vue'

useController()
const settings = useSettings()
useBackgroundMusic(false, settings)
useSongManagement()
useUpdater()

const settingsOpened = ref(false)
provide('settingsOpened', settingsOpened)

const route = useRoute()
const currentRouterPath = computed(() => {
  return route.path
})
const youtubeAuthEnabled = ref(false)
watch(
  currentRouterPath,
  (path) => {
    if (path === '/song-list') youtubeAuthEnabled.value = true
  },
  { immediate: true }
)
</script>

<template>
  <update-popup v-if="currentRouterPath === '/song-list'" />
  <router-view></router-view>
  <player-settings v-if="settingsOpened" />
  <YoutubeAuthPopup v-if="youtubeAuthEnabled" />
</template>
