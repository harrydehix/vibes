import { AppSettings } from '@shared/types'
import { AppSettingsUpdateSchema, type AppSettingsUpdate } from '@shared/types'
import { unwrapApiResult } from '@shared/errors'
import { inject, onMounted, provide, ref, type Ref } from 'vue'

export type SettingsState = {
  settings: Ref<AppSettings | null>
  get(): Promise<AppSettings>
  load(): Promise<boolean>
  refresh(): Promise<boolean>
  update(patch?: AppSettingsUpdate): Promise<boolean>
}

export function useSettings(): SettingsState {
  const settings = ref<AppSettings | null>(null)

  onMounted(() => {
    load()
  })

  async function load(): Promise<boolean> {
    try {
      settings.value = await get()
      return true
    } catch (error) {
      console.error('Failed to load settings: ', error)
      return false
    }
  }

  async function get(): Promise<AppSettings> {
    return unwrapApiResult(await window.api.settings.get())
  }

  async function refresh(): Promise<boolean> {
    try {
      settings.value = unwrapApiResult(await window.api.settings.refresh())
      return true
    } catch (error) {
      console.error('Failed to refresh settings: ', error)
      return false
    }
  }

  async function update(patch?: AppSettingsUpdate): Promise<boolean> {
    try {
      const payload = AppSettingsUpdateSchema.parse(patch ?? settings.value ?? {})
      unwrapApiResult(await window.api.settings.update(payload))
      return true
    } catch (error) {
      console.error('Failed to update settings: ', error)
      return false
    }
  }

  const settingsApi = {
    settings,
    get,
    load,
    refresh,
    update
  }

  provide('appSettings', settingsApi)

  return settingsApi
}

export function accessSettings(): SettingsState {
  const settingsApi = inject('appSettings') as ReturnType<typeof useSettings>
  if (!settingsApi) {
    throw new Error('accessSettings must be used within a provider')
  }
  return settingsApi
}
