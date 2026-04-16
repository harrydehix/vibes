<script setup lang="ts">
import PlayerPauseMenu from '@renderer/components/PlayerPauseMenu.vue'
import SimpleKaraokeLyrics from '@renderer/components/SimpleKaraokeLyrics.vue'
import { accessController } from '@renderer/composables/useController'
import { useVideoPlayer } from '@renderer/composables/useVideoPlayer'
import gsap from 'gsap'

import { onKeyStroke } from '@vueuse/core'
import { onMounted, onUnmounted, ref, useCssModule, watch } from 'vue'
import { useRoute } from 'vue-router'
import router from '@renderer/router'

/* songIndex is passed via route query, e.g. /song-player?songIndex=2 */

const route = useRoute()

onMounted(() => {
  const index = route.query.songIndex ? parseInt(route.query.songIndex as string) : 0
  player.currentIndex.value = index
  console.log('Playing song index:', index)
})

const { controller } = accessController()

// Hotkey zum ans Ende springen fürs Debuggen
// onKeyStroke(['End', 'e'], () => {
//   if (player.video.value && player.duration.value > 0) {
//     // Springe sicher an das Ende (Dauer abzüglich 2 Sekunden),
//     // um "ended" auszulösen und den Start-Bug abzufangen.
//     const time = player.duration.value - 2
//     console.log('Skipping to:', time)
//     player.seek(time)
//   }
// })

watch(
  () => controller.value?.start.pressed,
  (isPressed) => {
    if (isPressed) {
      togglePlayPause()
    }
  }
)
onKeyStroke(['Escape'], () => {
  togglePlayPause()
})

function togglePlayPause() {
  if (player.isPlaying.value) {
    player.pause()
  } else {
    player.play()
  }
}

const $style = useCssModule()
const player = useVideoPlayer()
const gsapScope = ref<null | HTMLElement>(null)
let ctx
watch([gsapScope, player.video], ([container, video]) => {
  if (container && video) {
    ctx?.revert()

    ctx = gsap.context(() => {
      video.oncanplay = () => {
        if (!player.isPlaying.value) {
          gsap.to(`.${$style.songArea}`, { opacity: 1, duration: 1, delay: 0.3 })
          player.play()
        }
      }
      video.onended = () => {
        animateOut().then(() => {
          router.push({
            path: '/song-list',
            query: {
              songIndex: player.currentIndex.value
            }
          })
        })
      }
    }, container)
  }
})

onUnmounted(() => {
  ctx?.revert()
})

async function animateOut() {
  return new Promise<void>((resolve) => {
    ctx?.add(() => {
      gsap.to(`.${$style.songArea}`, { opacity: 0, duration: 0.3 }).then(() => {
        ctx?.revert()
        resolve()
      })
    })
  })
}
</script>
<template>
  <div ref="gsapScope" :class="$style.gsapScope">
    <div :class="$style.songArea">
      <video :ref="player.video" playsinline :class="$style.videoPlayer"></video>
      <SimpleKaraokeLyrics />
      <PlayerPauseMenu :animation-before-leave="animateOut" />
    </div>
  </div>
</template>
<style lang="less" module>
.gsapScope {
  width: 100%;
  height: 100%;
}

.songArea {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  opacity: 0;
}

.videoPlayer {
  width: 100%;
  height: 100%;
  object-fit: cover;
  position: fixed;
  z-index: -1;
  top: 0;
  left: 0;
}
</style>
