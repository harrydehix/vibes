import { mapGamepadToXbox360Controller, useGamepad } from '@vueuse/core'
import { computed, inject, provide } from 'vue'

export function useController() {
  const { gamepads } = useGamepad()

  const gamepad = computed(() => gamepads.value.find((g) => g !== null))

  const controllerApi = { controller: mapGamepadToXbox360Controller(gamepad) }

  provide('controller', controllerApi)
  return controllerApi
}

export function accessController(): ReturnType<typeof useController> {
  const controllerApi = inject<ReturnType<typeof useController>>('controller')!
  return controllerApi
}
