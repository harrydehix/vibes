<script setup lang="ts">
import { provide, ref } from 'vue'
import { useBackgroundMusic } from './composables/useBackgroundMusic'
import { useController } from './composables/useController'
import PlayerSettings from './components/PlayerSettings.vue'
import { useSettings } from './composables/useSettings'
import { useSongs } from './composables/useSongs'

useController()
const settings = useSettings()
useBackgroundMusic(false, settings)
useSongs()

const settingsOpened = ref(false)
provide('settingsOpened', settingsOpened)

// onKeyDown('Control', () => {
//   settingsOpened.value = !settingsOpened.value
// })
</script>

<template>
  <!-- <SpatialDemo /> -->
  <router-view></router-view>
  <player-settings v-if="settingsOpened" />
</template>
