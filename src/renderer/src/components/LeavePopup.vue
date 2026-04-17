<script setup lang="ts">
import { onUnmounted, ref, useCssModule, watch } from 'vue'
import gsap from 'gsap'
import { useSound } from '@renderer/composables/useSound'

const sound = useSound()

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'cancel'): void
}>()

const gsapScope = ref(null)
let ctx

function leave() {
  window.close()
}

function cancel() {
  sound.play('click')
  emit('cancel')
}

watch(gsapScope, (scope) => {
  // initialize gsap context
  if (scope) {
    ctx = gsap.context(() => {}, scope)
  }
})

onUnmounted(() => {
  if (ctx) ctx.revert()
})

const $style = useCssModule()

watch(
  () => props.show,
  (newVal) => {
    if (newVal) {
      fadeIn()
    } else {
      fadeOut()
    }
  }
)

function fadeIn() {
  ctx?.add(() => {
    gsap.set(gsapScope.value, { pointerEvents: 'all' })
    gsap.to(gsapScope.value, { opacity: 1, duration: 0.3, ease: 'power2.out' })
    // popup scales in bouncy
    gsap.fromTo(
      `.${$style.popup}`,
      { scale: 0.8, opacity: 0 },
      { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(1.7)' }
    )
  })
}

function fadeOut() {
  ctx?.add(() => {
    gsap.set(gsapScope.value, { pointerEvents: 'none' })
    gsap.to(gsapScope.value, {
      opacity: 0,
      duration: 0.3,
      ease: 'power2.in'
    })
    gsap.to(`.${$style.popup}`, {
      scale: 0.8,
      opacity: 0,
      duration: 0.3,
      ease: 'back.in(1.7)'
    })
  })
}
</script>
<template>
  <div :class="$style.overlay" ref="gsapScope">
    <div :class="$style.popup">
      <h2>Are you sure you want to exit?</h2>
      <div :class="$style.buttons">
        <button :class="$style.leave" @mousedown="sound.play('hover')" @click="leave">Yes</button>
        <button :class="$style.cancel" @mousedown="sound.play('hover')" @click="cancel">
          No, Stay
        </button>
      </div>
    </div>
  </div>
</template>
<style lang="less" module>
.overlay {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1000;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  pointer-events: none;
  opacity: 0;
}

.popup {
  display: flex;
  flex-direction: column;
  padding: 2rem 2rem;
  background-color: white;
  border-radius: 1rem;

  h2 {
    margin: 0;
    padding: 0;
  }

  .buttons {
    display: flex;
    margin-top: 2rem;
    flex-direction: row;
    gap: 1rem;

    button {
      padding: 0.8rem 1.5rem;
      font-size: 1.3rem;
      font-weight: 600;
      border: none;
      outline: none;
      border-radius: 0.6rem;
      cursor: pointer;

      &.leave {
        background-color: #9c62ff;
        color: white;
      }

      &.cancel {
        background-color: #e0e0e0;
        color: black;
      }
    }
  }
}
</style>
