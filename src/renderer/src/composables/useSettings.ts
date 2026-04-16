import { AppSettings } from '@shared/types'
import { inject, onMounted, provide, ref } from 'vue'

export function useSettings() {
  const settings = ref<AppSettings | null>(null)

  onMounted(() => {
    load()
  })

  async function load() {
    try {
      settings.value = await window.api.settings.get()
      return true
    } catch (error) {
      console.error('Failed to load settings: ', error)
      return false
    }
  }

  async function refresh() {
    try {
      settings.value = await window.api.settings.refresh()
      return true
    } catch (error) {
      console.error('Failed to refresh settings: ', error)
      return false
    }
  }

  async function update() {
    try {
      const payload = JSON.parse(
        JSON.stringify({
          songFolders: settings.value?.songFolders ?? [],
          musicVolume: settings.value?.musicVolume ?? 0.8,
          sfxVolume: settings.value?.sfxVolume ?? 0.8,
          lyricsFontScale: settings.value?.lyricsFontScale ?? 1,
          syncOffsetMs: settings.value?.syncOffsetMs ?? -100
        })
      )
      await window.api.settings.update(payload)
      return true
    } catch (error) {
      console.error('Failed to update settings: ', error)
      return false
    }
  }

  const settingsApi = {
    settings,
    load,
    refresh,
    update
  }

  provide('appSettings', settingsApi)

  return settingsApi
}

export function accessSettings() {
  const settingsApi = inject('appSettings') as ReturnType<typeof useSettings>
  if (!settingsApi) {
    throw new Error('accessSettings must be used within a provider')
  }
  return settingsApi
}
