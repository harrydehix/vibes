import { AsyncLocalStorage } from 'node:async_hooks'
import type { Innertube } from 'youtubei.js'
import type { ImportCandidate } from '../../shared/types'
import { normalizeYoutubeUrl } from '../../shared/youtubeUrl'
import { discoverCaptionedMusic, isMusicVideo } from './discovery'

type YoutubeCandidate = Extract<ImportCandidate, { source: 'youtube' }>
type InspectedVideo = YoutubeCandidate & { isMusic: boolean }
type Cached<Value> = { value: Value; expiresAtMs: number }

const cacheTtlMs = 5 * 60_000
const searchCache = new Map<string, Cached<YoutubeCandidate[]>>()
const videoCache = new Map<string, Cached<InspectedVideo>>()
const requestContext = new AsyncLocalStorage<AbortSignal>()
let clientPromise: Promise<Innertube> | undefined
let retryAfter = 0

function cached<Value>(cache: Map<string, Cached<Value>>, key: string): Value | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (entry.expiresAtMs <= Date.now()) {
    cache.delete(key)
    return undefined
  }
  return entry.value
}

function remember<Value>(
  cache: Map<string, Cached<Value>>,
  key: string,
  value: Value,
  limit: number
): void {
  cache.delete(key)
  cache.set(key, { value, expiresAtMs: Date.now() + cacheTtlMs })
  while (cache.size > limit) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

async function requestFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (retryAfter > Date.now())
    throw new Error('YouTube is limiting searches. Please wait before trying again.')
  const signals = [AbortSignal.timeout(12_000)]
  const signal = requestContext.getStore()
  if (signal) signals.push(signal)
  if (init?.signal) signals.push(init.signal)
  const response = await fetch(input, { ...init, signal: AbortSignal.any(signals) })
  if (response.status === 429) {
    const delay = response.headers.get('retry-after')
    const seconds = delay ? Number(delay) : NaN
    retryAfter = Number.isFinite(seconds)
      ? Date.now() + Math.max(1, seconds) * 1000
      : Math.max(Date.now() + 60_000, Date.parse(delay ?? '') || 0)
    throw new Error('YouTube is limiting searches. Please wait before trying again.')
  }
  if (!response.ok) throw new Error(`YouTube search failed (HTTP ${response.status}).`)
  return response
}

async function getClient(): Promise<Innertube> {
  clientPromise ??= import('youtubei.js').then(({ Innertube }) =>
    Innertube.create({
      retrieve_player: true,
      generate_session_locally: true,
      lang: 'en',
      fetch: requestFetch
    })
  )
  try {
    return await clientPromise
  } catch (error) {
    clientPromise = undefined
    throw error
  }
}

async function inspect(
  client: Innertube,
  url: string,
  signal: AbortSignal
): Promise<InspectedVideo> {
  signal.throwIfAborted()
  const id = new URL(normalizeYoutubeUrl(url)).searchParams.get('v')!
  const saved = cached(videoCache, id)
  if (saved) return saved
  const info = await client.getBasicInfo(id)
  signal.throwIfAborted()
  const metadata = info.basic_info
  if (metadata.id !== id || !metadata.title) throw new Error('Could not inspect this YouTube video')
  if (info.playability_status?.status !== 'OK') throw new Error('This YouTube video is unavailable')
  const captions = info.captions
  // SDK indices refer to the unfiltered list, including tracks we cannot import.
  const audioTrack = captions?.audio_tracks?.[captions.default_audio_track_index ?? 0]
  const defaultTrack = captions?.caption_tracks?.[audioTrack?.default_caption_track_index ?? -1]
  const candidate: InspectedVideo = {
    source: 'youtube',
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    title: metadata.title,
    artist: metadata.author || metadata.channel?.name || 'Unknown Artist',
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    isMusic:
      !metadata.is_live &&
      !metadata.is_upcoming &&
      isMusicVideo({ categories: [metadata.category ?? ''] }),
    tracks: (info.captions?.caption_tracks ?? [])
      .filter(
        (track) => track.base_url && track.language_code && track.language_code !== 'live_chat'
      )
      .map((track) => {
        const automatic = track.kind === 'asr'
        // vss_id matches yt-dlp's track IDs; language_code is only the display language.
        const code = track.vss_id?.replace(/^\./, '').replace(/\./g, '-') || track.language_code
        const language = automatic ? code.replace(/^a-/, '') : code
        return {
          id: `${automatic ? 'auto' : 'manual'}:${language}`,
          language: track.language_code,
          name: track.name.toString() || track.language_code,
          automatic,
          ...(track === defaultTrack ? { isDefault: true } : {})
        }
      })
  }
  remember(videoCache, id, candidate, 200)
  return candidate
}

export async function inspectYoutubeVideo(input: string): Promise<YoutubeCandidate> {
  const client = await getClient()
  const signal = new AbortController().signal
  return await requestContext.run(signal, async () =>
    structuredClone(await inspect(client, input, signal))
  )
}

function videoUrls(result: Awaited<ReturnType<Innertube['search']>>, lyricsOnly = false): string[] {
  return [
    ...new Set(
      result.videos.flatMap((video) =>
        video.type === 'Video' &&
        'video_id' in video &&
        'is_live' in video &&
        'is_upcoming' in video &&
        (!lyricsOnly || ('title' in video && /\blyrics\b/i.test(video.title?.toString() ?? ''))) &&
        /^[a-zA-Z0-9_-]{11}$/.test(video.video_id) &&
        !video.is_live &&
        !video.is_upcoming
          ? [`https://www.youtube.com/watch?v=${video.video_id}`]
          : []
      )
    )
  ].slice(0, 10)
}

export async function searchYoutube(
  query: string,
  signal = new AbortController().signal
): Promise<YoutubeCandidate[]> {
  signal.throwIfAborted()
  const search = query.trim()
  if (!search) return []
  if (search.length > 300) throw new Error('Search is too long')
  const key = search.toLowerCase()
  const saved = cached(searchCache, key)
  if (saved) return structuredClone(saved)
  const client = await getClient()
  signal.throwIfAborted()
  return await requestContext.run(signal, async () => {
    let urls: string[]
    let failed = false
    let normalUrls = new Set<string>()
    let lyricsUrls = new Set<string>()
    if (/^https?:\/\//i.test(search)) {
      urls = [normalizeYoutubeUrl(search)]
    } else {
      const searchResponses = await Promise.allSettled([
        client.search(search, { type: 'video' }),
        client.search(`${search} lyrics`, { type: 'video' })
      ])
      signal.throwIfAborted()
      const [normal, lyrics] = searchResponses
      if (normal.status === 'rejected' && lyrics.status === 'rejected') throw normal.reason
      failed = searchResponses.some((result) => result.status === 'rejected')
      const normalResults = normal.status === 'fulfilled' ? videoUrls(normal.value) : []
      const lyricsResults = lyrics.status === 'fulfilled' ? videoUrls(lyrics.value, true) : []
      normalUrls = new Set(normalResults)
      lyricsUrls = new Set(lyricsResults)
      const combined: string[] = []
      for (let index = 0; index < Math.max(normalResults.length, lyricsResults.length); index++) {
        if (normalResults[index]) combined.push(normalResults[index])
        if (lyricsResults[index]) combined.push(lyricsResults[index])
      }
      urls = [...new Set(combined)].slice(0, 10)
    }
    const results = await discoverCaptionedMusic(
      urls,
      async (url) => {
        try {
          const video = await inspect(client, url, signal)
          if (
            lyricsUrls.has(url) &&
            (!normalUrls.has(url) || !video.tracks.some((track) => !track.automatic))
          )
            return { ...video, lyricsInVideo: true, tracks: [] }
          return video
        } catch (error) {
          failed = true
          throw error
        }
      },
      signal
    )
    // Cache successful video checks, but allow an incomplete query to recover on the next search.
    if (!failed) remember(searchCache, key, results, 50)
    return structuredClone(results)
  })
}
