<script setup lang="ts">
import { useSound } from '@renderer/composables/useSound'
import gsap from 'gsap'
import { onUnmounted, ref, useCssModule, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    title: string
    icon?: string
    visible: boolean
    okText?: string
    cancelText?: string
  }>(),
  {
    okText: 'OK',
    cancelText: 'Cancel'
  }
)

const emit = defineEmits<{
  (e: 'ok'): void
  (e: 'cancel'): void
}>()

const $style = useCssModule()

const overlayRef = ref<HTMLDivElement | null>(null)
const { play } = useSound()

let ctx: gsap.Context
watch(overlayRef, (newRef) => {
  if (newRef && !ctx) {
    ctx = gsap.context(() => {}, newRef)
  }
})

onUnmounted(() => {
  if (ctx) ctx.revert()
})

watch(
  [() => props.visible, overlayRef],
  ([isVisible]) => {
    if (!overlayRef.value || !ctx) return
    if (isVisible) {
      // Animate the popup in
      ctx.add(() => {
        gsap.fromTo(
          overlayRef.value,
          { opacity: 0 },
          { opacity: 1, pointerEvents: 'auto', duration: 0.3, ease: 'power2.out' }
        )

        gsap.fromTo(
          `.${$style.popup}`,
          { scale: 0.8 },
          { scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(1.7)' }
        )
      })
    } else {
      // Animate the popup out
      ctx.add(() => {
        gsap.to(`.${$style.popup}`, {
          scale: 0.8,
          duration: 0.3,
          ease: 'back.in(1.7)'
        })
        gsap.to(overlayRef.value, {
          opacity: 0,
          duration: 0.3,
          pointerEvents: 'none',
          ease: 'power2.in'
        })
      })
    }
  },
  { immediate: true }
)

function onCancel() {
  play('click')
  emit('cancel')
}

function onOk() {
  play('click')
  emit('ok')
}
</script>
<template>
  <div :class="$style.overlay" ref="overlayRef" @click.self="onCancel">
    <div :class="$style.popup">
      <div :class="$style.header">
        <v-icon :name="props.icon" v-if="props.icon"></v-icon>
        <h2>{{ props.title }}</h2>
      </div>
      <div :class="$style.content">
        <slot></slot>
        <div :class="$style.buttons">
          <button @click="onOk">{{ props.okText }}</button>
          <button @click="onCancel">{{ props.cancelText }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
<style lang="less" module>
.overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  user-select: none;
  opacity: 0;
  pointer-events: none;
}

.popup {
  background-color: #500ec3;
  border-radius: 1.2rem;
  color: white;
  overflow: hidden;
  transform: scale(0.8);
}

.header {
  background-color: #9c62ff;
  padding: 1.5rem 2rem;
  padding-right: 3.2rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-direction: row;

  svg {
    width: 2.3rem;
    height: 2.3rem;
  }

  h2 {
    font-size: 1.8rem;
    margin: 0;
    font-weight: 500;
  }
}

.content {
  padding: 2rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  width: 100%;
  box-sizing: border-box;

  .buttons {
    display: flex;
    gap: 1rem;
    width: 100%;

    button {
      padding: 0.75rem 1.5rem;
      border-radius: 0.5rem;
      border: none;
      cursor: pointer;
      font-size: 1.25rem;
      font-weight: 500;
      transition: background-color 0.2s;
      box-sizing: border-box;
      text-align: left;
      width: 100%;

      &:first-child {
        background-color: white;
        color: black;

        &:hover {
          background-color: #e0e0e0;
        }
      }

      &:last-child {
        background-color: rgb(167, 167, 167);
        color: black;

        &:hover {
          background-color: rgb(136, 136, 136);
        }
      }
    }
  }
}
</style>
