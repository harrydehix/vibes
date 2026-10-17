import { EventEmitter } from 'node:events'
import { is } from '@electron-toolkit/utils'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { ApiError, getApiErrorCode, type ApiFailure } from '../../shared/errors'

export const updaterEvents = new EventEmitter<{
  available: [UpdateInfo]
  progress: [ProgressInfo]
  downloaded: [UpdateInfo]
  failed: [ApiFailure]
}>()

let initialized = false
let available: UpdateInfo | null = null
let downloaded = false
let checking: Promise<UpdateInfo | null> | null = null

export function initializeUpdater(): void {
  if (initialized) return
  initialized = true
  if (is.dev) autoUpdater.forceDevUpdateConfig = true
  autoUpdater.disableWebInstaller = true
  autoUpdater.on('update-available', (info) => {
    if (available?.version !== info.version) downloaded = false
    available = info
    updaterEvents.emit('available', info)
  })
  autoUpdater.on('update-not-available', () => {
    available = null
  })
  autoUpdater.on('download-progress', (progress) => updaterEvents.emit('progress', progress))
  autoUpdater.on('update-downloaded', (info) => {
    available = info
    downloaded = true
    updaterEvents.emit('downloaded', info)
  })
  autoUpdater.on('error', (error) => {
    console.error('App update failed:', error)
    updaterEvents.emit('failed', { code: getApiErrorCode(error, 'update_failed') })
  })
}

export function checkForUpdates(): Promise<UpdateInfo | null> {
  if (downloaded) return Promise.resolve(available)
  if (!checking) {
    checking = autoUpdater
      .checkForUpdates()
      .then(() => available)
      .finally(() => {
        checking = null
      })
  }
  return checking
}

export function installUpdate(): void {
  if (!downloaded) throw new ApiError('update_not_ready')
  autoUpdater.quitAndInstall(false, true)
}
