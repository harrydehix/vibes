<script setup lang="ts">
import LoadingSpinner from '@renderer/components/LoadingSpinner.vue'
import { accessBackgroundMusic } from '@renderer/composables/useBackgroundMusic'
import { accessController } from '@renderer/composables/useController'
import { accessSongs } from '@renderer/composables/useSongs'
import { useSound } from '@renderer/composables/useSound'
import { useYtdlp } from '@renderer/composables/useYtdlp'
import router from '@renderer/router'
import gsap from 'gsap'
import { onUnmounted, ref, useCssModule, watch } from 'vue'
import { toast } from 'vue3-toastify'
import logoHarrydehix from '@renderer/assets/harrydehix.svg'
import 'vue3-toastify/dist/index.css'
import { onKeyStroke } from '@vueuse/core'

let ctx
let transitionTimeout: ReturnType<typeof setTimeout> | null = null
const containerRef = ref<HTMLElement | null>(null)
const style = useCssModule()
const animationCompleted = ref(false)
const { controller } = accessController()
const loading = ref(false)

const currentAnimation = ref<gsap.core.Timeline | null>(null)
const { songs, refresh } = accessSongs()
const ytdlp = useYtdlp()

const { play } = useSound()

const { enable } = accessBackgroundMusic()

watch(containerRef, (container) => {
  if (container) {
    ctx?.revert()
    ctx = gsap.context(() => {
      const tl = gsap
        .timeline({ defaults: { ease: 'power1.inOut' } })
        // fade copyright screen in and out
        .to(`.${style.copyrightScreen}`, { opacity: 1, duration: 1, delay: 1 })
        .to(`.${style.copyrightScreen}`, { opacity: 0, duration: 1 }, '+=2')
        .set(`.${style.copyrightScreen}`, { display: 'none' })
        // fade logo screen in and out
        .to(`.${style.logoScreen}`, { opacity: 1, duration: 1 }, '-=0.5')
        .to(`.${style.logoScreen}`, { opacity: 0, duration: 1 }, '+=2')
        .call(() => {
          enable()
        })
        .set(`.${style.logoScreen}`, { display: 'none' })
        .fromTo(
          `.${style.logo}`,
          { opacity: 0, scale: 0 },
          { opacity: 1, scale: 1, duration: 1, delay: 1, ease: 'back.out(1.7)' }
        )
        .to(`.${style.subtitle}`, { opacity: 0.4, duration: 0.5 }, '-=0.5')
        .call(() => {
          animationCompleted.value = true
        })
        .to(`.${style.logo}`, {
          textShadow: `
        0 0 400px #a26cff,
        0 0 800px #a26cff,
        0 0 30px rgba(255, 255, 255, 0.178)`,
          duration: 2
        })
        .to(`.${style.subtitle}`, {
          opacity: 0.1,
          duration: 1.5,
          repeat: -1,
          yoyo: true
        })
      tl.play()
      currentAnimation.value = tl
    }, container)
  }
})

onUnmounted(() => {
  if (transitionTimeout) clearTimeout(transitionTimeout)
  ctx?.revert()
  ctx = null
})

onKeyStroke(() => {
  if (animationCompleted.value) {
    toSongList()
  }
})

function toSongList() {
  if (animationCompleted.value) {
    currentAnimation.value?.kill()
    currentAnimation.value = null

    play('click')
    loadSongs()
  }
}

async function loadSongs() {
  if (loading.value) return
  loading.value = true

  ctx?.add(() => {
    gsap.timeline().to(`.${style.subtitle}`, { opacity: 1, duration: 0.3 })
  })

  const success = await ytdlp.ensureInstalled()
  if (!success) {
    toast.error(
      'Failed to ensure yt-dlp is installed. Please check the console for more details.',
      {
        theme: 'dark',
        autoClose: 2000,
        style: {
          fontFamily: 'Outfit, sans-serif',
          fontSize: '1rem',
          fontWeight: '700',
          width: 'fit-content'
        }
      }
    )
    loading.value = false
    return
  }
  await refresh()
  await new Promise((resolve) => {
    transitionTimeout = setTimeout(resolve, 1000)
  })

  if (!ctx) return // Prevent continuing if component unmounted

  ctx.add(() => {
    const tl = gsap.timeline()
    tl.to(`.${style.logo}`, { opacity: 0, duration: 0.5 }).to(`.${style.subtitle}`, {
      opacity: 0,
      scale: 0,
      duration: 0.5
    })
    tl.then(() => {
      if (songs.value.length > 0) {
        router.push('/song-list')
      } else {
        router.push('/search')
      }
    })
  })
}

watch(
  () =>
    controller.value && Object.values(controller.value.buttons).some((button) => button.pressed),
  (isPressed) => {
    if (isPressed) {
      toSongList()
    }
  }
)
</script>

<template>
  <div ref="containerRef">
    <section :class="$style.copyrightScreen">
      <p style="width: 50%; opacity: 0.8">
        This software is provided as is, without any warranties. It is intended for personal use
        only. Distributing or selling without permission is strictly prohibited.
      </p>
    </section>
    <section :class="$style.logoScreen">
      <img :src="logoHarrydehix" alt="Harrydehix Logo" />
    </section>
    <section :class="$style.endScreen" @click="toSongList">
      <h1 :class="$style.logo">vibes</h1>
      <div :class="$style.subtitle">
        <template v-if="loading"> <LoadingSpinner /> Loading </template>
        <template v-else>press any key</template>
      </div>
    </section>
  </div>
</template>

<style lang="less" module>
.logoScreen {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background-color: black;
  text-align: center;
  position: fixed;
  top: 0;
  left: 0;
  opacity: 0;
  z-index: 1000;

  img {
    width: 40rem;
  }
}
.copyrightScreen {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background-color: black;
  color: white;
  font-family: 'Outfit', sans-serif;
  font-size: 2.5rem;
  z-index: 99;
  text-align: center;
  position: fixed;
  top: 0;
  left: 0;
  opacity: 0;
  z-index: 999;
}

.endScreen {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background-color: black;
  cursor: pointer;
  user-select: none;
  overflow: hidden;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 998;
}

.logo {
  font-family: 'Playball', cursive;
  font-size: 18rem;
  color: white;
  font-weight: 400;
  scale: 0;
  opacity: 0;
  text-shadow: none;
}

.subtitle {
  font-family: 'Outfit', sans-serif;
  font-size: 2.5rem;
  font-weight: 100;
  color: rgba(255, 255, 255, 1);
  margin-top: 2rem;
  opacity: 0;
  display: flex;
  flex-direction: row;
  gap: 2rem;
  align-items: center;
  justify-content: center;
}
</style>
