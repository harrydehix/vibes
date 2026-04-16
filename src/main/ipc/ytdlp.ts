import { exec } from 'child_process'
import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc'

class YtDlpManager {
  verified: boolean

  constructor() {
    this.verified = false
  }

  async init() {
    ipcMain.handle(IPC_CHANNELS.YTDLP.ENSURE_INSTALLED, async () => {
      if (!this.verified) {
        await this._ensureYtDlpInstalled()
      }
      return this.verified
    })
  }

  private async _ensureYtDlpInstalled(): Promise<void> {
    try {
      if (!(await this._isYtDlpInstalled())) {
        console.log('yt-dlp not found, installing...')
        await this._installYtDlp()
        console.log('yt-dlp installed successfully')
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
        exec('yt-dlp --version', (error) => {
          if (error) {
            reject(error)
          } else {
            resolve(undefined)
          }
        })
      })
      return true
    } catch (error) {
      return false
    }
  }

  private async _installYtDlp(): Promise<void> {
    try {
      await new Promise((resolve, reject) => {
        exec('winget install yt-dlp.yt-dlp ', (error) => {
          if (error) {
            reject(error)
          } else {
            resolve(undefined)
          }
        })
      })
    } catch (err) {
      throw new Error(`Failed to install yt-dlp: ${err}`)
    }
  }
}

export const ytDlpManager = new YtDlpManager()
