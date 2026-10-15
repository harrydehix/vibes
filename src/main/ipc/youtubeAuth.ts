import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { DownloadError, getDownloadErrorCode } from '../../shared/errors'
import { IPC_CHANNELS } from '../../shared/ipc'
import type { YoutubeAuthStatus } from '../../shared/types'
import { parseYoutubeCookies, requiresYoutubeAuthentication } from '../song-import/youtubeCookies'
import { ytDlpManager } from './ytdlp'

const runFile = promisify(execFile)

class YoutubeAuthManager {
  private cookies: string | undefined
  private initialization: Promise<void> | undefined
  private revision = 0
  private status: YoutubeAuthStatus = { authenticated: false, message: null }

  private get sessionPath(): string {
    return join(app.getPath('userData'), 'youtube-session.enc')
  }

  private canEncrypt(): boolean {
    return (
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
    )
  }

  private notify(): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.YOUTUBE_AUTH.CHANGED, this.status)
      }
    }
  }

  private async withCookieFile<Result>(
    cookies: string,
    operation: (args: string[]) => Promise<Result>
  ): Promise<Result> {
    const folder = await mkdtemp(join(tmpdir(), 'vibes-youtube-'))
    try {
      const path = join(folder, 'cookies.txt')
      await writeFile(path, cookies, { encoding: 'utf8', mode: 0o600 })
      return await operation(['--cookies', path])
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  }

  private async verifyCookies(cookies: string): Promise<void> {
    await this.withCookieFile(cookies, async (args) => {
      await runFile(
        ytDlpManager.binPath,
        [
          '--ignore-config',
          ...args,
          '--flat-playlist',
          '--playlist-end',
          '1',
          '--skip-download',
          '--dump-single-json',
          '--',
          'https://www.youtube.com/feed/history'
        ],
        { timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true, encoding: 'utf8' }
      )
    })
  }

  private async loadSession(): Promise<void> {
    try {
      const encrypted = await readFile(this.sessionPath)
      if (!this.canEncrypt()) throw new Error('Secure session storage is unavailable.')
      const cookies = parseYoutubeCookies(safeStorage.decryptString(encrypted))
      await this.verifyCookies(cookies)
      this.cookies = cookies
      this.status = { authenticated: true, message: null }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.status = {
          authenticated: false,
          message:
            'The saved YouTube session could not be verified. Check your connection or sign in again.'
        }
      }
    }
  }

  async getStatus(): Promise<YoutubeAuthStatus> {
    this.initialization ??= this.loadSession()
    await this.initialization
    return { ...this.status }
  }

  async withCookies<Result>(operation: (args: string[]) => Promise<Result>): Promise<Result> {
    await this.getStatus()
    const revision = this.revision
    try {
      return this.cookies
        ? await this.withCookieFile(parseYoutubeCookies(this.cookies), operation)
        : await operation([])
    } catch (error) {
      const failure = error as Error & { stderr?: string }
      const message = failure.stderr?.trim() || failure.message || 'YouTube request failed'
      if (requiresYoutubeAuthentication(message) && revision === this.revision) {
        const rateLimited = getDownloadErrorCode(error) === 'rate_limited'
        this.revision++
        this.cookies = undefined
        this.status = {
          authenticated: false,
          message: rateLimited
            ? 'YouTube is limiting requests. Wait before retrying; optional sign-in is available in Settings.'
            : 'YouTube blocked this request. You can optionally sign in via Settings.'
        }
        await rm(this.sessionPath, { force: true }).catch(() => {})
        this.notify()
        if (rateLimited)
          throw new DownloadError('rate_limited', this.status.message!, { cause: error })
        throw new Error(this.status.message!, { cause: error })
      }
      throw new Error(message, { cause: error })
    }
  }

  private async importCookies(): Promise<YoutubeAuthStatus> {
    await this.getStatus()
    if (!this.canEncrypt()) {
      throw new Error('Secure session storage is unavailable. Enable your system keychain first.')
    }
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import YouTube cookies',
      properties: ['openFile'],
      filters: [{ name: 'Netscape cookie files', extensions: ['txt', 'cookies'] }]
    })
    if (canceled || !filePaths[0]) return { ...this.status }
    if ((await stat(filePaths[0])).size > 1024 * 1024) {
      throw new Error('The cookie file is too large. Export only youtube.com cookies.')
    }
    const cookies = parseYoutubeCookies(await readFile(filePaths[0], 'utf8'))
    try {
      await this.verifyCookies(cookies)
    } catch (error) {
      const failure = error as Error & { stderr?: string }
      const message = failure.stderr || failure.message
      throw new Error(
        /429|Too Many Requests/i.test(message)
          ? 'YouTube is limiting requests. Wait before trying again.'
          : 'YouTube could not verify this session. Check your connection and export fresh cookies.'
      )
    }
    await writeFile(this.sessionPath, safeStorage.encryptString(cookies), { mode: 0o600 })
    this.revision++
    this.cookies = cookies
    this.status = { authenticated: true, message: null }
    this.notify()
    return { ...this.status }
  }

  defineIpcHandles(): void {
    ipcMain.handle(IPC_CHANNELS.YOUTUBE_AUTH.STATUS, () => this.getStatus())
    ipcMain.handle(IPC_CHANNELS.YOUTUBE_AUTH.SIGN_OUT, async () => {
      await this.getStatus()
      await rm(this.sessionPath, { force: true })
      this.revision++
      this.cookies = undefined
      this.status = { authenticated: false, message: null }
      this.notify()
      return { ...this.status }
    })
    ipcMain.handle(IPC_CHANNELS.YOUTUBE_AUTH.OPEN_BROWSER, () =>
      shell.openExternal('https://www.youtube.com/')
    )
    ipcMain.handle(IPC_CHANNELS.YOUTUBE_AUTH.OPEN_HELP, () =>
      shell.openExternal(
        'https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies'
      )
    )
    ipcMain.handle(IPC_CHANNELS.YOUTUBE_AUTH.IMPORT_COOKIES, () => this.importCookies())
  }
}

export const youtubeAuthManager = new YoutubeAuthManager()
