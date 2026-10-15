import { Effect } from 'effect'
import { USDB_API_URL } from './config.js'
import type { UsdbSong, UsdbSearchPage, UsdbSearchParams } from '../../../shared/types'

/* Code by: https://github.com/martiinii/UltraStar-CLI */

/**
 * Parse single song result
 * @param html HTML string from parseUsdbSearchPage
 * @returns UsdbSong object with id, artist, title and languages fields
 */
export const parseUsdbSongFromTable = (html: string | undefined): UsdbSong | null => {
  if (!html) return null

  const songId = Number.parseInt(html.match(/show_detail\((\d+)\)/)?.[1] ?? '-1')
  const songMetadata = [...html.matchAll(/<td\s+.*?>(?:<a.*?>)?(.*)<\/td>/gm)].map((m) => m?.[1])

  const artist = songMetadata?.[0]
  const title = songMetadata?.[1]
  const languages = songMetadata?.[6]?.toLowerCase().split(', ')

  if (!songId || !artist || !title || !languages) return null

  return {
    apiId: songId,
    artist,
    title,
    languages
  }
}

/**
 * Parse songs from search result as page
 * @param html HTML response from the USDB search page
 * @returns UsdbSearchPage object with totalPages and songs fields
 */
export const parseUsdbSearchPage = (html: string): UsdbSearchPage => {
  const totalPages = Number.parseInt(
    html.match(/<br>There are\s+\d+\s+results? on\s+(\d+)\s+page/)?.[1] ?? '0'
  )

  const songsHtml = [...html.matchAll(/<tr class="list_tr[12].*?>\s*([\s\S]*?)\s*<\/tr>/gm)]
  const songs = songsHtml
    .map((s) => parseUsdbSongFromTable(s?.[1]))
    .filter((s): s is UsdbSong => Boolean(s))

  return {
    totalPages,
    songs
  }
}

const clampLimit = (limit: number | undefined): number => {
  if (limit == null || Number.isNaN(limit)) return 100
  return Math.min(100, Math.max(1, Math.floor(limit)))
}

const normalizeStart = (start: number | undefined): number => {
  if (start == null || Number.isNaN(start)) return 0
  return Math.max(0, Math.floor(start))
}

const buildFormBody = (params: UsdbSearchParams): URLSearchParams => {
  const form = new URLSearchParams()
  // Static params
  form.set('order', 'lastchange')
  form.set('ud', 'desc')

  // Dynamic params
  if (params.interpret && params.interpret.trim().length > 0) {
    form.set('interpret', params.interpret.trim())
  }
  if (params.title && params.title.trim().length > 0) {
    form.set('title', params.title.trim())
  }
  form.set('limit', String(clampLimit(params.limit)))
  form.set('start', String(normalizeStart(params.start)))

  return form
}

/**
 * Scrape the USDB search page and parse results into a UsdbSearchPage object.
 */
export const searchUsdbSongs = (
  params: UsdbSearchParams,
  cookie?: string
): Effect.Effect<UsdbSearchPage, Error, never> =>
  Effect.gen(function* () {
    const form = buildFormBody(params)
    const response = yield* Effect.tryPromise({
      try: async () =>
        await fetch(`${USDB_API_URL}/?link=list`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            ...(cookie ? { Cookie: cookie } : {})
          },
          body: form.toString()
        }),
      catch: (e) => (e instanceof Error ? e : new Error('Failed to execute request'))
    })

    if (!response.ok) {
      return yield* Effect.fail(
        new Error(`Search request failed: ${response.status} ${response.statusText}`)
      )
    }

    const html = yield* Effect.tryPromise({
      try: async () => await response.text(),
      catch: (e) => (e instanceof Error ? e : new Error('Failed to read response body'))
    })

    return parseUsdbSearchPage(html)
  })
