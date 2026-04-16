<script setup lang="ts">
import { useSound } from '@renderer/composables/useSound'
import { nextTick, ref, watch } from 'vue'

const sounds = useSound()

const props = defineProps<{
  text: string
  icon: string
  isActive: boolean
}>()

const emit = defineEmits<{
  click: []
  focus: []
}>()

const buttonRef = ref<HTMLButtonElement | null>(null)

watch(
  () => props.isActive,
  async (isActive) => {
    if (isActive) {
      await nextTick()
      buttonRef.value?.focus({})
      onHover(true)
    }
  }
)

function onHover(force = false) {
  if (props.isActive && !force) {
    return
  }
  sounds.play('hover')
  emit('focus')
}

function onClick() {
  sounds.play('click')
  emit('click')
}

defineExpose({ click: onClick })
</script>
<template>
  <button
    ref="buttonRef"
    :class="`${$style.menuItem} ${props.isActive ? $style.active : ''}`"
    tabindex="0"
    @click="onClick()"
    @mouseenter="onHover()"
    @focus="onHover()"
  >
    <v-icon :name="icon" />
    {{ text }}
  </button>
</template>
<style lang="less" module>
.menuItem {
  //   background-color: #d3d3d3;
  // gradient, fade out to right
  background: linear-gradient(90deg, #d3d3d3, #d3d3d3 50%, rgba(255, 255, 255, 0.5) 100%);
  border-radius: 1.3rem 0 0 1.3rem;
  padding: 1.5rem 3rem;
  font-size: 2rem;
  display: flex;
  align-items: center;
  flex-direction: row;
  gap: 1rem;
  font-family: 'Outfit', sans-serif;
  font-weight: 600;
  border: none;
  outline: none;
  cursor: pointer;
  width: 100%;
  transition: all 0.2s ease;
  opacity: 0.8;

  svg {
    width: 2.5rem;
    height: 2.5rem;
  }

  &.active {
    background-color: white;
    transform: scale(1.01);
    opacity: 1;
  }
}
</style>
