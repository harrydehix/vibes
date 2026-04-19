import { Effect } from 'effect'
import { searchSongs, type SearchParams, type Page } from './usdb/search'
import {
  downloadSong,
  sanitizeForPath,
  type DownloadSongParams,
  type DownloadSongResult
} from './downloadSong'
import { register, generateRandomUsername, generateRandomPassword } from './usdb/register'
import { login } from './usdb/auth'
import path, { join } from 'node:path'
import { rm } from 'node:fs/promises'

/* Code by: https://github.com/martiinii/UltraStar-CLI */

let globalCookie: string | undefined

/**
 * Initializes the downloader by registering a temporary user and logging in.
 * Stores the session cookie for subsequent requests.
 */
export async function init(): Promise<void> {
  try {
    console.log('Initializing downloader (registering and logging in)...')
    const username = generateRandomUsername()
    const password = generateRandomPassword()
    const email = `${username}@example.com`

    await Effect.runPromise(register({ user: username, pass: password, email }))
    console.log(`Registered temporary user: ${username}`)

    globalCookie = await Effect.runPromise(login({ user: username, pass: password }))
    console.log('Successfully logged in. Cookie acquired.')
  } catch (error) {
    console.error('Failed to initialize downloader:', error)
  }
}

/**
 * Searches for songs in the USDB database.
 *
 * @param params The search parameters (e.g., interpret, title, limit, start).
 * @param cookie Optional auth cookie for authenticated searches.
 * @returns A promise resolving to a Page containing the search results.
 */
export async function search(params: SearchParams): Promise<Page> {
  if (!globalCookie) {
    await init()
  }
  console.log('Searching for songs with params:', params, 'and cookie:', globalCookie)
  const result = await Effect.runPromise(searchSongs(params, globalCookie))
  console.log('Search results:', result)
  return result
}

/**
 * Downloads a song from USDB (including cover, lyrics/txt, and YouTube video/audio).
 *
 * @param params Parameters containing the song, optional cookie, base directory, and progress callback.
 * @returns A promise resolving to the download result containing directory information.
 */
export async function download(params: DownloadSongParams): Promise<DownloadSongResult> {
  if (!params.cookie && globalCookie) {
    params.cookie = globalCookie
  }
  const dirName = path.join(
    params.baseDir ?? join(process.cwd(), 'songs'),
    sanitizeForPath(`${params.song.artist} - ${params.song.title}`)
  )
  try {
    console.log('Downloading song with params:', params)
    const result = await Effect.runPromise(downloadSong(params))
    console.log('Download result:', result)
    return result
  } catch (err) {
    await rm(dirName, { recursive: true, force: true })
    throw err
  }
}
