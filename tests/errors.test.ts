import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { loadTestModule } from './helpers.ts'
import { Effect } from 'effect'
import { computed, ref } from 'vue'
import * as youtubeUrl from '../src/shared/youtubeUrl.ts'
import type { ImportCandidate, Song } from '../src/shared/types.ts'
import type { AppAPI } from '../src/shared/api.ts'
import * as songTypes from '../src/shared/types.ts'
import { folder, manifest, meta } from './fixtures.ts'
import { parseSongManifest } from '../src/main/song-management/formats/manifest.ts'
import { IPC_CHANNELS } from '../src/shared/ipc.ts'
import * as downloadErrors from '../src/shared/errors.ts'
import { EventEmitter } from 'node:events'
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
  const source = await readFile(new URL('../src/main/utils/ipcHandle.ts', import.meta.url), 'utf8')
  const handlers = new Map<
    string,
    (
      event: object,
      request: unknown
    ) => Promise<downloadErrors.ApiResult<{ dirName: string; songDir: string }>>
  >()
  const logs: unknown[][] = []
  let failure: unknown = new downloadErrors.DownloadError(
    'captions_unavailable',
    'Private diagnostic details'
  )
  const { handleApi } = loadTestModule(
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
      '../../shared/errors': downloadErrors
    },
    { console: { error: (...args: unknown[]) => logs.push(args) } }
  ) as {
    handleApi: (channel: string, handler: () => unknown) => void
  }
  handleApi(IPC_CHANNELS.SONGS.DOWNLOAD, async () => {
    if (failure) throw failure
    return { dirName: 'youtube-video', songDir: 'fixture-folder/youtube-video' }
  })
  const download = handlers.get(IPC_CHANNELS.SONGS.DOWNLOAD)!
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
  assert.equal(success.ok && success.value.dirName, 'youtube-video')
})

test('preload exposes only the unified song API and subscriptions release their listeners', async () => {
  const source = await readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8')
  const exposed: Record<string, unknown> = {}
  const calls: unknown[][] = []
  const listeners = new Map<string, (...args: unknown[]) => void>()
  loadTestModule(
    source,
    {
      electron: {
        contextBridge: {
          exposeInMainWorld: (name: string, value: unknown) => {
            exposed[name] = value
          }
        },
        ipcRenderer: {
          invoke: async (...args: unknown[]) => {
            calls.push(args)
            return { ok: true, value: [] }
          },
          on: (channel: string, listener: (...args: unknown[]) => void) =>
            listeners.set(channel, listener),
          removeListener: (channel: string) => listeners.delete(channel)
        }
      },
      '@electron-toolkit/preload': { electronAPI: {} },
      '../shared/ipc': { IPC_CHANNELS }
    },
    { process: { contextIsolated: true } }
  )
  const api = exposed.api as AppAPI
  assert.equal(Object.hasOwn(api, 'downloader'), false)
  assert.deepEqual(Object.keys(api.songs), [
    'getSongs',
    'searchSongs',
    'downloadSong',
    'deleteSong',
    'updateSong',
    'onDownloadProgress'
  ])
  await api.songs.searchSongs('Artist - Song', { providers: ['local'] })
  assert.deepEqual(calls[0], [IPC_CHANNELS.SONGS.SEARCH, 'Artist - Song', { providers: ['local'] }])
  let progress = 0
  const unsubscribe = api.songs.onDownloadProgress((_candidate: unknown, value: number) => {
    progress = value
  })
  listeners.get(IPC_CHANNELS.SONGS.PROGRESS)!({}, {}, 0.5)
  assert.equal(progress, 0.5)
  unsubscribe()
  assert.equal(listeners.size, 0)
})

test('updater checks once concurrently, emits availability and only installs downloaded updates', async () => {
  const source = await readFile(new URL('../src/main/updater/index.ts', import.meta.url), 'utf8')
  const info = { version: '2.0.0' }
  let checks = 0
  let installs = 0
  const updater = Object.assign(new EventEmitter(), {
    checkForUpdates: async () => {
      checks++
      await Promise.resolve()
      updater.emit('update-available', info)
      return { updateInfo: info }
    },
    quitAndInstall: () => {
      installs++
    }
  })
  const module = loadTestModule(
    source,
    {
      'electron-updater': { autoUpdater: updater },
      '@electron-toolkit/utils': { is: { dev: false } },
      '../../shared/errors': downloadErrors
    },
    { console: { error: () => {} } }
  ) as {
    initializeUpdater(): void
    checkForUpdates(): Promise<unknown>
    installUpdate(): void
    updaterEvents: EventEmitter
  }
  const available: unknown[] = []
  const failures: unknown[] = []
  module.updaterEvents.on('available', (value) => available.push(value))
  module.updaterEvents.on('failed', (value) => failures.push(value))
  module.initializeUpdater()
  module.initializeUpdater()
  assert.throws(() => module.installUpdate(), { code: 'update_not_ready' })
  await Promise.all([module.checkForUpdates(), module.checkForUpdates()])
  assert.equal(checks, 1)
  assert.deepEqual(available, [info])
  updater.emit('error', new Error('Private update path'))
  assert.equal(JSON.stringify(failures), '[{"code":"update_failed"}]')
  updater.emit('update-downloaded', info)
  assert.equal(await module.checkForUpdates(), info)
  assert.equal(checks, 1)
  module.installUpdate()
  assert.equal(installs, 1)
})

test('download UI displays sanitized messages, preserves retries and logs unexpected failures', async () => {
  const source = await readFile(
    new URL('../src/renderer/src/composables/useSongManagement.ts', import.meta.url),
    'utf8'
  )
  const logs: unknown[][] = []
  let response: downloadErrors.ApiResult<Song> = {
    ok: false,
    error: { code: 'captions_unavailable' }
  }
  let failure: unknown
  const downloader = loadTestModule(
    source,
    {
      vue: {
        computed,
        ref,
        watch: () => {},
        provide: () => {},
        onMounted: () => {},
        onScopeDispose: () => {}
      },
      '@shared/errors': downloadErrors,
      '@shared/youtubeUrl': youtubeUrl
    },
    {
      window: {
        api: {
          songs: {
            onDownloadProgress: () => () => {},
            downloadSong: async () => {
              if (failure) throw failure
              return response
            }
          }
        }
      },
      console: { error: (...args: unknown[]) => logs.push(args), warn: () => {} }
    }
  ).useSongManagement as () => {
    downloads: {
      value: {
        status: string
        error?: downloadErrors.ApiFailure
        progress: number
      }[]
    }
    downloadSong: (request: SongImportRequest) => Promise<unknown>
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
  await assert.rejects(instance.downloadSong(request), { code: 'captions_unavailable' })
  assert.equal(instance.downloads.value[0].error?.code, 'captions_unavailable')
  response = { ok: false, error: { code: 'rate_limited' } }
  await assert.rejects(instance.downloadSong(request), { code: 'rate_limited' })
  assert.equal(instance.downloads.value[0].error?.code, 'rate_limited')
  failure = new Error('Raw Electron handler text with internal file paths')
  await assert.rejects(instance.downloadSong(request), { code: 'unknown' })
  assert.equal(instance.downloads.value[0].error?.code, 'unknown')
  assert.equal(logs.at(-1)?.[1], failure)
  failure = null
  response = {
    ok: true,
    value: parseSongManifest(JSON.stringify(manifest()), folder, 0, 0, { ...meta, id: 'imported' })
  }
  await instance.downloadSong(request)
  assert.equal(instance.downloads.value[0].status, 'completed')
  assert.equal(instance.downloads.value[0].error, undefined)
})

test('settings validate persisted JSON and patches without changing the cache after failed writes', async () => {
  let persisted = JSON.stringify({ musicVolume: 0.6 })
  let failWrite = false
  const service = loadTestModule(
    await readFile(new URL('../src/main/settings/index.ts', import.meta.url), 'utf8'),
    {
      electron: { app: { getPath: () => 'fixture-data' } },
      'fs/promises': {
        readFile: async () => persisted,
        writeFile: async (_filename: string, value: string) => {
          if (failWrite) throw Object.assign(new Error('private path'), { code: 'EACCES' })
          persisted = value
        },
        mkdir: async () => {}
      },
      '../../shared/errors': downloadErrors,
      '../../shared/types': songTypes
    }
  ).settingsManager as typeof import('../src/main/settings/index.ts').settingsManager
  await service.init()
  assert.equal(service.settings.musicVolume, 0.6)
  assert.equal(service.settings.sfxVolume, 0.8)
  await service.update({ youtubeSignInDismissed: true })
  assert.equal(JSON.parse(persisted).youtubeSignInDismissed, true)
  const cached = service.settings
  await assert.rejects(service.update({ musicVolume: 2 }), { code: 'invalid_request' })
  assert.equal(service.settings, cached)
  failWrite = true
  await assert.rejects(service.update({ sfxVolume: 0.2 }), { code: 'EACCES' })
  assert.equal(service.settings, cached)
  persisted = JSON.stringify({ musicVolume: 'invalid' })
  await assert.rejects(service.refresh())
  assert.equal(service.settings, cached)
})
