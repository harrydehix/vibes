import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Effect } from 'effect'
import { z } from 'zod'
import type {
  CaptionTrack,
  ImportCandidate,
  SongImportRequest,
  SongManifest
} from '../../../../shared/types'
import { DownloadError } from '../../../../shared/errors'
import { markDefaultCaptionTrack, resolveCaptionTrack } from '../../../../shared/captionTracks'
import { ytDlpManager } from '../../../dependencies/ytdlp'
import { downloadYoutubeVideoWithProgress } from './media/download'
import { isYoutubeLink, normalizeYoutubeUrl } from '../../../../shared/youtubeUrl'
import { parseYoutubeCaptions } from '../../lyrics/captions'
import { songManifestFile } from '../../formats/manifest'
import { isMusicVideo } from './discovery'
import { youtubeAuthManager } from '../../../youtube-auth/index'
import { inspectYoutubeVideo, searchYoutube } from './search'

export { searchYoutube, inspectYoutubeVideo } from './search'

export async function searchYoutubeCandidates(
  query: string,
  signal?: AbortSignal
): Promise<ImportCandidate[]> {
  signal?.throwIfAborted()
  if (!isYoutubeLink(query)) return searchYoutube(query, signal)
  const candidate = await inspectYoutubeWithDefaultCaptions(query)
  signal?.throwIfAborted()
  return [candidate.tracks.length ? candidate : { ...candidate, lyricsInVideo: true }]
}

const runFile = promisify(execFile)
type InspectedYoutube = Extract<ImportCandidate, { source: 'youtube' }> & { isMusic: boolean }
const SubtitleFormatSchema = z.object({ ext: z.string().nullish(), name: z.string().nullish() })
const YoutubeMetadataSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string().nullish(),
  track: z.string().nullish(),
  uploader: z.string().nullish(),
  channel: z.string().nullish(),
  categories: z.array(z.string()).nullish(),
  is_live: z.boolean().nullish(),
  is_upcoming: z.boolean().nullish(),
  subtitles: z.record(z.string(), z.array(SubtitleFormatSchema)).nullish(),
  automatic_captions: z.record(z.string(), z.array(SubtitleFormatSchema)).nullish()
})

async function runYtDlp(args: string[], timeout = 90_000): Promise<string> {
  return await youtubeAuthManager.withCookies(async (cookieArgs) => {
    const { stdout } = await runFile(ytDlpManager.binPath, [...cookieArgs, ...args], {
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      encoding: 'utf8'
    })
    return stdout
  })
}

export async function inspectYoutube(input: string): Promise<InspectedYoutube> {
  const url = normalizeYoutubeUrl(input)
  const info = YoutubeMetadataSchema.parse(
    JSON.parse(
      await runYtDlp(
        ['--ignore-config', '--no-playlist', '--skip-download', '--dump-single-json', '--', url],
        30_000
      )
    )
  )
  const id = new URL(url).searchParams.get('v')!
  if (info.id !== id || !info.title)
    throw new DownloadError('video_unavailable', 'Could not inspect this YouTube video')
  if (info.is_live || info.is_upcoming)
    throw new DownloadError('live_video', 'Live streams cannot be imported')
  const tracks: CaptionTrack[] = []
  for (const [automatic, subtitles] of [
    [false, info.subtitles],
    [true, info.automatic_captions]
  ] as const) {
    for (const [language, formats] of Object.entries(subtitles ?? {})) {
      if (language === 'live_chat' || !Array.isArray(formats)) continue
      const format = formats.find((format) => format.ext === 'json3')
      if (!format) continue
      tracks.push({
        id: `${automatic ? 'auto' : 'manual'}:${language}`,
        language,
        name: format.name || language,
        automatic
      })
    }
  }
  return {
    source: 'youtube',
    id,
    url,
    title: info.track || info.title,
    artist: info.artist || info.uploader || 'Unknown Artist',
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    isMusic: isMusicVideo({
      track: info.track ?? undefined,
      artist: info.artist ?? undefined,
      categories: info.categories ?? undefined
    }),
    tracks
  }
}

/** Direct-link previews keep native metadata; SDK default captions are optional enrichment. */
export async function inspectYoutubeWithDefaultCaptions(input: string): Promise<InspectedYoutube> {
  const candidate = await inspectYoutube(input)
  if (!candidate.tracks.length) return candidate
  try {
    const video = await inspectYoutubeVideo(candidate.url)
    markDefaultCaptionTrack(
      candidate.tracks,
      video.tracks.find((track) => track.isDefault)
    )
  } catch (error) {
    console.warn('Could not identify the default YouTube captions:', error)
  }
  return candidate
}

export async function importYoutube(
  request: Extract<SongImportRequest, { candidate: { source: 'youtube' } }>,
  folder: string,
  onProgress: (progress: number) => void
): Promise<void> {
  const lyricsInVideo = request.lyricsInVideo === true
  if (lyricsInVideo && request.candidate.lyricsInVideo !== true)
    throw new DownloadError('invalid_request', 'Invalid video-lyrics import request')
  const candidate = await inspectYoutube(request.candidate.url)
  if (candidate.id !== request.candidate.id)
    throw new DownloadError('video_unavailable', 'YouTube video identity changed')
  if (lyricsInVideo && !candidate.isMusic)
    throw new DownloadError('not_music', 'Only music videos can be imported')
  const track = lyricsInVideo
    ? undefined
    : resolveCaptionTrack(request.captionTrackId, request.candidate.tracks, candidate.tracks)
  if (!lyricsInVideo && !track) {
    const available = candidate.tracks.map((track) => track.id).join(', ') || 'none'
    throw new DownloadError(
      'captions_unavailable',
      `The selected caption track is no longer available (${request.captionTrackId}; yt-dlp tracks: ${available})`
    )
  }
  const title = request.title.trim()
  const artist = request.artist.trim()
  if (!title || !artist) throw new DownloadError('invalid_request', 'Title and artist are required')
  let lyrics: SongManifest['lyrics'] = { timing: 'video', lines: [] }
  if (track) {
    const language = track.language.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    await runYtDlp([
      '--ignore-config',
      '--no-playlist',
      '--skip-download',
      track.automatic ? '--write-auto-subs' : '--write-subs',
      track.automatic ? '--no-write-subs' : '--no-write-auto-subs',
      '--sub-langs',
      `^${language}$`,
      '--sub-format',
      'json3',
      '-o',
      join(folder, 'captions.%(ext)s'),
      '--',
      candidate.url
    ])
    const captions = (await readdir(folder)).find((filename) => filename.endsWith('.json3'))
    if (!captions)
      throw new DownloadError(
        'captions_unavailable',
        'yt-dlp did not download the selected caption track'
      )
    const contents = await readFile(join(folder, captions), 'utf8')
    let lines: SongManifest['lyrics']['lines']
    try {
      lines = parseYoutubeCaptions(contents, track.automatic)
    } catch (error) {
      throw new DownloadError('invalid_captions', 'Could not parse the downloaded captions', {
        cause: error
      })
    }
    await rename(join(folder, captions), join(folder, 'captions.json3'))
    lyrics = {
      timing: 'phrase',
      lines,
      originalFile: 'captions.json3',
      language: track.language,
      automatic: track.automatic
    }
  }
  onProgress(0.05)
  await Effect.runPromise(
    downloadYoutubeVideoWithProgress(candidate.url, join(folder, 'video.mp4'), (progress) =>
      onProgress(0.05 + progress.percent * 0.9)
    )
  )
  const manifest: SongManifest = {
    version: 1,
    source: { provider: 'youtube', id: candidate.id, url: candidate.url },
    title,
    artist,
    language: track ? [track.language] : [],
    media: { video: 'video.mp4' },
    lyrics
  }
  if (candidate.thumbnail) {
    try {
      const response = await fetch(candidate.thumbnail, { signal: AbortSignal.timeout(15_000) })
      if (response.ok) {
        const contentType = response.headers.get('content-type')?.split(';')[0]
        const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[
          contentType ?? ''
        ]
        if (extension) {
          const filename = `cover.${extension}`
          await writeFile(join(folder, filename), Buffer.from(await response.arrayBuffer()))
          manifest.media.cover = filename
        }
      }
    } catch (error) {
      console.warn('Could not download the YouTube thumbnail:', error)
    }
  }
  await writeFile(join(folder, songManifestFile), JSON.stringify(manifest, null, 2), 'utf8')
}
