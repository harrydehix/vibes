import { spawn } from 'node:child_process'
import { Effect } from 'effect'
import { z } from 'zod'
import { ytDlpManager } from '../../../../dependencies/ytdlp'

/* Code by: https://github.com/martiinii/UltraStar-CLI */

export const YoutubeThumbnailSchema = z.object({
  url: z.string(),
  id: z.string().optional(),
  height: z.number().nullish(),
  width: z.number().nullish()
})
export type YoutubeThumbnail = z.infer<typeof YoutubeThumbnailSchema>

export const YoutubeVideoSchema = z.object({
  id: z.string(),
  url: z
    .string()
    .nullish()
    .transform((value) => value ?? ''),
  title: z.string(),
  description: z.string().nullish(),
  duration: z.number().nullish(),
  channel_id: z.string().nullish(),
  channel: z.string().nullish(),
  channel_url: z.string().nullish(),
  thumbnails: z.array(YoutubeThumbnailSchema).default([]),
  view_count: z.number().nullish(),
  channel_is_verified: z.boolean().nullish()
})
export type YoutubeVideo = z.infer<typeof YoutubeVideoSchema>

/**
 * Search youtube videos using yt-dlp and parse JSONL output.
 */
export const searchYoutubeVideos = (search: string): Effect.Effect<YoutubeVideo[], Error, never> =>
  Effect.tryPromise({
    try: async () => {
      const args = [
        '--match-filters',
        'original_url!*=/shorts/',
        `ytsearch5:${search}`,
        '--flat-playlist',
        '-j',
        '--no-simulate'
      ]

      const result = await new Promise<string>((resolve, reject) => {
        const child = spawn(ytDlpManager.binPath, args, {
          stdio: ['ignore', 'pipe', 'pipe']
        })
        let stdout = ''
        let stderr = ''

        child.stdout.setEncoding('utf8')
        child.stdout.on('data', (chunk) => {
          stdout += chunk as string
        })
        child.stderr.setEncoding('utf8')
        child.stderr.on('data', (chunk) => {
          stderr += chunk as string
        })
        child.on('error', (err) => reject(err))
        child.on('close', (code) => {
          if (code === 0) resolve(stdout)
          else reject(new Error(`yt-dlp search failed (code ${code}): ${stderr.trim()}`))
        })
      })

      return result
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => YoutubeVideoSchema.parse(JSON.parse(line)))
    },
    catch: (e) => (e instanceof Error ? e : new Error('Failed to search youtube'))
  })
