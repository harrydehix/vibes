import { Effect } from 'effect'
import { searchUsdbSongs } from './api/search'
import { prepareUsdbSongFiles, sanitizeForPath } from './files'
import type {
  UsdbSearchParams,
  UsdbSearchPage,
  UsdbDownloadParams,
  SongImportResult
} from '../../../../shared/types'
import { registerUsdbUser, generateRandomUsername, generateRandomPassword } from './api/register'
import { loginUsdb } from './api/auth'
import path, { join } from 'node:path'
import { rm } from 'node:fs/promises'
import type { ImportCandidate } from '../../../../shared/types'

/* Code by: https://github.com/martiinii/UltraStar-CLI */

let usdbSessionCookie: string | undefined

/**
 * Initializes the USDB session by registering a temporary user and logging in.
 * Stores the session cookie for subsequent requests.
 */
export async function initializeUsdbSession(): Promise<void> {
  try {
    console.log('Initializing USDB session (registering and logging in)...')
    const username = generateRandomUsername()
    const password = generateRandomPassword()
    const email = `${username}@example.com`

    await Effect.runPromise(registerUsdbUser({ user: username, pass: password, email }))
    console.log(`Registered temporary user: ${username}`)

    usdbSessionCookie = await Effect.runPromise(loginUsdb({ user: username, pass: password }))
    console.log('Successfully logged in. Cookie acquired.')
  } catch (error) {
    console.error('Failed to initialize USDB session:', error)
  }
}

/**
 * Searches for songs in the USDB database.
 *
 * @param params The search parameters (e.g., interpret, title, limit, start).
 * @returns A promise resolving to a UsdbSearchPage containing the search results.
 */
export async function searchUsdb(params: UsdbSearchParams): Promise<UsdbSearchPage> {
  if (!usdbSessionCookie) {
    await initializeUsdbSession()
  }
  console.log('Searching USDB songs with params:', params)
  const result = await Effect.runPromise(searchUsdbSongs(params, usdbSessionCookie))
  console.log('Search results:', result)
  return result
}

export async function searchUsdbCandidates(query: string): Promise<ImportCandidate[]> {
  const parts = query.split(/\s+-\s+/)
  let songs: UsdbSearchPage['songs']
  if (parts.length > 1) {
    const interpret = parts[0]
    const title = parts.slice(1).join(' - ')
    const page = await searchUsdb({ interpret, title, limit: 100, start: 0 })
    songs = page.songs.length
      ? page.songs
      : (await searchUsdb({ interpret: title, title: interpret, limit: 100, start: 0 })).songs
  } else {
    const pages = await Promise.all([
      searchUsdb({ title: query, limit: 50, start: 0 }),
      searchUsdb({ interpret: query, limit: 50, start: 0 })
    ])
    songs = pages.flatMap((page) => page.songs)
  }
  return [...new Map(songs.map((song) => [song.apiId, song])).values()].map((song) => ({
    source: 'usdb',
    id: String(song.apiId),
    title: song.title.replace(/&amp;/g, '&'),
    artist: song.artist.replace(/&amp;/g, '&'),
    song
  }))
}

/**
 * Downloads a song from USDB (including cover, lyrics/txt, and YouTube video/audio).
 *
 * @param params Parameters containing the song, optional cookie, base directory, and progress callback.
 * @returns A promise resolving to the download result containing directory information.
 */
export async function downloadUsdbSong(params: UsdbDownloadParams): Promise<SongImportResult> {
  if (!usdbSessionCookie && !params.cookie) await initializeUsdbSession()
  if (!params.cookie && usdbSessionCookie) {
    params.cookie = usdbSessionCookie
  }
  if (!params.cookie) throw new Error('Could not authenticate with USDB')
  const dirName = path.join(
    params.baseDir ?? join(process.cwd(), 'songs'),
    sanitizeForPath(`${params.song.artist} - ${params.song.title}`)
  )
  try {
    console.log('Downloading USDB song:', params.song.artist, params.song.title)
    const result = await Effect.runPromise(prepareUsdbSongFiles(params))
    console.log('Download result:', result)
    return result
  } catch (err) {
    await rm(dirName, { recursive: true, force: true })
    throw err
  }
}
