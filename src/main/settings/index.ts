import { app } from 'electron'
import * as fs from 'fs/promises'
import { join } from 'path'
import type { AppSettings } from '../../shared/types'
import { AppSettingsSchema, AppSettingsUpdateSchema } from '../../shared/types'
import { ApiError } from '../../shared/errors'

const settingsPath = join(app.getPath('userData'), 'settings.json')
export const basePathForDownload = join(app.getPath('userData'), 'songs')

const defaultSettings: AppSettings = {
  songFolders: [basePathForDownload],
  musicVolume: 1,
  sfxVolume: 0.8,
  lyricsFontScale: 1.4,
  lyricsAlignment: 'left',
  syncOffsetMs: -150,
  highContrastMode: false,
  lowPerformanceMode: false,
  youtubeSignInDismissed: false
}

class SettingsManager {
  constructor(private _settings: AppSettings) {}

  async init(): Promise<void> {
    try {
      this._settings = await this.load()
    } catch (error) {
      console.error('Error while loading settings, falling back to defaults: ', error)
      this._settings = defaultSettings
    }

    await fs.mkdir(basePathForDownload, { recursive: true })
  }

  private async load(): Promise<AppSettings> {
    try {
      const data = await fs.readFile(settingsPath, 'utf-8')
      return AppSettingsSchema.parse({
        ...defaultSettings,
        ...AppSettingsUpdateSchema.parse(JSON.parse(data))
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
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
    const parsed = AppSettingsUpdateSchema.safeParse(settings)
    if (!parsed.success) throw new ApiError('invalid_request')
    const next = AppSettingsSchema.parse({ ...this._settings, ...parsed.data })
    await fs.writeFile(settingsPath, JSON.stringify(next, null, 2), 'utf-8')
    this._settings = next
    return this._settings
  }
}

export const settingsManager = new SettingsManager(defaultSettings)
