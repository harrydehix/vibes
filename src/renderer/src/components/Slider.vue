<script lang="ts" setup>
import { ref, onBeforeUnmount } from 'vue'

const {
  min,
  max,
  step,
  showValue = false,
  formatValue = (v) => v.toString()
} = defineProps<{
  min: number
  max: number
  step?: number
  showValue?: boolean
  formatValue?: (value: number) => string
}>()

const model = defineModel<number>({
  default: 0
})

const sliderRef = ref<HTMLElement | null>(null)
const isDragging = ref(false)

function getClientX(event: MouseEvent | TouchEvent) {
  if ('touches' in event) {
    return event.touches[0].clientX
  }
  return event.clientX
}

function updateValue(event: MouseEvent | TouchEvent) {
  if (!sliderRef.value) return
  const sliderRect = sliderRef.value.getBoundingClientRect()
  const relativeX = getClientX(event) - sliderRect.left
  const percentage = Math.min(Math.max(relativeX / sliderRect.width, 0), 1)
  const valueRange = max - min
  let newValue = min + percentage * valueRange
  if (step) newValue = Math.round(newValue / step) * step
  model.value = Math.min(Math.max(newValue, min), max)
}

function startDrag(event: MouseEvent | TouchEvent) {
  isDragging.value = true
  updateValue(event)
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', stopDrag)
  window.addEventListener('touchmove', onDrag, { passive: false })
  window.addEventListener('touchend', stopDrag)
}

function onDrag(event: MouseEvent | TouchEvent) {
  if (!isDragging.value) return
  updateValue(event)
}

function stopDrag() {
  if (!isDragging.value) return
  isDragging.value = false
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', stopDrag)
  window.removeEventListener('touchmove', onDrag)
  window.removeEventListener('touchend', stopDrag)
}

onBeforeUnmount(() => {
  stopDrag()
})
</script>

<template>
  <div
    ref="sliderRef"
    :class="$style.slider"
    @mousedown="startDrag"
    @touchstart.prevent="startDrag"
  >
    <div
      :class="$style.track"
      :style="{
        width: `${((model - min) / (max - min)) * 100}%`
      }"
    ></div>

    <span :class="$style.value" v-if="showValue">{{ formatValue(model) }}</span>
  </div>
</template>

<style lang="less" module>
.slider {
  position: relative;
  width: 100%;
  height: 2.75rem;
  background-color: rgba(255, 255, 255, 0.349);
  border-radius: 0.5rem;

  display: flex;
  align-items: center;
  padding: 0 0.7rem;
  box-sizing: border-box;
  font-weight: 600;
  user-select: none;
  overflow: hidden;

  cursor: pointer;

  .value {
    z-index: 9999;
    font-size: 1.3rem !important;
    color: black !important;
  }
}

.track {
  position: absolute;
  height: 100%;
  background-color: white;
  border-radius: 0.5rem 0 0 0.5rem;
  left: 0;
}
</style>
