import { app } from 'electron'
import { execFile } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { join, sep } from 'node:path'

const ffmpegSource = require('ffmpeg-static') as string | null
const ffprobeSource = require('ffprobe-static') as { path: string }

function unpackedPath(filename: string): string {
  return filename.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`)
}

class FfmpegManager {
  verified = false
  readonly binDir = join(app.getPath('userData'), 'ffmpeg')
  readonly binPath = join(this.binDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  readonly probePath = join(this.binDir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')

  private isBinaryValid(filename: string, name: string): Promise<boolean> {
    return new Promise((resolve) => {
      execFile(filename, ['-version'], { timeout: 10_000, windowsHide: true }, (error, stdout) => {
        resolve(!error && stdout.startsWith(`${name} version`))
      })
    })
  }

  private async isInstalled(): Promise<boolean> {
    const checks = await Promise.all([
      this.isBinaryValid(this.binPath, 'ffmpeg'),
      this.isBinaryValid(this.probePath, 'ffprobe')
    ])
    return checks.every(Boolean)
  }

  private async install(): Promise<void> {
    if (!ffmpegSource || !ffprobeSource.path) {
      throw new Error('FFmpeg is not available for this platform.')
    }
    await mkdir(app.getPath('userData'), { recursive: true })
    const staging = await mkdtemp(join(app.getPath('userData'), '.ffmpeg-install-'))
    try {
      for (const [source, name] of [
        [ffmpegSource, 'ffmpeg'],
        [ffprobeSource.path, 'ffprobe']
      ]) {
        const filename = join(staging, process.platform === 'win32' ? `${name}.exe` : name)
        await copyFile(unpackedPath(source), filename)
        if (process.platform !== 'win32') await chmod(filename, 0o755)
        if (!(await this.isBinaryValid(filename, name))) {
          throw new Error(`The bundled ${name} executable could not be verified.`)
        }
      }
      await mkdir(this.binDir, { recursive: true })
      await rename(
        join(staging, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
        this.binPath
      )
      await rename(
        join(staging, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'),
        this.probePath
      )
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  }

  async init(): Promise<void> {
    this.verified = false
    await app.whenReady()
    if (!(await this.isInstalled())) {
      console.log('App-managed FFmpeg is missing or damaged, installing...')
      await this.install()
      if (!(await this.isInstalled())) throw new Error('FFmpeg installation could not be verified.')
    }
    this.verified = true
    console.log('App-managed FFmpeg and FFprobe are ready')
  }
}

export const ffmpegManager = new FfmpegManager()
