import { execFile } from 'child_process'
import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

class YtDlpManager {
  verified: boolean

  constructor() {
    this.verified = false
  }

  async init(): Promise<void> {
    await this._ensureYtDlpInstalled()
  }

  private async _ensureYtDlpInstalled(): Promise<void> {
    try {
      if (!(await this._isYtDlpInstalled())) {
        console.log('yt-dlp not found, installing...')

        // Warte bis Electron zur Window-Erstellung bereit ist, falls init früh aufgerufen wird
        await app.whenReady()

        const loadingWindow = new BrowserWindow({
          width: 450,
          height: 300,
          frame: false,
          transparent: true,
          webPreferences: {
            sandbox: false
          }
        })

        if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
          loadingWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/#/installing`)
        } else {
          loadingWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'installing' })
        }

        await this._installYtDlp()
        console.log('yt-dlp installed successfully')

        if (loadingWindow && !loadingWindow.isDestroyed()) {
          loadingWindow.close()
        }

        console.log('Relaunching...')
        app.relaunch()
        app.exit(0)
      } else {
        console.log('yt-dlp is already installed')
      }
      this.verified = true
    } catch (error) {
      console.error('Error while ensuring yt-dlp is installed:', error)
    }
  }

  private async _isYtDlpInstalled(): Promise<boolean> {
    try {
      await new Promise((resolve, reject) => {
        execFile('yt-dlp', ['--version'], (error) => {
          if (error) {
            reject(error)
          } else {
            resolve(undefined)
          }
        })
      })
      return true
    } catch (_) {
      return false
    }
  }

  private async _installYtDlp(): Promise<void> {
    try {
      await new Promise((resolve, reject) => {
        // check os
        if (process.platform === 'win32') {
          execFile(
            'winget',
            [
              'install',
              'yt-dlp.yt-dlp',
              '--silent',
              '--force',
              '--disable-interactivity',
              '--accept-package-agreements',
              '--accept-source-agreements'
            ],
            (error) => {
              if (error) {
                reject(error)
              } else {
                resolve(undefined)
              }
            }
          )
        } else if (process.platform === 'darwin') {
          execFile(
            'brew',
            ['install', 'yt-dlp'],
            {
              env: {
                ...process.env,
                HOMEBREW_NO_ENV_HINTS: '1'
              }
            },
            (error) => {
              if (error) {
                reject(error)
              } else {
                resolve(undefined)
              }
            }
          )
        }
      })
    } catch (err) {
      throw new Error(`Failed to install yt-dlp: ${err}`)
    }
  }
}

export const ytDlpManager = new YtDlpManager()
