<script setup lang="ts">
import { computed, provide, ref } from 'vue'
import { useBackgroundMusic } from './composables/useBackgroundMusic'
import { useController } from './composables/useController'
import PlayerSettings from './components/PlayerSettings.vue'
import { useSettings } from './composables/useSettings'
import { useSongs } from './composables/useSongs'
import { useRoute } from 'vue-router'
import UpdatePopup from './components/UpdatePopup.vue'

useController()
const settings = useSettings()
useBackgroundMusic(false, settings)
useSongs()

const settingsOpened = ref(false)
provide('settingsOpened', settingsOpened)

const route = useRoute()
const currentRouterPath = computed(() => {
  return route.path
})
</script>

<template>
  <update-popup v-if="currentRouterPath === '/song-list'" />
  <router-view></router-view>
  <player-settings v-if="settingsOpened" />
</template>
