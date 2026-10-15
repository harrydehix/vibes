import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { loadTestModule } from './helpers.ts'
import { Effect } from 'effect'
import { ref } from 'vue'
import type { ImportCandidate } from '../src/shared/types.ts'
import { searchSources } from '../src/renderer/src/utils/searchSources.ts'
import { IPC_CHANNELS } from '../src/shared/ipc.ts'
import * as downloadErrors from '../src/shared/errors.ts'
import type { SongImportRequest } from '../src/shared/types.ts'

test('download error messages use fixed explanations and never raw diagnostic text', () => {
  const detail = 'Internal path and yt-dlp stderr must stay in logs'
  const known = new downloadErrors.DownloadError('captions_unavailable', detail)
  assert.equal(downloadErrors.getDownloadErrorCode(known), 'captions_unavailable')
  assert.equal(
    downloadErrors.getDownloadErrorMessage(known.code),
    'The selected captions are unavailable. Please choose another track.'
  )
  assert.equal(downloadErrors.getDownloadErrorCode(new Error(detail)), 'unknown')
  assert.equal(downloadErrors.getDownloadErrorMessage(detail), 'Download failed. Please try again.')
  assert.equal(
    downloadErrors.getDownloadErrorMessage('__proto__'),
    'Download failed. Please try again.'
  )
  assert.equal(downloadErrors.getDownloadErrorCode({ code: 'ENOSPC' }), 'disk_full')
  assert.equal(downloadErrors.getDownloadErrorCode({ code: 'EACCES' }), 'access_denied')
  assert.equal(downloadErrors.getDownloadErrorCode({ code: 'ETIMEDOUT' }), 'network_error')
  assert.equal(downloadErrors.getDownloadErrorCode({ message: 'not enough disk space' }), 'unknown')
})

test('rate limiting has its own message for HTTP 429, yt-dlp stderr and nested causes only', () => {
  for (const error of [
    { status: 429 },
    { statusCode: 429 },
    new Error('YouTube request failed (HTTP 429)'),
    { code: 1, stderr: 'ERROR: Unable to download subtitles: HTTP Error 429: Too Many Requests' },
    new Error('Download failed', { cause: new Error('HTTP Error 429: Too Many Requests') }),
    new Error('Too Many Requests')
  ]) {
    assert.equal(downloadErrors.getDownloadErrorCode(error), 'rate_limited')
  }
  assert.equal(
    downloadErrors.getDownloadErrorMessage('rate_limited'),
    'YouTube is limiting requests. Please try again later.'
  )
  assert.equal(
    downloadErrors.getDownloadErrorCode(new Error('Unknown failure after 429 bytes')),
    'unknown'
  )
  assert.equal(downloadErrors.getDownloadErrorCode({ status: 403 }), 'unknown')
  assert.equal(
    downloadErrors.getDownloadErrorCode(new Error('HTTP Error 403: Forbidden')),
    'unknown'
  )
  const cyclic: {
    cause?: unknown
  } = {}
  cyclic.cause = cyclic
  assert.equal(downloadErrors.getDownloadErrorCode(cyclic), 'unknown')
})

test('YouTube textual rate limits without HTTP 429 are recognized without guessing generic failures', () => {
  const detail =
    "ERROR: [youtube] iP6XpLQM2Cs: This content isn't available, try again later. Your account or the current session has been rate-limited by YouTube for up to an hour."
  for (const error of [
    new Error(detail),
    { code: 1, stderr: detail },
    new Error('Download failed', { cause: new Error(detail) }),
    new downloadErrors.DownloadError('unknown', 'Download failed', { cause: new Error(detail) }),
    new Error('Request failed with status code 429'),
    new Error(
      'YouTube is limiting requests. Wait before retrying; optional sign-in is available in Settings.'
    ),
    new Error('YouTube is limiting requests. Wait before trying again.'),
    new Error('YouTube is limiting searches. Please wait before trying again.')
  ]) {
    assert.equal(downloadErrors.getDownloadErrorCode(error), 'rate_limited')
  }
  assert.equal(
    downloadErrors.getDownloadErrorCode(new Error("This content isn't available, try again later")),
    'unknown'
  )
})

test('YouTube video download HTTP 403 is treated as rate limited, including stderr and nested causes', () => {
  const detail = 'ERROR: unable to download video data: HTTP Error 403: Forbidden'
  for (const error of [
    new Error(detail),
    new Error(`yt-dlp download failed (code 1): ${detail}`),
    { code: 1, stderr: detail },
    new Error('YouTube request failed', { cause: new Error(detail) }),
    new downloadErrors.DownloadError('unknown', 'Download failed', { cause: new Error(detail) })
  ]) {
    assert.equal(downloadErrors.getDownloadErrorCode(error), 'rate_limited')
  }
  for (const detail of [
    'HTTP Error 403: Forbidden',
    'Unable to download subtitles: HTTP Error 403: Forbidden',
    'Unable to download video data: HTTP Error 404: Not Found'
  ]) {
    assert.equal(downloadErrors.getDownloadErrorCode(new Error(detail)), 'unknown')
  }
})

test('download IPC logs full errors but sends only known codes, with generic unknown failures', async () => {
  const source = await readFile(
    new URL('../src/main/ipc/downloaderManager.ts', import.meta.url),
    'utf8'
  )
  const handlers = new Map<
    string,
    (event: object, request: unknown) => Promise<downloadErrors.SongDownloadResponse>
  >()
  const logs: unknown[][] = []
  let failure: unknown = new downloadErrors.DownloadError(
    'captions_unavailable',
    'Private diagnostic details'
  )
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
      '../../shared/ipc': { IPC_CHANNELS },
      '../../shared/errors': downloadErrors,
      '../ultrastar-download/usdbDownloader': { searchUsdb: () => {} },
      './settings': { basePathForDownload: 'fixture-folder' },
      '../song-import': {
        importSong: async () => {
          if (failure) throw failure
          return { dirName: 'youtube-video', songDir: 'fixture-folder/youtube-video' }
        }
      },
      '../song-import/youtube': { inspectYoutube: () => {}, searchYoutube: () => {} }
    },
    { console: { error: (...args: unknown[]) => logs.push(args) } }
  ).downloaderManager as {
    defineIpcHandles: () => Promise<void>
  }
  await manager.defineIpcHandles()
  const download = handlers.get(IPC_CHANNELS.DOWNLOADER.DOWNLOAD)!
  const known = await download({}, {})
  assert.equal(known.ok, false)
  assert.equal(!known.ok && known.error.code, 'captions_unavailable')
  assert.equal(JSON.stringify(known).includes('Private diagnostic'), false)
  assert.equal(logs[0][1], failure)
  failure = await Effect.runPromise(
    Effect.fail(
      new Error(
        'yt-dlp download failed: Your session has been rate-limited by YouTube for up to an hour.'
      )
    )
  ).catch((error: unknown) => error)
  const limited = await download({}, {})
  assert.equal(!limited.ok && limited.error.code, 'rate_limited')
  assert.equal(logs[1][1], failure)
  assert.equal(JSON.stringify(limited).includes('yt-dlp'), false)
  failure = await Effect.runPromise(
    Effect.fail(
      new Error(
        'YouTube is limiting requests. Wait before retrying; optional sign-in is available in Settings.'
      )
    )
  ).catch((error: unknown) => error)
  const authLimited = await download({}, {})
  assert.equal(!authLimited.ok && authLimited.error.code, 'rate_limited')
  assert.equal(logs[2][1], failure)
  assert.equal(JSON.stringify(authLimited).includes('Settings'), false)
  const videoForbidden =
    'yt-dlp download failed (code 1): ERROR: unable to download video data: HTTP Error 403: Forbidden'
  failure = await Effect.runPromise(
    Effect.fail(new Error(videoForbidden, { cause: new Error(videoForbidden) }))
  ).catch((error: unknown) => error)
  const forbidden = await download({}, {})
  assert.equal(!forbidden.ok && forbidden.error.code, 'rate_limited')
  assert.equal(logs[3][1], failure)
  assert.equal(JSON.stringify(forbidden).includes('403'), false)
  failure = new Error('Unknown private diagnostic')
  const unknown = await download({}, {})
  assert.equal(!unknown.ok && unknown.error.code, 'unknown')
  assert.equal(logs[4][1], failure)
  failure = null
  const success = await download({}, {})
  assert.equal(success.ok, true)
  assert.equal(success.ok && success.result.dirName, 'youtube-video')
})

test('download UI displays sanitized messages, preserves retries and logs unexpected failures', async () => {
  const source = await readFile(
    new URL('../src/renderer/src/composables/useDownloader.ts', import.meta.url),
    'utf8'
  )
  const logs: unknown[][] = []
  let response: downloadErrors.SongDownloadResponse = {
    ok: false,
    error: { code: 'captions_unavailable' }
  }
  let failure: unknown
  let refreshed = 0
  const downloader = loadTestModule(
    source,
    {
      vue: { ref },
      '@shared/errors': downloadErrors,
      './useSongs': {
        accessSongs: () => ({
          songs: ref([]),
          refresh: async () => {
            refreshed++
          }
        })
      },
      '../utils/searchSources': { searchSources }
    },
    {
      window: {
        api: {
          downloader: {
            onProgress: () => {},
            download: async () => {
              if (failure) throw failure
              return response
            }
          }
        }
      },
      console: { error: (...args: unknown[]) => logs.push(args), warn: () => {} }
    }
  ).useDownloader as () => {
    downloads: {
      value: {
        status: string
        error?: string
        progress: number
      }[]
    }
    importSong: (request: SongImportRequest) => Promise<unknown>
  }
  const instance = downloader()
  const candidate: Extract<
    ImportCandidate,
    {
      source: 'youtube'
    }
  > = {
    source: 'youtube',
    id: 'video000000',
    title: 'Song',
    artist: 'Artist',
    url: 'https://www.youtube.com/watch?v=video000000',
    tracks: []
  }
  const request = { candidate, captionTrackId: 'manual:en', title: 'Song', artist: 'Artist' }
  assert.equal(await instance.importSong(request), null)
  assert.equal(
    instance.downloads.value[0].error,
    'The selected captions are unavailable. Please choose another track.'
  )
  response = { ok: false, error: { code: 'rate_limited' } }
  assert.equal(await instance.importSong(request), null)
  assert.equal(
    instance.downloads.value[0].error,
    'YouTube is limiting requests. Please try again later.'
  )
  failure = new Error('Raw Electron handler text with internal file paths')
  assert.equal(await instance.importSong(request), null)
  assert.equal(instance.downloads.value[0].error, 'Download failed. Please try again.')
  assert.equal(logs.at(-1)?.[1], failure)
  failure = null
  response = {
    ok: true,
    result: { dirName: 'youtube-video', songDir: 'fixture-folder/youtube-video' }
  }
  await instance.importSong(request)
  assert.equal(instance.downloads.value[0].status, 'completed')
  assert.equal(instance.downloads.value[0].error, undefined)
  assert.equal(refreshed, 1)
})
