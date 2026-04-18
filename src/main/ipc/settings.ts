import { app } from 'electron'
import * as fs from 'fs/promises'
import { join } from 'path'
import type { AppSettings } from '../../shared/types'
import { ipcMain } from 'electron/main'
import { IPC_CHANNELS } from '../../shared/ipc'

const settingsPath = join(app.getPath('userData'), 'settings.json')
export const basePathForDownload = join(app.getPath('userData'), 'songs')

const defaultSettings: AppSettings = {
  songFolders: [basePathForDownload],
  musicVolume: 1,
  sfxVolume: 0.8,
  lyricsFontScale: 1.4,
  syncOffsetMs: -150,
  highContrastMode: false,
  lowPerformanceMode: false
}

class SettingsManager {
  constructor(private _settings: AppSettings) {}

  async defineIpcHandles(): Promise<void> {
    try {
      this._settings = await this.load()
    } catch (error) {
      console.error('Error while loading settings, falling back to defaults: ', error)
      this._settings = defaultSettings
    }

    ipcMain.handle(IPC_CHANNELS.SETTINGS.GET, async () => {
      return this._settings
    })

    ipcMain.handle(IPC_CHANNELS.SETTINGS.UPDATE, async (_, newSettings: Partial<AppSettings>) => {
      return this.update(newSettings)
    })

    ipcMain.handle(IPC_CHANNELS.SETTINGS.REFRESH, async () => {
      return this.refresh()
    })
  }

  private async load(): Promise<AppSettings> {
    try {
      const data = await fs.readFile(settingsPath, 'utf-8')
      return { ...defaultSettings, ...JSON.parse(data) }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        await this.update(defaultSettings)
        return defaultSettings
      }
      throw error
    }
  }

  get settings(): AppSettings {
    return this._settings
  }

  async refresh(): Promise<AppSettings> {
    this._settings = await this.load()
    return this._settings
  }

  async update(settings: Partial<AppSettings>): Promise<AppSettings> {
    this._settings = { ...this._settings, ...settings }
    await fs.writeFile(settingsPath, JSON.stringify(this._settings, null, 2), 'utf-8')
    return this._settings
  }
}

export const settingsManager = new SettingsManager(defaultSettings)
