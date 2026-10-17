import { IPC_CHANNELS } from '../../shared/ipc'
import type { AppSettingsUpdate } from '../../shared/types'
import { handleApi } from '../utils/ipcHandle'
import { settingsManager } from './index'

export async function defineSettingsIpc(): Promise<void> {
  await settingsManager.init()
  handleApi(IPC_CHANNELS.SETTINGS.GET, () => settingsManager.settings, 'settings_failed')
  handleApi(IPC_CHANNELS.SETTINGS.REFRESH, () => settingsManager.refresh(), 'settings_failed')
  handleApi(
    IPC_CHANNELS.SETTINGS.UPDATE,
    (_, patch: AppSettingsUpdate) => settingsManager.update(patch),
    'settings_failed'
  )
}
