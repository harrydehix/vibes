import { spawn } from 'node:child_process'
import { join, parse } from 'node:path'
import { Effect } from 'effect'
import { z } from 'zod'
import { ytDlpManager } from '../../../../dependencies/ytdlp'
import { youtubeAuthManager } from '../../../../youtube-auth/index'
import { ffmpegManager } from '../../../../dependencies/ffmpeg'

/* Code by: https://github.com/martiinii/UltraStar-CLI */

function videoDownloadArgs(outputPath: string): string[] {
  if (!ffmpegManager.verified) throw new Error('The app-managed FFmpeg installation is not ready.')
  const { dir, name } = parse(outputPath)
  const template = join(dir, `${name}.%(ext)s`)
  return [
    '--ignore-config',
    '--no-playlist',
    '--ffmpeg-location',
    ffmpegManager.binDir,
    '--preset-alias',
    'mp4',
    '--format',
    'bv*+ba/b',
    '-S',
    'res:1080',
    '-o',
    template
  ]
}

/**
 * Download a youtube video from direct link (watch URL or ID) and save to provided path.
 * Equivalent shell: yt-dlp -S "ext,res:1080" -o '${path}' -- ${link}
 */
export const downloadYoutubeVideo = (
  link: string,
  path: string
): Effect.Effect<void, Error, never> =>
  Effect.tryPromise({
    try: async () => {
      const args = [...videoDownloadArgs(path), '--', link]

      await youtubeAuthManager.withCookies(
        (cookieArgs) =>
          new Promise<void>((resolve, reject) => {
            const child = spawn(ytDlpManager.binPath, [...cookieArgs, ...args], {
              stdio: ['ignore', 'ignore', 'pipe']
            })
            let stderr = ''
            child.stderr.setEncoding('utf8')
            child.stderr.on('data', (chunk: string) => {
              stderr = (stderr + chunk).slice(-16384)
            })
            child.on('error', (err) => reject(err))
            child.on('close', (code) => {
              if (code === 0) resolve()
              else
                reject(
                  new Error(
                    `yt-dlp download failed (code ${code}): ${stderr.trim() || 'No diagnostic output'}`
                  )
                )
            })
          })
      )
    },
    catch: (e) => (e instanceof Error ? e : new Error('Failed to download youtube video'))
  })

export type YoutubeDownloadProgress = {
  percent: number // 0..1
  eta?: string // e.g. 00:12
  speed?: string // e.g. 2.31MiB/s
}

const YtDlpProgressDataSchema = z.object({
  type: z.literal('progress'),
  downloaded: z.union([z.number(), z.string()]),
  total: z.union([z.number(), z.string()]),
  frag_index: z.union([z.number(), z.string()]),
  frag_count: z.union([z.number(), z.string()])
})
type YtDlpProgressData = z.infer<typeof YtDlpProgressDataSchema>

/**
 * Download with progress updates via callback. Parses yt-dlp stdout progress lines in JSON format.
 * Uses --newline to receive line-by-line updates.
 */
export const downloadYoutubeVideoWithProgress = (
  link: string,
  path: string,
  onProgress: (p: YoutubeDownloadProgress) => void,
  extraArgs: string[] = []
): Effect.Effect<void, Error, never> =>
  Effect.tryPromise({
    try: async () => {
      const args = [
        ...videoDownloadArgs(path),
        '--quiet',
        '--newline',
        '--no-warnings',
        '--progress',
        '--progress-template',
        `{"type": "progress", "downloaded": "%(progress.downloaded_bytes)s", "total": "%(progress.total_bytes)s", "frag_index": "%(progress.fragment_index)s", "frag_count": "%(progress.fragment_count)s"}`,
        ...extraArgs,
        '--',
        link
      ]

      await youtubeAuthManager.withCookies(
        (cookieArgs) =>
          new Promise<void>((resolve, reject) => {
            const child = spawn(ytDlpManager.binPath, [...cookieArgs, ...args], {
              stdio: ['ignore', 'pipe', 'pipe']
            })
            let stderr = ''

            const parseAndEmit = (line: string) => {
              try {
                // Try to parse the line as JSON
                const raw = line.trim()
                if (raw.length === 0) return
                const maybeUnwrapped =
                  (raw.startsWith("'") && raw.endsWith("'")) ||
                  (raw.startsWith('"') && raw.endsWith('"'))
                    ? raw.slice(1, -1)
                    : raw
                const data: YtDlpProgressData = YtDlpProgressDataSchema.parse(
                  JSON.parse(maybeUnwrapped)
                )

                if (data.type === 'progress') {
                  let percent = 0

                  const toNumber = (v: unknown): number => {
                    if (typeof v === 'number') return v
                    const n = Number.parseInt(String(v), 10)
                    return Number.isNaN(n) ? Number.NaN : n
                  }

                  if (data.total !== 'NA') {
                    // Use downloaded / total ratio
                    const total = toNumber(data.total)
                    const downloaded = toNumber(data.downloaded)
                    if (!Number.isNaN(total) && total > 0 && !Number.isNaN(downloaded)) {
                      percent = Math.max(0, Math.min(1, downloaded / total))
                    } else {
                      // Fallback to fragment-based ratio if total is not usable
                      const fragCount = toNumber(data.frag_count)
                      const fragIndex = toNumber(data.frag_index)
                      if (!Number.isNaN(fragCount) && fragCount > 0 && !Number.isNaN(fragIndex)) {
                        const clampedIndex = Math.min(fragIndex, fragCount)
                        percent = Math.max(0, Math.min(1, clampedIndex / fragCount))
                      }
                    }
                  } else {
                    // Use frag_index / frag_count ratio
                    const fragCount = toNumber(data.frag_count)
                    const fragIndex = toNumber(data.frag_index)
                    if (!Number.isNaN(fragCount) && fragCount > 0 && !Number.isNaN(fragIndex)) {
                      // Clamp frag_index to frag_count to ensure ratio doesn't exceed 1
                      const clampedIndex = Math.min(fragIndex, fragCount)
                      percent = Math.max(0, Math.min(1, clampedIndex / fragCount))
                    }
                  }

                  onProgress({ percent })
                }
              } catch {
                // Ignore lines that aren't valid JSON
                // This handles non-progress lines from yt-dlp
              }
            }

            child.stderr.setEncoding('utf8')
            child.stderr.on('data', (chunk) => {
              const text = chunk as string
              stderr = (stderr + text).slice(-16384)
              text.split(/[\r\n]+/).forEach(parseAndEmit)
            })
            child.stdout.setEncoding('utf8')
            child.stdout.on('data', (chunk) => {
              // do not print to console; parse progress only
              const text = chunk as string
              text.split(/[\r\n]+/).forEach(parseAndEmit)
            })
            child.on('error', (err) => reject(err))
            child.on('close', (code) => {
              if (code === 0) {
                onProgress({ percent: 1 })
                resolve()
              } else {
                reject(
                  new Error(
                    `yt-dlp download failed (code ${code}): ${stderr.trim() || 'No diagnostic output'}`
                  )
                )
              }
            })
          })
      )
    },
    catch: (e) =>
      e instanceof Error ? e : new Error('Failed to download youtube video with progress')
  })
