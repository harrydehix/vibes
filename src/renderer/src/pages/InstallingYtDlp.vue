<template>
  <div class="installing-container">
    <LoadingSpinner />
    <h1>Installing dependencies</h1>
    <p>Please wait while yt-dlp is being installed.</p>
  </div>
</template>

<script setup lang="ts">
import LoadingSpinner from '@renderer/components/LoadingSpinner.vue'

// Das Design kannst du hier selbst anpassen
</script>

<style scoped>
.installing-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background-color: black;
  color: #ffffff;
  font-family: 'Outfit', sans-serif;
  user-select: none;
  cursor: wait;
}
</style>
