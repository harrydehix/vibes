import { Effect } from 'effect'
import { USDB_API_URL } from './config.js'

/* Code by: https://github.com/martiinii/UltraStar-CLI */

export type UsdbYoutubeLink = {
  createdAt: Date
  link: string
}

export const parseUsdbComments = (html: string): string[] => {
  return [...html.matchAll(/<td>\d+\.\d+\.\d+ - \d+:\d+.*?<\/td>[\s\S]*?<\/td>/gm)].map((m) => m[0])
}

export const parseUsdbYoutubeLinkFromComment = (
  r: RegExpMatchArray | null
): UsdbYoutubeLink | null => {
  const dateStr = r?.[1]
  const timeStr = r?.[2]
  const linkRaw = r?.[3]

  if (!dateStr || !timeStr || !linkRaw) return null

  const [day, month, year] = dateStr.split('.') as [string, string, string]
  const [hour, minute] = timeStr.split(':') as [string, string]

  const date = new Date(`${month}.${day}.${year} ${hour}:${minute}`)

  const link = linkRaw.split('/').pop()
  if (!link) return null

  return {
    createdAt: date,
    link
  }
}

export const parseUsdbYoutubeLinks = (html: string): UsdbYoutubeLink[] => {
  const comments = parseUsdbComments(html)
    .map((c) => c.match(/<td>(\d+\.\d+\.\d+) - (\d+:\d+)[\s\S]*src="http(.*?(?=youtu\.?be).*?)"/m))
    .map(parseUsdbYoutubeLinkFromComment)
    .filter(Boolean) as UsdbYoutubeLink[]

  return comments
}

export const fetchUsdbSongPage = (id: number, cookie?: string) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${USDB_API_URL}/?link=detail&id=${id}`, {
        method: 'GET',
        headers: {
          ...(cookie ? { Cookie: cookie } : {})
        }
      })
      if (!response.ok) {
        throw new Error(`Detail request failed: ${response.status} ${response.statusText}`)
      }
      return await response.text()
    },
    catch: (e) => (e instanceof Error ? e : new Error('Failed to fetch detail page'))
  })

export const getUsdbYoutubeLinksById = (id: number, cookie?: string) =>
  Effect.gen(function* () {
    const html = yield* fetchUsdbSongPage(id, cookie)
    return parseUsdbYoutubeLinks(html)
  })
