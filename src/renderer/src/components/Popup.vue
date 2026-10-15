<script setup lang="ts">
import { useSound } from '@renderer/composables/useSound'
import { useDialogFocus } from '@renderer/composables/useDialogFocus'
import gsap from 'gsap'
import { computed, onUnmounted, ref, useCssModule, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    title: string
    icon?: string
    visible: boolean
    okText?: string
    okIcon?: string
    okProgress?: number
    okDisabled?: boolean
    cancelText?: string
    cancelIcon?: string
    cancelDisabled?: boolean
    initialFocus?: 'first' | 'cancel'
    fallbackFocus?: () => HTMLElement | null | undefined
  }>(),
  {
    okText: 'OK',
    okDisabled: false,
    cancelText: 'Cancel'
  }
)

const emit = defineEmits<{
  (e: 'ok'): void
  (e: 'cancel'): void
}>()

const $style = useCssModule()

const overlayRef = ref<HTMLDivElement | null>(null)
const dialogRef = ref<HTMLDivElement | null>(null)
const cancelButton = ref<HTMLButtonElement | null>(null)
const { trapFocus } = useDialogFocus(
  () => props.visible,
  dialogRef,
  () => (props.initialFocus === 'cancel' ? cancelButton.value : undefined),
  () => props.fallbackFocus?.()
)
const { play } = useSound()
const progress = computed(() =>
  props.okProgress === undefined ? undefined : Math.min(1, Math.max(0, props.okProgress))
)

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

function onCancel(): void {
  if (props.cancelDisabled) return
  play('click')
  emit('cancel')
}

function onOk(): void {
  if (props.okDisabled) return
  play('click')
  emit('ok')
}
</script>
<template>
  <div
    :class="$style.overlay"
    ref="overlayRef"
    :inert="!props.visible"
    :aria-hidden="!props.visible"
    @click.self="onCancel"
    @keydown.tab="trapFocus"
    @keydown.esc.stop="onCancel"
  >
    <div
      :class="$style.popup"
      ref="dialogRef"
      role="dialog"
      aria-modal="true"
      :aria-label="props.title"
      tabindex="-1"
    >
      <div :class="$style.header">
        <v-icon :name="props.icon" v-if="props.icon"></v-icon>
        <h2>{{ props.title }}</h2>
      </div>
      <div :class="$style.content">
        <slot></slot>
        <div :class="$style.buttons">
          <button
            :class="{ [$style.progress]: progress !== undefined }"
            :disabled="props.okDisabled"
            :aria-busy="progress !== undefined"
            @click="onOk"
          >
            <span
              v-if="progress !== undefined"
              :class="$style.progressBar"
              :style="{ width: `${progress * 100}%` }"
              aria-hidden="true"
            ></span>
            <span :class="$style.buttonContent">
              <v-icon v-if="props.okIcon" :name="props.okIcon" aria-hidden="true" />
              <span>{{ props.okText }}</span>
            </span>
          </button>
          <button ref="cancelButton" :disabled="props.cancelDisabled" @click="onCancel">
            <span :class="$style.buttonContent">
              <v-icon v-if="props.cancelIcon" :name="props.cancelIcon" aria-hidden="true" />
              <span>{{ props.cancelText }}</span>
            </span>
          </button>
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
  max-width: calc(100vw - 2rem);
  max-height: calc(100dvh - 2rem);
  overflow-y: auto;
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
    flex-wrap: wrap;
    gap: 1rem;
    width: 100%;

    button {
      position: relative;
      overflow: hidden;
      flex: 1 1 auto;
      min-width: max-content;
      min-height: 3.25rem;
      overflow-wrap: anywhere;
      padding: 0.75rem 1.5rem;
      border-radius: 0.5rem;
      border: none;
      cursor: pointer;
      font-size: 1.25rem;
      font-weight: 500;
      transition: background-color 0.2s;
      box-sizing: border-box;
      text-align: left;
      width: auto;

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

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

      &.progress {
        opacity: 1;
        background-color: rgb(212, 212, 212);
      }
    }
  }
}

.buttonContent {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  white-space: nowrap;
  svg {
    width: 1.25rem;
    height: 1.25rem;
    flex-shrink: 0;
  }
  span {
    min-width: 0;
  }
}

.progressBar {
  position: absolute;
  inset: 0 auto 0 0;
  background-color: #eacb69;
  transition: width 0.2s ease-out;
  pointer-events: none;
}
</style>
