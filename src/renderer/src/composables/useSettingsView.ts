import { inject, Ref } from 'vue'

export function useSettingsView() {
  const settingsOpened = inject('settingsOpened') as Ref<boolean>

  return {
    settingsOpened
  }
}
