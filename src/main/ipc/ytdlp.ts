import { execFile } from 'child_process'
import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import fs from 'fs'

class YtDlpManager {
  verified: boolean
  binPath: string

  constructor() {
    this.verified = false
    if (process.platform === 'darwin') {
      const customBinDir = join(app.getPath('userData'), 'bin')
      if (!fs.existsSync(customBinDir)) fs.mkdirSync(customBinDir, { recursive: true })
      process.env.PATH = `${customBinDir}:${process.env.PATH}`
      this.binPath = join(customBinDir, 'yt-dlp')
    } else if (process.platform === 'win32') {
      this.binPath = join(app.getPath('userData'), 'yt-dlp.exe')
    } else {
      this.binPath = join(app.getPath('userData'), 'yt-dlp')
    }
  }

  async init(): Promise<void> {
    await this._ensureYtDlpInstalled()
  }

  private async _ensureYtDlpInstalled(): Promise<void> {
    try {
      if (!(await this._isYtDlpInstalled())) {
        console.log('yt-dlp not found, installing...')

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
        execFile(this.binPath, ['--version'], (error) => {
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
            'powershell.exe',
            [
              '-NoProfile',
              '-Command',
              `Invoke-WebRequest -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile "${this.binPath}" -UseBasicParsing`
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
            'bash',
            [
              '-c',
              `curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos -o "${this.binPath}" && chmod a+rx "${this.binPath}"`
            ],
            (error) => {
              if (error) {
                reject(error)
              } else {
                resolve(undefined)
              }
            }
          )
        } else if (process.platform === 'linux') {
          execFile(
            'bash',
            [
              '-c',
              `curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o "${this.binPath}" && chmod a+rx "${this.binPath}"`
            ],
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
