<script setup lang="ts">
import LoadingSpinner from '@renderer/components/LoadingSpinner.vue'
import { accessBackgroundMusic } from '@renderer/composables/useBackgroundMusic'
import { accessController } from '@renderer/composables/useController'
import { accessSongs } from '@renderer/composables/useSongs'
import { useSound } from '@renderer/composables/useSound'
import router from '@renderer/router'
import gsap from 'gsap'
import { onUnmounted, ref, useCssModule, watch, onMounted } from 'vue'
import logoHarrydehix from '@renderer/assets/harrydehix.svg'
import 'vue3-toastify/dist/index.css'
import { onKeyStroke, useMouse } from '@vueuse/core'
import { useIntroMusic } from '@renderer/composables/useIntroMusic'
import { accessSettings } from '@renderer/composables/useSettings'

let ctx
let transitionTimeout: ReturnType<typeof setTimeout> | null = null
const containerRef = ref<HTMLElement | null>(null)
const style = useCssModule()
const animationCompleted = ref(false)
const { controller } = accessController()
const loading = ref(false)

const currentAnimation = ref<gsap.core.Timeline | null>(null)
const { songs, refresh } = accessSongs()

const { play, pause } = useSound()

const { enable: enableBackgroundMusic } = accessBackgroundMusic()
const settings = accessSettings()
const { enable: enableIntroMusic, disable: disableIntroMusic } = useIntroMusic(false, settings)

const stars = Array.from({ length: 80 }).map(() => ({
  left: Math.random() * 100 + '%',
  top: Math.random() * 100 + '%',
  size: Math.random() * 2 + 1 + 'px',
  animationDelay: Math.random() * 5 + 's',
  animationDuration: Math.random() * 4 + 3 + 's',
  x: (Math.random() - 0.5) * 30 + 'px',
  y: (Math.random() - 0.5) * 30 + 'px'
}))

const shootingStars = Array.from({ length: 15 }).map((_, i) => ({
  left: Math.random() * 100 + 'vw',
  top: Math.random() * 70 - 20 + 'vh',
  delay: i * 2 + Math.random() * 5 + 's',
  duration: Math.random() * 15 + 15 + 's',
  distance: Math.random() * 50 + 30 + 'vw',
  tailLength: Math.random() * 80 + 50 + 'px',
  opacity: Math.random() * 0.4 + 0.4
}))

const { x: mouseX, y: mouseY } = useMouse()
const starElements = ref<HTMLElement[]>([])

const starsState = stars.map((s) => ({
  x: 0,
  y: 0,
  baseLeft: parseFloat(s.left) / 100,
  baseTop: parseFloat(s.top) / 100
}))

const updateStars = () => {
  const mx = mouseX.value
  const my = mouseY.value
  const ww = window.innerWidth
  const wh = window.innerHeight
  const maxDist = 900

  starElements.value.forEach((el, i) => {
    if (!el) return
    const sx = starsState[i].baseLeft * ww
    const sy = starsState[i].baseTop * wh
    const dx = mx - (sx + starsState[i].x)
    const dy = my - (sy + starsState[i].y)
    const dist = Math.sqrt(dx * dx + dy * dy)

    let targetX = 0
    let targetY = 0

    if (dist < maxDist && dist > 0) {
      const force = (maxDist - dist) / maxDist
      targetX = -(dx / dist) * force * 100
      targetY = -(dy / dist) * force * 100
    }

    starsState[i].x += (targetX - starsState[i].x) * 0.08
    starsState[i].y += (targetY - starsState[i].y) * 0.08

    el.style.transform = `translate(${starsState[i].x}px, ${starsState[i].y}px)`
  })
}

onMounted(() => {
  gsap.ticker.add(updateStars)
})

watch(containerRef, (container) => {
  if (container) {
    ctx?.revert()
    ctx = gsap.context(() => {
      enableIntroMusic()
      const tl = gsap
        .timeline({ defaults: { ease: 'power1.inOut' } })
        // fade copyright screen in and out
        .to(`.${style.copyrightScreen}`, { opacity: 1, duration: 1, delay: 1 })
        .to(`.${style.copyrightScreen}`, { opacity: 0, duration: 1 }, '+=2')
        .set(`.${style.copyrightScreen}`, { display: 'none' })
        // fade logo screen in and out
        .to(`.${style.logoScreen}`, { opacity: 1, duration: 1 }, '-=0.5')
        .to(`.${style.logoScreen}`, { opacity: 0, duration: 1 }, '+=2')
        .set(`.${style.logoScreen}`, { display: 'none' })
        .addLabel('logoIntro')
        .to(`.${style.starsContainer}`, { opacity: 1, duration: 4 }, 'logoIntro+=0.5')
        .call(
          () => {
            play('intro-cinematic')
          },
          undefined,
          'logoIntro+=1'
        )
        .fromTo(
          `.${style.logo} .letter`,
          { opacity: 0, scale: 0, display: 'inline-block' },
          { opacity: 1, scale: 1, duration: 1, ease: 'back.out(2)', stagger: 0.15 },
          'logoIntro+=1'
        )
        .to(`.${style.subtitle}`, { opacity: 0.4, duration: 0.5 }, '-=0.5')
        .call(() => {
          animationCompleted.value = true
        })
        .to(
          `.${style.logoGlow}`,
          {
            keyframes: [
              { opacity: 0.4, scale: 1.05, duration: 0.6, ease: 'power2.out' },
              { opacity: 0.4, scale: 1, duration: 1.2, ease: 'power2.inOut' }
            ]
          },
          'logoIntro+=1'
        )
        .to(
          `.${style.logo} .letter`,
          {
            keyframes: [
              { scale: 1.15, rotation: 8, duration: 0.8, ease: 'sine.inOut' },
              { scale: 1, rotation: 0, duration: 0.8, ease: 'sine.inOut' },
              { scale: 1, rotation: 0, duration: 5.4 }
            ],
            repeat: -1,
            stagger: 0.15
          },
          'logoIntro+=10'
        )
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
  gsap.ticker.remove(updateStars)
  if (transitionTimeout) clearTimeout(transitionTimeout)
  ctx?.revert()
  ctx = null
})

onKeyStroke(() => {
  if (animationCompleted.value) {
    toSongList()
  }
})

const transitioning = ref(false)
function toSongList() {
  if (animationCompleted.value && !transitioning.value) {
    transitioning.value = true
    currentAnimation.value?.kill()
    currentAnimation.value = null
    disableIntroMusic()
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
  await refresh()
  await new Promise((resolve) => {
    transitionTimeout = setTimeout(resolve, 1000)
  })

  if (!ctx) return // Prevent continuing if component unmounted

  ctx.add(() => {
    const tl = gsap.timeline()
    tl.to('section', { opacity: 0, duration: 0.5 })
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

const version = __APP_VERSION__
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
      <div :class="$style.starsContainer">
        <div
          v-for="(star, i) in stars"
          :key="i"
          :class="$style.starWrapper"
          :style="{
            left: star.left,
            top: star.top
          }"
          :ref="
            (el) => {
              if (el) starElements[i] = el as HTMLElement
            }
          "
        >
          <div
            :class="$style.star"
            :style="{
              width: star.size,
              height: star.size,
              animationDelay: star.animationDelay,
              animationDuration: star.animationDuration,
              '--move-x': star.x,
              '--move-y': star.y
            }"
          ></div>
        </div>
        <div
          v-for="(sStar, i) in shootingStars"
          :key="'s' + i"
          :class="$style.shootingStar"
          :style="{
            left: sStar.left,
            top: sStar.top,
            '--delay': sStar.delay,
            '--duration': sStar.duration,
            '--distance': sStar.distance,
            '--tail-length': sStar.tailLength,
            '--max-opacity': sStar.opacity
          }"
        ></div>
      </div>
      <div :class="$style.logoGlow"></div>
      <h1 :class="$style.logo">
        <span class="letter">v</span><span class="letter">i</span><span class="letter">b</span
        ><span class="letter">e</span><span class="letter">s</span>
      </h1>
      <div :class="$style.subtitle">
        <template v-if="loading"> <LoadingSpinner /> Loading </template>
        <template v-else>press any key</template>
      </div>
    </section>
    <div :class="$style.version">v{{ version }}-beta</div>
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

    @media screen and (max-height: 900px) {
      width: 30rem;
    }
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

  @media screen and (max-height: 900px) {
    font-size: 1.8rem;
  }
}

.starsContainer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 0; /* Animated by GSAP */
  pointer-events: none;
  z-index: 0;
}

.starWrapper {
  position: absolute;
}

.star {
  background-color: white;
  border-radius: 50%;
  box-shadow: 0 0 8px 1.5px rgba(255, 255, 255, 0.8);
  animation: floatTwinkle ease-in-out infinite alternate;
}

@keyframes floatTwinkle {
  0% {
    opacity: 0.05;
    transform: translate(0, 0) scale(0.6);
  }
  100% {
    opacity: 0.9;
    transform: translate(var(--move-x), var(--move-y)) scale(1.3);
  }
}

.shootingStar {
  position: absolute;
  height: 2px;
  width: var(--tail-length);
  background: linear-gradient(to right, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 1) 100%);
  border-radius: 50px;
  filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.8));
  transform: rotate(135deg) translateX(0);
  transform-origin: right center;
  opacity: 0;
  animation: shooting var(--duration) ease-in-out infinite;
  animation-delay: var(--delay);
  z-index: 1;
}

@keyframes shooting {
  0% {
    opacity: 0;
    transform: rotate(135deg) translateX(0);
  }
  2% {
    opacity: var(--max-opacity);
  }
  15% {
    opacity: 0;
    transform: rotate(135deg) translateX(var(--distance));
  }
  100% {
    opacity: 0;
    transform: rotate(135deg) translateX(var(--distance));
  }
}

@keyframes hueCycle {
  0%,
  100% {
    filter: hue-rotate(-50deg);
  }
  50% {
    filter: hue-rotate(0deg);
  }
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
  animation: hueCycle 30s ease-in-out infinite;
}

.logo {
  font-family: 'Playball', cursive;
  font-size: 18rem;
  color: white;
  font-weight: 400;
  text-shadow: none;
  z-index: 1;

  @media screen and (max-height: 900px) {
    font-size: 15rem;
  }
}

.logoGlow {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 220vw;
  height: 150vh;
  background: radial-gradient(
    circle,
    rgba(162, 108, 255, 0.6) 0%,
    rgba(130, 80, 255, 0.4) 35%,
    transparent 70%
  );
  z-index: 0;
  pointer-events: none;
  opacity: 0;
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

.version {
  position: fixed;
  bottom: 0;
  padding: 1rem;
  box-sizing: border-box;
  width: 100%;
  font-size: 0.8rem;
  opacity: 0.5;
  color: white;
  z-index: 9999;
}
</style>
