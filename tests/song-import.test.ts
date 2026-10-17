import assert from 'node:assert/strict'
import { test } from 'node:test'
import path from 'node:path'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { loadTestModule } from './helpers.ts'
import { parseSongManifest } from '../src/main/song-management/formats/manifest.ts'
import type { SongManifest } from '../src/shared/types.ts'
import type { ImportCandidate } from '../src/shared/types.ts'
import * as downloadErrors from '../src/shared/errors.ts'
import type { SongImportRequest } from '../src/shared/types.ts'
import { createYoutubeImportFixture, createSongDeletionFixture, manifest } from './fixtures.ts'
import * as songTypes from '../src/shared/types.ts'

test('YouTube lyrics-video imports download only media and load with empty captions', async (context) => {
  const fixture = await createYoutubeImportFixture(context)
  fixture.metadata.subtitles = {}
  await fixture.import()
  assert.equal(fixture.calls.commands.length, 1)
  assert.equal(fixture.calls.commands[0].includes('--dump-single-json'), true)
  assert.equal(fixture.calls.downloads, 1)
  assert.deepEqual((await readdir(fixture.folder)).sort(), ['song.vibes.json', 'video.mp4'])
  const contents = await readFile(path.join(fixture.folder, 'song.vibes.json'), 'utf8')
  const data = JSON.parse(contents) as SongManifest
  assert.deepEqual(data.lyrics, { timing: 'video', lines: [] })
  assert.deepEqual(data.language, [])
  const song = parseSongManifest(contents, fixture.folder, 0, 0, {
    id: 'video',
    favorite: false,
    playCount: 0
  })
  assert.equal(song.lyricsTiming, 'video')
  assert.equal(song.usesVideo, true)
  assert.deepEqual(song.lines.P1, [])
})

test('YouTube lyrics-video imports ignore downloadable caption tracks', async (context) => {
  const fixture = await createYoutubeImportFixture(context)
  await fixture.import()
  assert.equal(fixture.calls.commands.length, 1)
  assert.equal(
    (
      JSON.parse(
        await readFile(path.join(fixture.folder, 'song.vibes.json'), 'utf8')
      ) as SongManifest
    ).lyrics.timing,
    'video'
  )
})

test('YouTube caption imports still require and download the selected track', async (context) => {
  const fixture = await createYoutubeImportFixture(context)
  delete fixture.candidate.lyricsInVideo
  await assert.rejects(
    fixture.import({
      candidate: fixture.candidate,
      captionTrackId: 'missing',
      title: 'Song',
      artist: 'Artist'
    }),
    { code: 'captions_unavailable' }
  )
  assert.equal(fixture.calls.downloads, 0)
  await fixture.import({
    candidate: fixture.candidate,
    captionTrackId: 'manual:en',
    title: 'Song',
    artist: 'Artist'
  })
  assert.equal(
    fixture.calls.commands.some((args) => args.includes('--write-subs')),
    true
  )
  const data = JSON.parse(
    await readFile(path.join(fixture.folder, 'song.vibes.json'), 'utf8')
  ) as SongManifest
  assert.equal(data.lyrics.timing, 'phrase')
  assert.equal(data.lyrics.lines.length, 1)
  assert.equal(data.lyrics.originalFile, 'captions.json3')
})

test('YouTube caption imports resolve regional track IDs from existing search results', async (context) => {
  const fixture = await createYoutubeImportFixture(context)
  fixture.candidate.tracks = [{ id: 'manual:de', language: 'de', name: 'German', automatic: false }]
  fixture.metadata.subtitles = { 'de-DE': [{ ext: 'json3', name: 'German' }] }
  await fixture.import({
    candidate: fixture.candidate,
    captionTrackId: 'manual:de',
    title: 'Song',
    artist: 'Artist'
  })
  const command = fixture.calls.commands.find((args) => args.includes('--write-subs'))!
  assert.equal(command[command.indexOf('--sub-langs') + 1], '^de-DE$')
  const data = JSON.parse(
    await readFile(path.join(fixture.folder, 'song.vibes.json'), 'utf8')
  ) as SongManifest
  assert.equal(data.lyrics.language, 'de-DE')
  assert.equal(data.lyrics.automatic, false)
})

test('YouTube caption imports resolve original automatic track aliases', async (context) => {
  const fixture = await createYoutubeImportFixture(context)
  fixture.candidate.tracks = [{ id: 'auto:en', language: 'en', name: 'English', automatic: true }]
  fixture.metadata.subtitles = {}
  Object.assign(fixture.metadata, {
    automatic_captions: { 'en-orig': [{ ext: 'json3', name: 'English (Original)' }] }
  })
  await fixture.import({
    candidate: fixture.candidate,
    captionTrackId: 'auto:en',
    title: 'Song',
    artist: 'Artist'
  })
  const command = fixture.calls.commands.find((args) => args.includes('--write-auto-subs'))!
  assert.equal(command[command.indexOf('--sub-langs') + 1], '^en-orig$')
})

test('YouTube caption imports never silently replace manual tracks with automatic captions or another language', async (context) => {
  const fixture = await createYoutubeImportFixture(context)
  fixture.candidate.tracks = [{ id: 'manual:de', language: 'de', name: 'German', automatic: false }]
  Object.assign(fixture.metadata, {
    automatic_captions: { de: [{ ext: 'json3', name: 'German' }] }
  })
  await assert.rejects(
    fixture.import({
      candidate: fixture.candidate,
      captionTrackId: 'manual:de',
      title: 'Song',
      artist: 'Artist'
    }),
    /manual:de; yt-dlp tracks: manual:en, auto:de/
  )
  assert.equal(fixture.calls.downloads, 0)
})

test('YouTube caption imports reject ambiguous regional tracks rather than choosing randomly', async (context) => {
  const fixture = await createYoutubeImportFixture(context)
  fixture.candidate.tracks = [{ id: 'manual:de', language: 'de', name: 'German', automatic: false }]
  fixture.metadata.subtitles = {
    'de-DE': [{ ext: 'json3', name: 'Deutsch' }],
    'de-AT': [{ ext: 'json3', name: 'Deutsch' }]
  }
  await assert.rejects(
    fixture.import({
      candidate: fixture.candidate,
      captionTrackId: 'manual:de',
      title: 'Song',
      artist: 'Artist'
    }),
    /no longer available/
  )
  assert.equal(fixture.calls.downloads, 0)
})

test('YouTube lyrics-video imports reject an unmarked candidate, nonmusic, changed identities and livestreams', async (context) => {
  const fixture = await createYoutubeImportFixture(context)
  delete fixture.candidate.lyricsInVideo
  await assert.rejects(fixture.import(), /Invalid video-lyrics/)
  fixture.candidate.lyricsInVideo = true
  fixture.metadata.categories = ['Education']
  delete (
    fixture.metadata as {
      artist?: string
    }
  ).artist
  await assert.rejects(fixture.import(), /Only music videos/)
  fixture.metadata.categories = ['Music']
  fixture.candidate.id = 'video000001'
  await assert.rejects(fixture.import(), /identity changed/)
  fixture.candidate.id = 'video000000'
  fixture.metadata.is_live = true
  await assert.rejects(fixture.import(), /Live streams/)
  fixture.metadata.is_live = false
  fixture.metadata.is_upcoming = true
  await assert.rejects(fixture.import(), /Live streams/)
  assert.equal(fixture.calls.downloads, 0)
})

test('song import reports invalid, duplicate and concurrent requests with typed errors', async (context) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'vibes-import-errors-'))
  context.after(() => rm(folder, { recursive: true, force: true }))
  const source = await readFile(
    new URL('../src/main/song-management/import.ts', import.meta.url),
    'utf8'
  )
  const importer = loadTestModule(source, {
    '../../shared/errors': downloadErrors,
    './providers/usdb/index': { downloadUsdbSong: () => {} },
    './providers/youtube/index': { importYoutube: async () => {} }
  }).importSong as (
    request: SongImportRequest,
    folder: string,
    progress: (value: number) => void
  ) => Promise<unknown>
  await assert.rejects(
    importer({} as SongImportRequest, folder, () => {}),
    { code: 'invalid_request' }
  )
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
    tracks: [],
    lyricsInVideo: true
  }
  const request: SongImportRequest = {
    candidate,
    lyricsInVideo: true,
    title: 'Song',
    artist: 'Artist'
  }
  const pending = importer(request, folder, () => {})
  await assert.rejects(
    importer(request, folder, () => {}),
    { code: 'import_in_progress' }
  )
  await pending
  await assert.rejects(
    importer(request, folder, () => {}),
    { code: 'already_imported' }
  )
  assert.equal(
    (await readdir(folder)).some((name) => name.startsWith('.import-')),
    false
  )
})

test('downloadSong returns a parsed library entry and cleans failed staging or publication', async (context) => {
  const fixture = await createSongDeletionFixture(context)
  let invalidManifest = false
  const importer = loadTestModule(
    await readFile(new URL('../src/main/song-management/import.ts', import.meta.url), 'utf8'),
    {
      '../../shared/errors': downloadErrors,
      './providers/usdb/index': {},
      './providers/youtube/index': {
        importYoutube: async (
          request: SongImportRequest,
          folder: string,
          progress: (value: number) => void
        ) => {
          await writeFile(
            path.join(folder, 'song.vibes.json'),
            JSON.stringify(
              invalidManifest
                ? {}
                : { ...manifest(), source: { provider: 'youtube', id: request.candidate.id } }
            )
          )
          await writeFile(path.join(folder, 'video.mp4'), 'test media')
          progress(1)
        }
      }
    }
  )
  const service = loadTestModule(
    await readFile(new URL('../src/main/song-management/index.ts', import.meta.url), 'utf8'),
    {
      '../../shared/errors': downloadErrors,
      '../../shared/types': songTypes,
      '../settings/index': { basePathForDownload: fixture.root },
      './library': { songManager: fixture.manager },
      './import': importer,
      './search': {},
      './providers/usdb/index': {},
      './providers/youtube/index': {}
    }
  ) as typeof import('../src/main/song-management/index.ts')
  const request: SongImportRequest = {
    candidate: {
      source: 'youtube',
      id: 'video000000',
      title: 'Song',
      artist: 'Artist',
      url: 'https://www.youtube.com/watch?v=video000000',
      tracks: [],
      lyricsInVideo: true
    },
    title: 'Song',
    artist: 'Artist',
    lyricsInVideo: true
  }
  const progress: number[] = []
  await assert.rejects(
    service.downloadSong({} as SongImportRequest, () => {}),
    { code: 'invalid_request' }
  )
  const song = await service.downloadSong(request, (_candidate, value) => progress.push(value))
  assert.equal(song.folder, path.join(fixture.root, 'youtube-video000000'))
  assert.ok(song.lines.P1.length)
  assert.ok(song.meta.id)
  assert.equal(song.meta.playCount, 0)
  assert.equal(song.meta.favorite, false)
  assert.equal(
    JSON.parse(await readFile(path.join(song.folder, 'meta.vibes'), 'utf8')).id,
    song.meta.id
  )
  assert.equal(fixture.manager.songs[0], song)
  assert.equal(progress.at(-1), 1)
  assert.ok(progress.slice(0, -1).every((value) => value <= 0.99))
  await assert.rejects(
    service.downloadSong(request, () => {}),
    { code: 'already_imported' }
  )
  const next = { ...request, candidate: { ...request.candidate, id: 'video000001' } }
  invalidManifest = true
  await assert.rejects(service.downloadSong(next, () => {}))
  assert.deepEqual(await readdir(fixture.root), ['youtube-video000000'])
  invalidManifest = false
  fixture.manager.addSong = async () => {
    throw new Error('Final library read failed')
  }
  await assert.rejects(
    service.downloadSong(next, () => {}),
    /Final library read failed/
  )
  assert.deepEqual(await readdir(fixture.root), ['youtube-video000000'])
  assert.equal(fixture.manager.songs.length, 1)
})
