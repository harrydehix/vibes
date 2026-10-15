import assert from 'node:assert/strict'
import { type TestContext } from 'node:test'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { loadTestModule } from './helpers.ts'
import { Effect } from 'effect'
import * as youtubeUrl from '../src/shared/youtubeUrl.ts'
import { normalizeYoutubeUrl } from '../src/shared/youtubeUrl.ts'
import { parseYoutubeCaptions } from '../src/main/song-import/captions.ts'
import {
  parseSongManifest,
  parseSongSource,
  songManifestFile
} from '../src/main/song-import/manifest.ts'
import type { Song, SongDeleteResponse, SongManifest } from '../src/shared/types.ts'
import type { ImportCandidate } from '../src/shared/types.ts'
import { discoverCaptionedMusic, isMusicVideo } from '../src/main/song-import/discovery.ts'
import {
  parseYoutubeCookies,
  requiresYoutubeAuthentication
} from '../src/main/song-import/youtubeCookies.ts'
import { IPC_CHANNELS } from '../src/shared/ipc.ts'
import * as downloadErrors from '../src/shared/errors.ts'
import * as captionTracks from '../src/shared/captionTracks.ts'
import type { YoutubeAuthStatus } from '../src/shared/types.ts'
import type { SongImportRequest } from '../src/shared/types.ts'

export const require = createRequire(import.meta.url)

export async function createSongDeletionFixture(context: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'vibes-delete-test-'))
  context.after(() => rm(base, { recursive: true, force: true }))
  const root = path.join(base, 'library')
  await mkdir(root)
  const roots = [root]
  const handlers = new Map<string, (event: object, ...args: unknown[]) => Promise<unknown>>()
  const errors: unknown[] = []
  let failure: Error | null = null
  const source = await readFile(new URL('../src/main/ipc/songs.ts', import.meta.url), 'utf8')
  const manager = loadTestModule(
    source,
    {
      electron: {
        ipcMain: {
          handle: (
            name: string,
            handler: typeof handlers extends Map<string, infer Handler> ? Handler : never
          ) => handlers.set(name, handler)
        }
      },
      'fs/promises': {
        ...require('node:fs/promises'),
        writeFile: async (filename: string, content: string, encoding: 'utf-8') => {
          if (failure) throw failure
          await writeFile(filename, content, encoding)
        },
        rm: async (folder: string, options: Parameters<typeof rm>[1]) => {
          if (failure) throw failure
          await rm(folder, options)
        }
      },
      path: { default: path },
      './settings': { settingsManager: { settings: { songFolders: roots } } },
      '../../shared/ipc': { IPC_CHANNELS },
      '../song-import/manifest': { parseSongManifest, parseSongSource, songManifestFile }
    },
    { console: { log: () => {}, warn: () => {}, error: (...args: unknown[]) => errors.push(args) } }
  ).songManager as {
    _songs: Song[]
    songs: Song[]
    defineIpcHandles: () => Promise<void>
  }
  await manager.defineIpcHandles()
  return {
    base,
    root,
    roots,
    manager,
    errors,
    deleteSong: (id: unknown) =>
      handlers.get(IPC_CHANNELS.SONGS.DELETE)!({}, id) as Promise<SongDeleteResponse>,
    fixOffset: (song: Song, offsetMs: unknown) =>
      handlers.get(IPC_CHANNELS.SONGS.FIX_OFFSET)!({}, song.meta.id, offsetMs) as Promise<void>,
    songPlayed: (id: string) =>
      handlers.get(IPC_CHANNELS.SONGS.SONG_PLAYED)!({}, id) as Promise<void>,
    refreshSongs: () => handlers.get(IPC_CHANNELS.SONGS.REFRESH)!({}) as Promise<Song[]>,
    addSong: async (folder: string, id: string) => {
      await mkdir(folder, { recursive: true })
      await writeFile(path.join(folder, 'video.mp4'), 'temporary test media')
      const song = parseSongManifest(JSON.stringify(manifest()), folder, manager.songs.length, 0, {
        ...meta,
        id
      })
      manager._songs.push(song)
      return song
    },
    failWith: (error: Error) => {
      failure = error
    }
  }
}

export async function createFfmpegFixture(context: TestContext) {
  const folder = await mkdtemp(path.join(tmpdir(), 'vibes-ffmpeg-test-'))
  context.after(() => rm(folder, { recursive: true, force: true }))
  const bundled = path.join(folder, 'bundled')
  await mkdir(bundled)
  const suffix = process.platform === 'win32' ? '.exe' : ''
  const sources = {
    ffmpeg: path.join(bundled, `ffmpeg${suffix}`),
    ffprobe: path.join(bundled, `ffprobe${suffix}`)
  }
  for (const [name, filename] of Object.entries(sources)) {
    await writeFile(filename, `${name} version fixture`)
  }
  const checks: string[] = []
  const source = await readFile(new URL('../src/main/ipc/ffmpeg.ts', import.meta.url), 'utf8')
  const manager = loadTestModule(
    source,
    {
      electron: { app: { getPath: () => folder, whenReady: async () => {} } },
      'ffmpeg-static': sources.ffmpeg,
      'ffprobe-static': { path: sources.ffprobe },
      'node:child_process': {
        execFile: (
          filename: string,
          args: string[],
          _options: unknown,
          callback: (error: Error | null, stdout: string) => void
        ) => {
          checks.push(filename)
          assert.deepEqual([...args], ['-version'])
          const stdout = existsSync(filename) ? readFileSync(filename, 'utf8') : ''
          queueMicrotask(() =>
            callback(
              stdout.includes('version fixture') ? null : new Error('Invalid binary'),
              stdout
            )
          )
        }
      }
    },
    { console: { log: () => {} } }
  ).ffmpegManager as {
    verified: boolean
    binDir: string
    binPath: string
    probePath: string
    init: () => Promise<void>
  }
  return { manager, sources, checks, folder }
}

export async function createYoutubeAuthFixture(context: TestContext) {
  const folder = await mkdtemp(path.join(tmpdir(), 'vibes-auth-test-'))
  context.after(() => rm(folder, { recursive: true, force: true }))
  const cookiePath = path.join(folder, 'browser-cookies.txt')
  await writeFile(
    cookiePath,
    [
      '# Netscape HTTP Cookie File',
      '.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tfixture-session',
      '.example.com\tTRUE\t/\tTRUE\t0\tSID\tunrelated-fixture'
    ].join('\n')
  )
  const handlers = new Map<string, () => Promise<YoutubeAuthStatus>>()
  const events: YoutubeAuthStatus[] = []
  const temporaryFiles: string[] = []
  let canceled = false
  const source = await readFile(new URL('../src/main/ipc/youtubeAuth.ts', import.meta.url), 'utf8')
  const modules = {
    electron: {
      app: { getPath: () => folder },
      ipcMain: {
        handle: (channel: string, handler: () => Promise<YoutubeAuthStatus>) =>
          handlers.set(channel, handler)
      },
      dialog: { showOpenDialog: async () => ({ canceled, filePaths: [cookiePath] }) },
      shell: { openExternal: async () => {} },
      safeStorage: {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'test-keychain',
        encryptString: (value: string) => Buffer.from(Buffer.from(value).toString('base64')),
        decryptString: (value: Buffer) => Buffer.from(value.toString(), 'base64').toString()
      },
      BrowserWindow: {
        getAllWindows: () => [
          {
            isDestroyed: () => false,
            webContents: {
              send: (_channel: string, status: YoutubeAuthStatus) => events.push(status)
            }
          }
        ]
      }
    },
    'node:child_process': {
      execFile: (
        _bin: string,
        args: string[],
        _options: unknown,
        callback: (error: null) => void
      ) => {
        const filename = args[args.indexOf('--cookies') + 1]
        temporaryFiles.push(filename)
        assert.match(readFileSync(filename, 'utf8'), /fixture-session/)
        assert.doesNotMatch(readFileSync(filename, 'utf8'), /unrelated-fixture/)
        queueMicrotask(() => callback(null))
      }
    },
    '../../shared/ipc': { IPC_CHANNELS },
    '../song-import/youtubeCookies': { parseYoutubeCookies, requiresYoutubeAuthentication },
    '../../shared/errors': downloadErrors,
    './ytdlp': { ytDlpManager: { binPath: 'fixture-yt-dlp' } }
  }
  type Manager = {
    getStatus: () => Promise<YoutubeAuthStatus>
    withCookies: <Result>(operation: (args: string[]) => Promise<Result>) => Promise<Result>
    defineIpcHandles: () => void
  }
  const restart = () => loadTestModule(source, modules).youtubeAuthManager as Manager
  const manager = restart()
  manager.defineIpcHandles()
  return {
    manager,
    restart,
    events,
    temporaryFiles,
    sessionPath: path.join(folder, 'youtube-session.enc'),
    importCookies: () => handlers.get(IPC_CHANNELS.YOUTUBE_AUTH.IMPORT_COOKIES)!(),
    signOut: () => handlers.get(IPC_CHANNELS.YOUTUBE_AUTH.SIGN_OUT)!(),
    cancelPicker: () => {
      canceled = true
    }
  }
}

export const videoId = 'BaW_jenozKc'

export const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`

export const captionFile = (events: unknown[]): string => JSON.stringify({ events })

export const cue = (
  start: number,
  duration: number,
  text: string
): {
  tStartMs: number
  dDurationMs: number
  segs: {
    utf8: string
  }[]
} => ({
  tStartMs: start,
  dDurationMs: duration,
  segs: [{ utf8: text }]
})

export const folder = path.resolve('test-song')

export const meta = { id: 'local-id', playCount: 3, favorite: true }

export function youtubeCandidate(
  id: string,
  isMusic = true,
  captions = true
): Extract<
  ImportCandidate,
  {
    source: 'youtube'
  }
> & {
  isMusic: boolean
} {
  return {
    source: 'youtube',
    id,
    url: canonicalUrl,
    title: 'Song',
    artist: 'Artist',
    isMusic,
    tracks: captions ? [{ id: 'manual:en', name: 'English', language: 'en', automatic: false }] : []
  }
}

export async function createYoutubeImportFixture(context: TestContext) {
  const folder = await mkdtemp(path.join(tmpdir(), 'vibes-youtube-import-'))
  context.after(() => rm(folder, { recursive: true, force: true }))
  const source = await readFile(
    new URL('../src/main/song-import/youtube.ts', import.meta.url),
    'utf8'
  )
  const metadata = {
    id: 'video000000',
    title: 'Song',
    artist: 'Artist',
    categories: ['Music'],
    is_live: false,
    is_upcoming: false,
    subtitles: { en: [{ ext: 'json3', name: 'English' }] } as Record<
      string,
      {
        ext: string
        name: string
      }[]
    >,
    automatic_captions: {} as Record<
      string,
      {
        ext: string
        name: string
      }[]
    >
  }
  const calls = { commands: [] as string[][], downloads: 0, progress: [] as number[] }
  let inspectVideo = async () => youtubeCandidate(metadata.id)
  const candidate: Extract<
    ImportCandidate,
    {
      source: 'youtube'
    }
  > = {
    source: 'youtube',
    id: metadata.id,
    title: 'Song',
    artist: 'Artist',
    url: `https://www.youtube.com/watch?v=${metadata.id}`,
    tracks: [],
    lyricsInVideo: true
  }
  const provider = loadTestModule(
    source,
    {
      'node:util': {
        promisify: () => async (_bin: string, args: string[]) => {
          calls.commands.push(args)
          if (args.includes('--dump-single-json')) return { stdout: JSON.stringify(metadata) }
          if (args.includes('--write-subs') || args.includes('--write-auto-subs')) {
            await writeFile(
              path.join(folder, 'captions.en.json3'),
              JSON.stringify({
                events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Line' }] }]
              })
            )
            return { stdout: '' }
          }
          throw new Error('Unexpected yt-dlp command')
        }
      },
      '../ipc/ytdlp': { ytDlpManager: { binPath: 'yt-dlp-fixture' } },
      '../ipc/youtubeAuth': {
        youtubeAuthManager: { withCookies: (run: (args: string[]) => Promise<string>) => run([]) }
      },
      '../ultrastar-download/youtube/download': {
        downloadYoutubeVideoWithProgress: (
          _url: string,
          output: string,
          progress: (value: { percent: number }) => void
        ) =>
          Effect.promise(async () => {
            calls.downloads++
            await writeFile(output, 'video')
            progress({ percent: 1 })
          })
      },
      './captions': { normalizeYoutubeUrl, parseYoutubeCaptions },
      '../../shared/youtubeUrl': youtubeUrl,
      './manifest': { songManifestFile: 'song.vibes.json' },
      './discovery': { isMusicVideo },
      '../../shared/errors': downloadErrors,
      '../../shared/captionTracks': captionTracks,
      './youtubeSearch': { searchYoutube: () => {}, inspectYoutubeVideo: () => inspectVideo() }
    },
    { URL, Buffer, AbortSignal, fetch: async () => ({ ok: false }), console }
  ) as {
    importYoutube: (
      request: Extract<
        SongImportRequest,
        {
          candidate: {
            source: 'youtube'
          }
        }
      >,
      folder: string,
      onProgress: (value: number) => void
    ) => Promise<void>
    inspectYoutubeWithDefaultCaptions: (url: string) => Promise<ReturnType<typeof youtubeCandidate>>
  }
  const request: Extract<
    SongImportRequest,
    {
      lyricsInVideo: true
    }
  > = {
    candidate,
    lyricsInVideo: true,
    title: 'Song',
    artist: 'Artist'
  }
  return {
    folder,
    metadata,
    candidate,
    request,
    calls,
    inspect: provider.inspectYoutubeWithDefaultCaptions,
    setInspection: (inspect: typeof inspectVideo) => {
      inspectVideo = inspect
    },
    import: (
      value = request as Extract<
        SongImportRequest,
        {
          candidate: {
            source: 'youtube'
          }
        }
      >
    ) => provider.importYoutube(value, folder, (progress) => calls.progress.push(progress))
  }
}

export async function createYoutubeSearchFixture() {
  const source = await readFile(
    new URL('../src/main/song-import/youtubeSearch.ts', import.meta.url),
    'utf8'
  )
  const allIds = Array.from({ length: 24 }, (_, index) => `video${String(index).padStart(6, '0')}`)
  const ids = allIds.slice(0, 12)
  const lyricsIds: string[] = []
  const calls = { searches: [] as string[], inspected: [] as string[], initialized: 0 }
  let now = 0
  let beforeInspect: (id: string) => Promise<void> = async () => {}
  let beforeSearch: (query: string) => Promise<void> = async () => {}
  const metadata = new Map(
    allIds.map((id, index) => [
      id,
      {
        basic_info: {
          id,
          title: `Song ${id}${index >= 12 ? ' (Lyrics)' : ''}`,
          author: 'Artist',
          category: 'Music',
          is_live: false,
          is_upcoming: false
        },
        playability_status: { status: 'OK' },
        captions: {
          caption_tracks: [
            {
              base_url: 'https://www.youtube.com/api/timedtext',
              language_code: 'en',
              name: 'English',
              kind: ''
            }
          ]
        }
      }
    ])
  )
  const searchModule = loadTestModule(
    source,
    {
      'youtubei.js': {
        Innertube: {
          create: async (options: {
            retrieve_player: boolean
            generate_session_locally: boolean
          }) => {
            calls.initialized++
            assert.equal(options.retrieve_player, true)
            assert.equal(options.generate_session_locally, true)
            return {
              search: async (
                query: string,
                filters: {
                  type: string
                }
              ) => {
                calls.searches.push(query)
                await beforeSearch(query)
                assert.equal(filters.type, 'video')
                return {
                  videos: (query.endsWith(' lyrics') ? lyricsIds : ids).map((video_id) => ({
                    type: 'Video',
                    video_id,
                    title: metadata.get(video_id)?.basic_info.title,
                    is_live: false,
                    is_upcoming: false
                  }))
                }
              },
              getBasicInfo: async (id: string) => {
                calls.inspected.push(id)
                await beforeInspect(id)
                const result = metadata.get(id)
                if (!result) throw new Error('Unavailable')
                return result
              }
            }
          }
        }
      },
      '../../shared/youtubeUrl': youtubeUrl,
      './discovery': { discoverCaptionedMusic, isMusicVideo }
    },
    {
      URL,
      AbortController,
      AbortSignal,
      structuredClone,
      Date: { now: () => now, parse: Date.parse },
      fetch: () => {
        throw new Error('Tests must not make network requests')
      }
    }
  ) as {
    searchYoutube: (query: string, signal?: AbortSignal) => Promise<ImportCandidate[]>
    inspectYoutubeVideo: (url: string) => Promise<
      Extract<
        ImportCandidate,
        {
          source: 'youtube'
        }
      >
    >
  }
  return {
    search: searchModule.searchYoutube,
    inspect: searchModule.inspectYoutubeVideo,
    ids,
    lyricsIds,
    additionalIds: allIds.slice(12),
    calls,
    metadata,
    advance: (milliseconds: number) => {
      now += milliseconds
    },
    inspectWith: (callback: typeof beforeInspect) => {
      beforeInspect = callback
    },
    searchWith: (callback: typeof beforeSearch) => {
      beforeSearch = callback
    }
  }
}

export function manifest(): SongManifest {
  return {
    version: 1,
    source: { provider: 'youtube', id: videoId, url: canonicalUrl },
    title: 'Test Song',
    artist: 'Test Artist',
    language: ['en'],
    media: { video: 'video.mp4', cover: 'cover.jpg' },
    lyrics: {
      timing: 'phrase',
      originalFile: 'captions.json3',
      language: 'en',
      automatic: false,
      lines: [
        {
          startTimeMs: 1000,
          endTimeMs: 2000,
          syllables: [{ text: 'Hello world', startTimeMs: 1000, endTimeMs: 2000 }]
        }
      ]
    }
  }
}
