import { Effect } from 'effect'
import { USDB_API_URL } from './config.js'

/* Code by: https://github.com/martiinii/UltraStar-CLI */

export type UltrastarHeaderName =
  | 'artist'
  | 'title'
  | 'mp3'
  | 'creator'
  | 'cover'
  | 'background'
  | 'year'
  | 'language'
  | 'bpm'
  | 'gap'
  | 'video'
  | 'videogap'

export type UltrastarSongHeaders = Map<UltrastarHeaderName, string>

export type UsdbSongMetadata = {
  artist: string | null | undefined
  title: string | null | undefined
  year: string | number | null | undefined
  languages: string[] | null | undefined
}

export type ParsedUsdbLyrics = {
  headers: { [k in UltrastarHeaderName]?: string }
  metadata: UsdbSongMetadata
  lyrics: string
} | null

/**
 * Converts Map to Object with correct types
 */
export const mapToObject = <K extends string, V>(map: Map<K, V>) =>
  Object.fromEntries(map) as { [k in K]?: V }

/**
 * Parse lyrics of a song
 * Keeps the provided regex logic intact.
 */
export const parseUsdbLyrics = (html: string): ParsedUsdbLyrics => {
  const text = html.match(/<textarea.*?>([\s\S]*)<\/textarea>/m)?.[1]
  if (!text) return null

  const headersRaw = [...text.matchAll(/^#(.*:.*)$/gm)]
  const headers: UltrastarSongHeaders = new Map()

  headersRaw.forEach((h) => {
    const [header, value] = h[1]?.split(':') ?? []
    if (header && value) headers.set(header.toLowerCase() as UltrastarHeaderName, value)
  })

  const metadata: UsdbSongMetadata = {
    artist: headers.get('artist') ?? 'Unknown',
    title: headers.get('title') ?? 'Unknown',
    year: headers.get('year') ?? '0',
    languages: headers.get('language')?.toLowerCase().split(', ') ?? ['unknown']
  }

  return {
    headers: mapToObject(headers),
    metadata,
    // Remove header lines beginning with #Header:Value
    lyrics: text.replaceAll(/^#.*:.*$[\n\r]+/gm, '')
  }
}

/**
 * Fetch lyrics page HTML for a given song id.
 */
export const fetchUsdbLyricsPage = (id: number, cookie?: string) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${USDB_API_URL}/?link=editsongs&id=${id}`, {
        method: 'GET',
        headers: {
          ...(cookie ? { Cookie: cookie } : {})
        }
      })
      if (!response.ok) {
        throw new Error(`Lyrics request failed: ${response.status} ${response.statusText}`)
      }
      return await response.text()
    },
    catch: (e) => (e instanceof Error ? e : new Error('Failed to fetch lyrics page'))
  })

/**
 * High-level API: scrape and parse lyrics by id
 */
export const getUsdbLyricsById = (id: number, cookie?: string) =>
  Effect.gen(function* () {
    const html = yield* fetchUsdbLyricsPage(id, cookie)
    return parseUsdbLyrics(html)
  })
