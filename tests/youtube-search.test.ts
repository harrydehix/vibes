import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { loadTestModule } from './helpers.ts'
import { EventEmitter } from 'node:events'
import { effectScope, nextTick, onScopeDispose, ref, watch } from 'vue'
import * as youtubeUrl from '../src/shared/youtubeUrl.ts'
import type { ImportCandidate } from '../src/shared/types.ts'
import { discoverCaptionedMusic, isMusicVideo } from '../src/main/song-import/discovery.ts'
import { searchSources } from '../src/renderer/src/utils/searchSources.ts'
import { IPC_CHANNELS } from '../src/shared/ipc.ts'
import * as downloadErrors from '../src/shared/errors.ts'
import {
  videoId,
  canonicalUrl,
  youtubeCandidate,
  createYoutubeImportFixture,
  createYoutubeSearchFixture
} from './fixtures.ts'

test('remote song search debounces text, opens YouTube links directly and ignores superseded requests', async (context) => {
  const source = await readFile(
    new URL('../src/renderer/src/composables/useRemoteSongSearch.ts', import.meta.url),
    'utf8'
  )
  const timers = new Map<
    number,
    {
      due: number
      callback: () => Promise<void>
    }
  >()
  const queries: string[] = []
  const inspections: string[] = []
  let inspectedVideo: Extract<
    ImportCandidate,
    {
      source: 'youtube'
    }
  > = {
    source: 'youtube',
    id: videoId,
    title: 'Artist - Song',
    artist: 'Artist',
    url: canonicalUrl,
    tracks: [{ id: 'manual:en', name: 'English', language: 'en', automatic: false }]
  }
  let inspectionFailure: unknown = null
  let now = 0
  let timerId = 0
  const state = {
    searchTimeout: { value: null as number | null },
    selectedYoutube: {
      value: null as Extract<
        ImportCandidate,
        {
          source: 'youtube'
        }
      > | null
    },
    searchErrors: { value: [] as string[] },
    availableForDownloadSongs: { value: [] as ImportCandidate[] },
    locallySearchedSongs: { value: [] },
    locallyLoading: { value: false },
    onlineLoading: { value: false },
    localFuseSearch: { value: { search: () => [] } },
    downloader: {
      cancelYoutubeSearch: () => {},
      searchAll: async (query: string) => {
        queries.push(query)
      },
      inspectYoutube: async (url: string) => {
        inspections.push(url)
        if (inspectionFailure) throw inspectionFailure
        return inspectedVideo
      }
    },
    URL,
    getDownloadErrorCode: downloadErrors.getDownloadErrorCode,
    getDownloadErrorMessage: downloadErrors.getDownloadErrorMessage,
    console: { error: () => {} },
    clearTimeout: (id: number) => timers.delete(id),
    window: {
      setTimeout: (run: () => Promise<void>, delay: number) => {
        const id = ++timerId
        timers.set(id, { due: now + delay, callback: run })
        return id
      }
    }
  }
  const useSearch = loadTestModule(
    source,
    {
      vue: { ref, watch, onScopeDispose },
      '@shared/errors': downloadErrors,
      '@shared/youtubeUrl': youtubeUrl
    },
    state
  ).useRemoteSongSearch as (
    search: ReturnType<typeof ref<string>>,
    downloader: typeof state.downloader
  ) => object
  const search = ref('')
  const scope = effectScope()
  context.after(() => scope.stop())
  Object.assign(
    state,
    scope.run(() => useSearch(search, state.downloader))
  )
  const changeSearch = async (query: string): Promise<void> => {
    if (search.value === query) {
      search.value = ''
      await nextTick()
    }
    search.value = query
    await nextTick()
  }
  const runDueTimers = async (): Promise<void> => {
    for (const [id, timer] of timers) {
      if (timer.due > now) continue
      timers.delete(id)
      await timer.callback()
    }
  }
  await changeSearch('song')
  now = 150
  await changeSearch('song title')
  now = 549
  await runDueTimers()
  assert.deepEqual(queries, [])
  now = 550
  await runDueTimers()
  assert.deepEqual(queries, ['song title'])
  await changeSearch('another song')
  await changeSearch(' ')
  now = 1000
  await runDueTimers()
  assert.deepEqual(queries, ['song title'])
  assert.equal(state.onlineLoading.value, false)
  await changeSearch(`  ${canonicalUrl}  `)
  now += 400
  await runDueTimers()
  assert.deepEqual(inspections, [canonicalUrl])
  assert.deepEqual(queries, ['song title'])
  assert.deepEqual(state.selectedYoutube.value, inspectedVideo)
  assert.deepEqual(Array.from(state.availableForDownloadSongs.value), [inspectedVideo])
  assert.equal(state.onlineLoading.value, false)
  inspectedVideo = { ...inspectedVideo, tracks: [] }
  await changeSearch(`https://youtu.be/${videoId}`)
  now += 400
  await runDueTimers()
  assert.equal(state.selectedYoutube.value?.lyricsInVideo, true)
  assert.equal(state.selectedYoutube.value?.tracks.length, 0)
  assert.deepEqual(queries, ['song title'])
  inspectionFailure = new Error('YouTube is limiting requests. Wait before retrying.')
  await changeSearch(canonicalUrl)
  now += 400
  await runDueTimers()
  assert.equal(state.selectedYoutube.value, null)
  assert.deepEqual(Array.from(state.searchErrors.value), [
    'YouTube is limiting requests. Please try again later.'
  ])
  assert.equal(state.onlineLoading.value, false)
  inspectionFailure = new Error('Private diagnostic details')
  await changeSearch(canonicalUrl)
  now += 400
  await runDueTimers()
  assert.deepEqual(Array.from(state.searchErrors.value), [
    'Could not load this YouTube video. Check the link and try again.'
  ])
  inspectionFailure = null
  await changeSearch(canonicalUrl)
  now += 400
  const pending = runDueTimers()
  await changeSearch(' ')
  await pending
  assert.equal(state.selectedYoutube.value, null)
  assert.deepEqual(Array.from(state.availableForDownloadSongs.value), [])
  assert.deepEqual(Array.from(state.searchErrors.value), [])
  assert.equal(state.onlineLoading.value, false)
  inspectionFailure = new Error('Stale private diagnostic')
  await changeSearch(canonicalUrl)
  now += 400
  const staleFailure = runDueTimers()
  await changeSearch('new song')
  await staleFailure
  assert.equal(state.selectedYoutube.value, null)
  assert.equal(state.onlineLoading.value, true)
})

test('music eligibility requires a Music category or structured track and artist metadata', () => {
  assert.equal(isMusicVideo({ categories: ['Music'] }), true)
  assert.equal(isMusicVideo({ track: 'Song', artist: 'Artist' }), true)
  assert.equal(isMusicVideo({ categories: ['Education'] }), false)
  assert.equal(isMusicVideo({ track: 'Song' }), false)
  assert.equal(isMusicVideo({}), false)
})

test('fast YouTube search inspects at most ten videos and only returns music with creator-provided captions', async () => {
  const fixture = await createYoutubeSearchFixture()
  fixture.metadata.get(fixture.ids[1])!.basic_info.category = 'Education'
  fixture.metadata.get(fixture.ids[2])!.captions.caption_tracks = []
  fixture.metadata.delete(fixture.ids[3])
  fixture.metadata.get(fixture.ids[4])!.captions.caption_tracks[0].kind = 'asr'
  fixture.metadata.get(fixture.ids[0])!.captions.caption_tracks.push({
    base_url: 'https://www.youtube.com/api/timedtext',
    language_code: 'de',
    name: 'German',
    kind: 'asr'
  })
  const results = await fixture.search('Song')
  assert.equal(fixture.calls.initialized, 1)
  assert.deepEqual(fixture.calls.searches, ['Song', 'Song lyrics'])
  assert.equal(fixture.calls.inspected.length, 10)
  assert.deepEqual(
    results.map((video) => video.id),
    [fixture.ids[0], ...fixture.ids.slice(5, 10)]
  )
  assert.equal(
    (
      results[0] as Extract<
        ImportCandidate,
        {
          source: 'youtube'
        }
      >
    ).tracks[0].id,
    'manual:en'
  )
  assert.equal(
    (
      results[0] as Extract<
        ImportCandidate,
        {
          source: 'youtube'
        }
      >
    ).tracks[1].id,
    'auto:de'
  )
  const repeated = await fixture.search('Song')
  assert.deepEqual(
    repeated.map((video) => video.id),
    results.map((video) => video.id)
  )
  assert.equal(fixture.calls.searches.length, 4)
  assert.equal(fixture.calls.inspected.length, 11)
})

test('fast YouTube search uses yt-dlp-compatible caption IDs while preserving display languages', async () => {
  const fixture = await createYoutubeSearchFixture()
  Object.assign(fixture.metadata.get(fixture.ids[0])!.captions.caption_tracks[0], {
    vss_id: '.de-DE',
    language_code: 'de',
    name: 'German'
  })
  Object.assign(fixture.metadata.get(fixture.ids[1])!.captions.caption_tracks[0], {
    vss_id: '.en.alternate',
    language_code: 'en',
    name: 'English alternate'
  })
  const automatic = {
    base_url: 'https://www.youtube.com/api/timedtext',
    language_code: 'en',
    name: 'English',
    kind: 'asr',
    vss_id: 'a.en'
  }
  fixture.metadata.get(fixture.ids[0])!.captions.caption_tracks.push(automatic)
  const result = (await fixture.search('Song')) as Extract<
    ImportCandidate,
    {
      source: 'youtube'
    }
  >[]
  assert.equal(result[0].tracks[0].id, 'manual:de-DE')
  assert.equal(result[0].tracks[0].language, 'de')
  assert.equal(result[0].tracks[1].id, 'auto:en')
  assert.equal(result[1].tracks[0].id, 'manual:en-alternate')
})

test('fast YouTube search preserves the default captions for the main audio track before filtering', async () => {
  const fixture = await createYoutubeSearchFixture()
  const captions = fixture.metadata.get(fixture.ids[0])!.captions
  captions.caption_tracks.unshift({
    base_url: '',
    language_code: 'live_chat',
    name: 'Chat',
    kind: ''
  })
  captions.caption_tracks.push({
    base_url: 'https://www.youtube.com/api/timedtext',
    language_code: 'fr',
    name: 'French',
    kind: 'asr'
  })
  Object.assign(captions, {
    default_audio_track_index: 1,
    audio_tracks: [
      { caption_track_indices: [1], default_caption_track_index: 1 },
      { caption_track_indices: [1, 2], default_caption_track_index: 2 }
    ]
  })
  const results = (await fixture.search('Song')) as Extract<
    ImportCandidate,
    {
      source: 'youtube'
    }
  >[]
  assert.deepEqual(
    results[0].tracks.map((track) => track.id),
    ['manual:en', 'auto:fr']
  )
  assert.equal(results[0].tracks[0].isDefault, undefined)
  assert.equal(results[0].tracks[1].isDefault, true)
  assert.equal(results[0].tracks[1].automatic, true)
  assert.equal(
    results[1].tracks.some((track) => track.isDefault),
    false
  )
})

test('direct YouTube SDK inspection returns default captions without searching or mutating cached tracks', async () => {
  const fixture = await createYoutubeSearchFixture()
  const captions = fixture.metadata.get(fixture.ids[0])!.captions
  Object.assign(captions, {
    audio_tracks: [{ default_caption_track_index: 0, caption_track_indices: [0] }]
  })
  const url = `https://www.youtube.com/watch?v=${fixture.ids[0]}`
  const first = await fixture.inspect(url)
  assert.equal(first.tracks[0].isDefault, true)
  first.tracks[0].isDefault = false
  assert.equal((await fixture.inspect(url)).tracks[0].isDefault, true)
  assert.equal(fixture.calls.inspected.length, 1)
  assert.equal(fixture.calls.searches.length, 0)
})

test('fast YouTube search caches queries and reuses video checks across queries until expiry', async () => {
  const fixture = await createYoutubeSearchFixture()
  fixture.metadata.get(fixture.ids[0])!.captions.caption_tracks[0].kind = 'asr'
  const first = await fixture.search('Song')
  assert.equal(
    first.some((video) => video.id === fixture.ids[0]),
    false
  )
  first.splice(0)
  assert.equal((await fixture.search(' song ')).length, 9)
  assert.equal(fixture.calls.searches.length, 2)
  assert.equal(fixture.calls.inspected.length, 10)
  await fixture.search('Another query')
  assert.equal(fixture.calls.searches.length, 4)
  assert.equal(fixture.calls.inspected.length, 10)
  fixture.advance(5 * 60000)
  await fixture.search('Song')
  assert.equal(fixture.calls.searches.length, 6)
  assert.equal(fixture.calls.inspected.length, 20)
})

test('fast YouTube search adds lyrics-video results without captions within the shared ten-video limit', async () => {
  const fixture = await createYoutubeSearchFixture()
  fixture.lyricsIds.push(...fixture.additionalIds.slice(0, 6))
  for (const id of fixture.lyricsIds.slice(1))
    fixture.metadata.get(id)!.captions.caption_tracks = []
  fixture.metadata.get(fixture.ids[0])!.captions.caption_tracks[0].kind = 'asr'
  const results = await fixture.search('Artist Song')
  assert.deepEqual(fixture.calls.searches, ['Artist Song', 'Artist Song lyrics'])
  assert.equal(fixture.calls.inspected.length, 10)
  assert.equal(results.length, 9)
  const lyricVideos = results.filter((video) => video.source === 'youtube' && video.lyricsInVideo)
  assert.equal(lyricVideos.length, 5)
  assert.equal(
    lyricVideos.every((video) => video.source === 'youtube' && video.tracks.length === 0),
    true
  )
  assert.equal(
    results.some((video) => video.id === fixture.ids[0]),
    false
  )
  const cached = await fixture.search('Artist Song')
  assert.deepEqual(cached, results)
  assert.equal(fixture.calls.searches.length, 2)
})

test('fast YouTube search deduplicates both searches and prefers captions when a duplicate has manual tracks', async () => {
  const fixture = await createYoutubeSearchFixture()
  fixture.lyricsIds.push(fixture.ids[0], fixture.ids[1])
  for (const id of fixture.lyricsIds) fixture.metadata.get(id)!.basic_info.title += ' (Lyrics)'
  fixture.metadata.get(fixture.ids[1])!.captions.caption_tracks = []
  const results = await fixture.search('Song')
  assert.equal(new Set(results.map((video) => video.id)).size, results.length)
  assert.equal(fixture.calls.inspected.length, 10)
  const first = results.find((video) => video.id === fixture.ids[0]) as Extract<
    ImportCandidate,
    {
      source: 'youtube'
    }
  >
  const second = results.find((video) => video.id === fixture.ids[1]) as Extract<
    ImportCandidate,
    {
      source: 'youtube'
    }
  >
  assert.equal(first.lyricsInVideo, undefined)
  assert.equal(first.tracks[0].automatic, false)
  assert.equal(second.lyricsInVideo, true)
  assert.equal(second.tracks.length, 0)
})

test('fast YouTube lyrics search requires Lyrics in the video title without filtering regular captioned results', async () => {
  const fixture = await createYoutubeSearchFixture()
  fixture.lyricsIds.push(...fixture.additionalIds.slice(0, 5))
  const titles = [
    'Artist - Song (Official Video)',
    'Artist - Song (Lyric Video)',
    'Artist - Lyricsology',
    'Artist - Song (LYRICS)',
    'Artist - Song [lyrics]'
  ]
  for (const [index, id] of fixture.lyricsIds.entries()) {
    fixture.metadata.get(id)!.basic_info.title = titles[index]
    fixture.metadata.get(id)!.captions.caption_tracks = []
  }
  const results = await fixture.search('Song')
  const lyricVideos = results.filter((video) => video.source === 'youtube' && video.lyricsInVideo)
  assert.deepEqual(
    lyricVideos.map((video) => video.id),
    fixture.lyricsIds.slice(3)
  )
  for (const id of fixture.lyricsIds.slice(0, 3)) {
    assert.equal(fixture.calls.inspected.includes(id), false)
    assert.equal(
      results.some((video) => video.id === id),
      false
    )
  }
  assert.equal(
    results.some((video) => video.id === fixture.ids[0]),
    true
  )
  assert.equal(fixture.calls.inspected.length, 10)
  assert.equal(results.length, 10)
})

test('fast YouTube search retains lyrics-video results when the regular search fails', async () => {
  const fixture = await createYoutubeSearchFixture()
  fixture.lyricsIds.push(fixture.additionalIds[0])
  fixture.metadata.get(fixture.additionalIds[0])!.captions.caption_tracks = []
  fixture.searchWith(async (query) => {
    if (!query.endsWith(' lyrics')) throw new Error('Regular search unavailable')
  })
  const result = await fixture.search('Song')
  assert.equal(result.length, 1)
  assert.equal(
    (
      result[0] as Extract<
        ImportCandidate,
        {
          source: 'youtube'
        }
      >
    ).lyricsInVideo,
    true
  )
  await fixture.search('Song')
  assert.equal(fixture.calls.searches.length, 4)
  assert.equal(fixture.calls.inspected.length, 1)
})

test('fast YouTube URL search hides auto-only videos but keeps videos with mixed caption tracks', async () => {
  const fixture = await createYoutubeSearchFixture()
  fixture.metadata.get(fixture.ids[0])!.captions.caption_tracks[0].kind = 'asr'
  assert.equal((await fixture.search(`https://youtu.be/${fixture.ids[0]}`)).length, 0)
  const mixed = fixture.metadata.get(fixture.ids[1])!.captions.caption_tracks
  mixed[0].kind = 'asr'
  mixed.push({
    base_url: 'https://www.youtube.com/api/timedtext',
    language_code: 'es',
    name: 'Spanish',
    kind: ''
  })
  const result = await fixture.search(`https://youtu.be/${fixture.ids[1]}`)
  assert.equal(result.length, 1)
  assert.equal(fixture.calls.searches.length, 0)
  assert.deepEqual(fixture.calls.inspected, [fixture.ids[0], fixture.ids[1]])
  assert.equal(
    (
      result[0] as Extract<
        ImportCandidate,
        {
          source: 'youtube'
        }
      >
    ).tracks[0].id,
    'auto:en'
  )
  assert.equal(
    (
      result[0] as Extract<
        ImportCandidate,
        {
          source: 'youtube'
        }
      >
    ).tracks[1].id,
    'manual:es'
  )
})

test('fast YouTube search skips empty queries and already aborted requests', async () => {
  const fixture = await createYoutubeSearchFixture()
  assert.equal((await fixture.search(' ')).length, 0)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(fixture.search('Song', controller.signal), { name: 'AbortError' })
  assert.equal(fixture.calls.initialized, 0)
})

test('fast YouTube search stops queued inspections on cancellation and does not cache aborted results', async () => {
  const fixture = await createYoutubeSearchFixture()
  const releases: Array<() => void> = []
  let started: () => void = () => {}
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  fixture.inspectWith(async () => {
    await new Promise<void>((resolve) => {
      releases.push(resolve)
      if (releases.length === 3) started()
    })
  })
  const controller = new AbortController()
  const pending = fixture.search('Song', controller.signal)
  await ready
  controller.abort()
  for (const release of releases) release()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(fixture.calls.inspected.length, 3)
  fixture.inspectWith(async () => {})
  assert.equal((await fixture.search('Song')).length, 10)
  assert.equal(fixture.calls.inspected.length, 13)
})

test('YouTube search IPC cancels stale searches and direct links preserve default captions with safe fallback', async (context) => {
  const source = await readFile(
    new URL('../src/main/ipc/downloaderManager.ts', import.meta.url),
    'utf8'
  )
  const handlers = new Map<string, (event: object, query: string) => Promise<unknown>>()
  const requests: Array<{
    query: string
    signal: AbortSignal
  }> = []
  const link = {
    ...youtubeCandidate(videoId),
    tracks: [
      { id: 'manual:de', name: 'German', language: 'de', automatic: false },
      { id: 'auto:en-orig', name: 'English (Original)', language: 'en-orig', automatic: true }
    ]
  }
  let mainId = 'auto:en'
  let defaultsUnavailable = false
  let defaultChecks = 0
  const fixture = await createYoutubeImportFixture(context)
  fixture.metadata.id = videoId
  fixture.metadata.subtitles = { de: [{ ext: 'json3', name: 'German' }] }
  fixture.metadata.automatic_captions = {
    'en-orig': [{ ext: 'json3', name: 'English (Original)' }]
  }
  fixture.setInspection(async () => {
    defaultChecks++
    if (defaultsUnavailable) throw new Error('YouTube metadata unavailable')
    return { ...link, tracks: [{ ...link.tracks[1], id: mainId, isDefault: true }] }
  })
  const manager = loadTestModule(
    source,
    {
      electron: {
        ipcMain: {
          handle: (name: string, handler: (event: object, query: string) => Promise<unknown>) =>
            handlers.set(name, handler)
        }
      },
      '../../shared/ipc': { IPC_CHANNELS },
      '../../shared/errors': downloadErrors,
      '../ultrastar-download/usdbDownloader': { searchUsdb: () => {} },
      './settings': { basePathForDownload: 'fixture-folder' },
      '../song-import': { importSong: () => {} },
      '../song-import/youtube': {
        inspectYoutubeWithDefaultCaptions: fixture.inspect,
        searchYoutube: (query: string, signal: AbortSignal) => {
          requests.push({ query, signal })
          return new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
        }
      }
    },
    { AbortController }
  ).downloaderManager as {
    defineIpcHandles: () => Promise<void>
  }
  await manager.defineIpcHandles()
  const search = handlers.get(IPC_CHANNELS.DOWNLOADER.SEARCH_YOUTUBE)!
  const sender = Object.assign(new EventEmitter(), { id: 7 })
  const first = assert.rejects(search({ sender }, 'First'), { name: 'AbortError' })
  const second = assert.rejects(search({ sender }, 'Second'), { name: 'AbortError' })
  assert.equal(requests[0].signal.aborted, true)
  assert.equal(requests[1].signal.aborted, false)
  await search({ sender }, '')
  await Promise.all([first, second])
  assert.equal(requests.length, 2)
  assert.equal(sender.listenerCount('destroyed'), 0)
  const third = assert.rejects(search({ sender }, 'Third'), { name: 'AbortError' })
  sender.emit('destroyed')
  await third
  assert.equal(sender.listenerCount('destroyed'), 0)
  const inspect = handlers.get(IPC_CHANNELS.DOWNLOADER.INSPECT_YOUTUBE)! as (
    event: object,
    url: string
  ) => Promise<
    Extract<
      ImportCandidate,
      {
        source: 'youtube'
      }
    >
  >
  const original = await inspect({}, canonicalUrl)
  assert.equal(original.tracks[0].isDefault, undefined)
  assert.equal(original.tracks[1].isDefault, true)
  mainId = 'manual:de'
  const manual = await inspect({}, canonicalUrl)
  assert.equal(manual.tracks[0].isDefault, true)
  assert.equal(manual.tracks[1].isDefault, undefined)
  mainId = 'manual:fr'
  const unmatched = await inspect({}, canonicalUrl)
  assert.equal(
    unmatched.tracks.some((track) => track.isDefault),
    false
  )
  defaultsUnavailable = true
  const fallback = await inspect({}, canonicalUrl)
  assert.equal(
    fallback.tracks.some((track) => track.isDefault),
    false
  )
  link.tracks = []
  fixture.metadata.subtitles = {}
  fixture.metadata.automatic_captions = {}
  const checks = defaultChecks
  assert.equal((await inspect({}, canonicalUrl)).tracks.length, 0)
  assert.equal(defaultChecks, checks)
})

test('YouTube results require music and at least one creator-provided caption track', async () => {
  const results = await discoverCaptionedMusic(
    ['song', 'mixed', 'auto-only', 'talk', 'no-captions', 'unavailable'],
    async (id) => {
      if (id === 'unavailable') throw new Error('Video unavailable')
      const video = youtubeCandidate(id, id !== 'talk', id !== 'no-captions')
      if (id === 'auto-only') {
        video.tracks[0] = { id: 'auto:en', name: 'English', language: 'en', automatic: true }
      }
      if (id === 'mixed') {
        video.tracks.push({ id: 'auto:en', name: 'English', language: 'en', automatic: true })
      }
      return video
    }
  )
  assert.deepEqual(
    results.map((result) => result.id),
    ['song', 'mixed']
  )
})

test('YouTube inspection preserves ranking and limits simultaneous inspections', async () => {
  let active = 0
  let maxActive = 0
  const urls = ['one', 'two', 'three', 'four', 'five']
  const results = await discoverCaptionedMusic(urls, async (id) => {
    active++
    maxActive = Math.max(maxActive, active)
    await Promise.resolve()
    active--
    return youtubeCandidate(id)
  })
  assert.deepEqual(
    results.map((result) => result.id),
    urls
  )
  assert.equal(maxActive, 3)
})

test('a complete YouTube inspection failure is reported instead of silently returning no songs', async () => {
  await assert.rejects(
    discoverCaptionedMusic(['unavailable'], async () => {
      throw new Error('Offline')
    }),
    /Could not inspect/
  )
})

test('combined search sends the same query to each source and retains partial results on failure', async () => {
  const queries: string[] = []
  const updates: number[] = []
  const result = await searchSources(
    'Artist - Title',
    [
      {
        name: 'USDB',
        search: async (query) => {
          queries.push(query)
          throw new Error('Offline')
        }
      },
      {
        name: 'YouTube',
        search: async (query) => {
          queries.push(query)
          return [youtubeCandidate('song')]
        }
      }
    ],
    (result) => updates.push(result.pending)
  )
  assert.deepEqual(queries, ['Artist - Title', 'Artist - Title'])
  assert.equal(result.candidates.length, 1)
  assert.match(result.errors[0], /USDB: Offline/)
  assert.equal(result.pending, 0)
  assert.deepEqual(updates, [1, 0])
})

test('combined search deduplicates by source identity and skips empty queries', async () => {
  const candidate = youtubeCandidate('song')
  const provider = {
    name: 'YouTube',
    search: async (): Promise<ImportCandidate[]> => [candidate, candidate]
  }
  assert.equal((await searchSources('song', [provider])).candidates.length, 1)
  assert.deepEqual(await searchSources(' ', [provider]), { candidates: [], errors: [], pending: 0 })
})
