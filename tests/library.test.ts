import assert from 'node:assert/strict'
import { test } from 'node:test'
import path from 'node:path'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { Script } from 'node:vm'
import { loadTestModule } from './helpers.ts'
import ts from 'typescript'
import { computed, effectScope, markRaw, nextTick, ref, watch } from 'vue'
import { parseSongManifest } from '../src/main/song-management/formats/manifest.ts'
import { parseSongFile } from '../src/main/song-management/formats/ultrastar.ts'
import type { Song } from '../src/shared/types.ts'
import { createSongDeletionFixture, folder, meta, manifest, videoId } from './fixtures.ts'
import * as apiErrors from '../src/shared/errors.ts'
import * as youtubeUrl from '../src/shared/youtubeUrl.ts'

test('UltraStar END uses milliseconds, preserves START seconds and applies only the video gap', () => {
  const parse = (end?: string): Song =>
    parseSongFile(
      [
        '#TITLE:End boundary',
        '#ARTIST:Artist',
        '#BPM:120',
        '#MP3:audio.mp3',
        '#VIDEO:video.mp4',
        '#VIDEOGAP:1.75',
        '#START:12',
        ...(end === undefined ? [] : [`#END:${end}`]),
        ': 0 4 60 Lyrics',
        'E'
      ].join('\n'),
      folder,
      0,
      250,
      { ...meta }
    )
  const song = parse('123456')
  assert.equal(song.audioStartSeconds, 12)
  assert.equal(song.audioEndSeconds, 123.456)
  assert.equal(song.videoEndSeconds, 125.206)
  for (const value of [undefined, '', 'invalid', '123456oops', 'NaN', 'Infinity', '-1', '0']) {
    const untrimmed = parse(value)
    assert.equal(untrimmed.audioEndSeconds, undefined)
    assert.equal(untrimmed.videoEndSeconds, undefined)
  }
})

test('UltraStar lyrics retain golden and golden rap notes for both singers with unchanged timing', async (context) => {
  const fixture = await createSongDeletionFixture(context)
  const song = await fixture.addSong(path.join(fixture.root, 'golden-song'), 'golden-song')
  await writeFile(path.join(song.folder, 'meta.vibes'), JSON.stringify(song.meta))
  await writeFile(path.join(song.folder, 'offset.fix'), '25')
  await writeFile(
    path.join(song.folder, 'lyrics.txt'),
    [
      '#TITLE:Golden song',
      '#ARTIST:Test artist',
      '#BPM:120',
      '#GAP:200',
      '#VIDEO:video.mp4',
      ': 0 4 60 Normal',
      '* 4 4 60 Golden',
      'G 8 4 60 Golden rap',
      'R 12 4 60 Rap',
      '- 16',
      'P2',
      '* 16 4 60 Second singer',
      'E'
    ].join('\n')
  )
  const [loaded] = await fixture.refreshSongs()
  assert.deepEqual(
    Array.from(loaded.lines.P1[0].syllables, (syllable) => [
      syllable.text,
      syllable.isGolden === true,
      syllable.startTimeMs,
      syllable.endTimeMs
    ]),
    [
      ['Normal', false, 225, 725],
      ['Golden', true, 725, 1225],
      ['Golden rap', true, 1225, 1725],
      ['Rap', false, 1725, 2225]
    ]
  )
  assert.equal(loaded.lines.P2![0].syllables[0].isGolden, true)
})

test('song offsets persist in metadata, replace old corrections and survive reloading without doubling', async (context) => {
  const fixture = await createSongDeletionFixture(context)
  const song = await fixture.addSong(path.join(fixture.root, 'offset-song'), 'offset-song')
  await writeFile(path.join(song.folder, 'song.vibes.json'), JSON.stringify(manifest()))
  await writeFile(path.join(song.folder, 'meta.vibes'), JSON.stringify(song.meta))
  await writeFile(path.join(song.folder, 'offset.fix'), '250')
  const [loaded] = await fixture.refreshSongs()
  assert.equal(loaded.fixOffsetMs, 250)
  const initialStart = loaded.lines.P1[0].startTimeMs
  const initialLines = loaded.lines
  await fixture.fixOffset({ ...loaded, folder: fixture.base, index: 99 }, -125)
  assert.equal(fixture.manager.songs[0], loaded)
  assert.equal(loaded.fixOffsetMs, 250)
  assert.equal(loaded.lines, initialLines)
  assert.equal(loaded.lines.P1[0].startTimeMs, initialStart)
  assert.equal(loaded.lines.P1[0].syllables[0].startTimeMs, initialStart)
  const savedMeta = JSON.parse(await readFile(path.join(song.folder, 'meta.vibes'), 'utf8'))
  assert.equal(savedMeta.fixOffsetMs, -125)
  assert.equal(savedMeta.id, song.meta.id)
  assert.equal(savedMeta.playCount, song.meta.playCount)
  assert.equal(savedMeta.favorite, song.meta.favorite)
  assert.equal(existsSync(path.join(fixture.base, 'meta.vibes')), false)
  await fixture.songPlayed(song.meta.id)
  const playedMeta = JSON.parse(await readFile(path.join(song.folder, 'meta.vibes'), 'utf8'))
  assert.equal(playedMeta.fixOffsetMs, -125)
  assert.equal(playedMeta.playCount, song.meta.playCount + 1)
  const [reloaded] = await fixture.refreshSongs()
  assert.equal(reloaded.fixOffsetMs, -125)
  assert.equal(reloaded.lines.P1[0].startTimeMs, initialStart - 375)
  await fixture.fixOffset(reloaded, 0)
  const [reset] = await fixture.refreshSongs()
  assert.equal(reset.fixOffsetMs, 0)
  assert.equal(reset.lines.P1[0].startTimeMs, initialStart - 250)
  await fixture.fixOffset(reset, 12.5)
  const [fractional] = await fixture.refreshSongs()
  assert.equal(fractional.fixOffsetMs, 12.5)
  assert.equal(fractional.lines.P1[0].startTimeMs, initialStart - 237.5)
})

test('song offsets reject invalid numbers and identities and preserve cached lyrics on save failures', async (context) => {
  const fixture = await createSongDeletionFixture(context)
  const song = await fixture.addSong(path.join(fixture.root, 'song'), 'song')
  for (const offset of [NaN, Infinity, -Infinity, '100', null]) {
    await assert.rejects(fixture.fixOffset(song, offset), { code: 'invalid_request' })
  }
  await assert.rejects(fixture.fixOffset({ ...song, meta: { ...song.meta, id: 'unknown' } }, 100), {
    code: 'song_not_found'
  })
  fixture.failWith(new Error('Disk write failed'))
  await assert.rejects(fixture.fixOffset(song, 100), /Disk write failed/)
  assert.equal(fixture.manager.songs[0], song)
  assert.equal(song.fixOffsetMs, 0)
  assert.equal(existsSync(path.join(song.folder, 'meta.vibes')), false)
})

test('song deletion removes the complete song folder and reindexes the remaining library', async (context) => {
  const fixture = await createSongDeletionFixture(context)
  const first = await fixture.addSong(path.join(fixture.root, 'first'), 'first')
  const second = await fixture.addSong(path.join(fixture.root, 'second'), 'second')
  await mkdir(path.join(first.folder, 'nested'))
  await writeFile(path.join(first.folder, 'nested', 'captions.json3'), 'test captions')
  const result = await fixture.deleteSong(first.meta.id)
  assert.equal(result.ok, true)
  assert.equal(existsSync(first.folder), false)
  assert.equal(existsSync(path.join(second.folder, 'video.mp4')), true)
  assert.deepEqual(
    Array.from(fixture.manager.songs, (song) => [song.meta.id, song.index]),
    [['second', 0]]
  )
  assert.equal(result.ok && result.value[0].meta.id, 'second')
  assert.equal(fixture.errors.length, 0)
  assert.equal((await fixture.deleteSong(second.meta.id)).ok, true)
  assert.equal(fixture.manager.songs.length, 0)
  assert.equal(existsSync(fixture.root), true)
})

test('partial song metadata updates are validated, serialized and preserve immutable identity', async (context) => {
  const fixture = await createSongDeletionFixture(context)
  const song = await fixture.addSong(path.join(fixture.root, 'metadata'), 'metadata')
  await Promise.all([
    fixture.manager.updateSong(song.meta.id, { favorite: true }),
    fixture.manager.updateSong(song.meta.id, { playCount: 12, fixOffsetMs: -100 })
  ])
  const saved = JSON.parse(await readFile(path.join(song.folder, 'meta.vibes'), 'utf8'))
  assert.deepEqual(saved, {
    ...meta,
    id: song.meta.id,
    favorite: true,
    playCount: 12,
    fixOffsetMs: -100
  })
  for (const patch of [
    { id: 'replacement' },
    { folder: fixture.base },
    { favorite: 'yes' },
    { playCount: -1 },
    { playCount: 1.5 }
  ]) {
    await assert.rejects(fixture.manager.updateSong(song.meta.id, patch), {
      code: 'invalid_request'
    })
  }
  assert.equal(song.meta.id, 'metadata')
})

test('unified renderer song management owns library, metadata, downloads and listener disposal', async () => {
  const source = await readFile(
    new URL('../src/renderer/src/composables/useSongManagement.ts', import.meta.url),
    'utf8'
  )
  const cleanup: Array<() => void> = []
  const song = parseSongManifest(JSON.stringify(manifest()), folder, 0, 0, { ...meta })
  let releases = 0
  const module = loadTestModule(
    source,
    {
      vue: {
        ref,
        computed,
        watch: () => {},
        onMounted: () => {},
        onScopeDispose: (callback: () => void) => cleanup.push(callback),
        provide: () => {}
      },
      '@shared/errors': apiErrors,
      '@shared/youtubeUrl': youtubeUrl
    },
    {
      window: {
        api: {
          songs: {
            getSongs: async () => ({ ok: true, value: [song] }),
            searchSongs: async () => ({ ok: true, value: { songs: [], errors: [] } }),
            updateSong: async (id: string, patch: object) => ({
              ok: true,
              value: { ...song.meta, ...patch, id }
            }),
            downloadSong: async () => ({ ok: true, value: song }),
            deleteSong: async () => ({ ok: true, value: [] }),
            onDownloadProgress: () => () => {
              releases++
            }
          }
        }
      }
    }
  ) as {
    useSongManagement(): {
      songs: { value: Song[] }
      downloads: { value: { status: string }[] }
      getSongs(): Promise<Song[]>
      updateSong(id: string, patch: object): Promise<unknown>
      downloadSong(request: object): Promise<Song>
      deleteSong(id: string): Promise<Song[]>
    }
  }
  const management = module.useSongManagement()
  await management.getSongs()
  const lines = management.songs.value[0].lines
  await management.updateSong(song.meta.id, { favorite: true, fixOffsetMs: 100 })
  assert.equal(management.songs.value[0].meta.favorite, true)
  assert.equal(management.songs.value[0].lines, lines)
  assert.equal(management.songs.value[0].fixOffsetMs, 0)
  await management.downloadSong({ candidate: { source: 'youtube', id: videoId } })
  assert.equal(management.downloads.value[0].status, 'completed')
  assert.equal(management.songs.value.length, 1)
  await management.deleteSong(song.meta.id)
  assert.equal(management.songs.value.length, 0)
  cleanup.forEach((callback) => callback())
  assert.equal(releases, 1)
})

test('song deletion rejects unknown IDs, library roots, outside folders and directory links', async (context) => {
  const fixture = await createSongDeletionFixture(context)
  const outside = await fixture.addSong(path.join(fixture.base, 'outside'), 'outside')
  const rootSong = await fixture.addSong(fixture.root, 'root')
  const nested = await fixture.addSong(path.join(fixture.root, 'collection', 'nested'), 'nested')
  const protectedRoot = await fixture.addSong(
    path.join(fixture.root, 'also-a-library'),
    'protected'
  )
  fixture.roots.push(protectedRoot.folder)
  const linked = path.join(fixture.root, 'linked')
  await symlink(outside.folder, linked, process.platform === 'win32' ? 'junction' : 'dir')
  fixture.manager._songs.push({
    ...outside,
    folder: linked,
    meta: { ...outside.meta, id: 'linked' }
  })
  for (const id of [
    null,
    {},
    '',
    '../outside',
    'outside',
    'root',
    'nested',
    'protected',
    'linked'
  ]) {
    const result = await fixture.deleteSong(id)
    assert.equal(result.ok, false)
    assert.deepEqual(!result.ok && Object.keys(result.error), ['code'])
  }
  for (const folder of [
    outside.folder,
    rootSong.folder,
    nested.folder,
    protectedRoot.folder,
    linked
  ])
    assert.equal(existsSync(path.join(folder, 'video.mp4')), true)
  assert.equal(fixture.manager.songs.length, 5)
})

test('song deletion preserves the library on disk errors and rejects duplicate song identities', async (context) => {
  const fixture = await createSongDeletionFixture(context)
  const song = await fixture.addSong(path.join(fixture.root, 'song'), 'song')
  const failure = Object.assign(new Error('Private filesystem diagnostic'), { code: 'EACCES' })
  fixture.failWith(failure)
  const result = await fixture.deleteSong(song.meta.id)
  assert.equal(result.ok, false)
  assert.equal(!result.ok && result.error.code, 'access_denied')
  assert.equal(existsSync(song.folder), true)
  assert.equal(fixture.manager.songs[0], song)
  assert.equal((fixture.errors[0] as unknown[])[1], failure)
  const duplicate = await fixture.addSong(path.join(fixture.root, 'duplicate'), song.meta.id)
  assert.equal((await fixture.deleteSong(song.meta.id)).ok, false)
  assert.equal(existsSync(song.folder), true)
  assert.equal(existsSync(duplicate.folder), true)
})

test('saving a song offset only persists the file without changing the shared lyrics or media', async () => {
  const song = parseSongManifest(JSON.stringify(manifest()), folder, 0, 0, { ...meta })
  const module = loadTestModule(
    await readFile(
      new URL('../src/renderer/src/composables/useSongManagement.ts', import.meta.url),
      'utf8'
    ),
    {
      vue: {
        ref,
        computed,
        watch: () => {},
        provide: () => {},
        onMounted: () => {},
        onScopeDispose: () => {}
      },
      '@shared/errors': apiErrors,
      '@shared/youtubeUrl': youtubeUrl
    },
    {
      window: {
        api: {
          songs: {
            onDownloadProgress: () => () => {},
            updateSong: async (received: string, patch: { fixOffsetMs: number }) => {
              assert.equal(received, song.meta.id)
              assert.equal(patch.fixOffsetMs, 100)
              return { ok: true, value: { ...song.meta, fixOffsetMs: 100 } }
            }
          }
        }
      }
    }
  ) as {
    useSongManagement(): {
      songs: ReturnType<typeof ref<Song[]>>
      updateSong(id: string, patch: object): Promise<unknown>
    }
  }
  const api = module.useSongManagement()
  api.songs.value = [song]
  const library = api.songs.value
  const playing = api.songs.value[0]
  const lines = playing.lines
  await api.updateSong(playing.meta.id, { fixOffsetMs: 100 })
  assert.equal(api.songs.value, library)
  assert.equal(api.songs.value[0], playing)
  assert.equal(playing.video, song.video)
  assert.equal(playing.audio, song.audio)
  assert.equal(playing.lines, lines)
  assert.equal(playing.fixOffsetMs, 0)
  assert.equal(playing.meta.fixOffsetMs, 100)
})

test('shared song library sends only the song ID and changes only after successful deletion', async () => {
  const source = await readFile(
    new URL('../src/renderer/src/composables/useSongManagement.ts', import.meta.url),
    'utf8'
  )
  const first = parseSongManifest(JSON.stringify(manifest()), folder, 0, 0, {
    ...meta,
    id: 'first'
  })
  const second = { ...first, index: 1, meta: { ...first.meta, id: 'second' } }
  const ids: string[] = []
  let response: apiErrors.ApiResult<Song[]> = { ok: false, error: { code: 'access_denied' } }
  const module = loadTestModule(
    source,
    {
      vue: {
        ref,
        computed,
        watch: () => {},
        provide: () => {},
        onMounted: () => {},
        onScopeDispose: () => {}
      },
      '@shared/errors': apiErrors,
      '@shared/youtubeUrl': youtubeUrl
    },
    {
      window: {
        api: {
          songs: {
            onDownloadProgress: () => () => {},
            deleteSong: async (id: string) => {
              ids.push(id)
              return response
            }
          }
        }
      }
    }
  ) as {
    useSongManagement: () => {
      songs: {
        value: Song[]
      }
      deleteSong: (id: string) => Promise<Song[]>
    }
  }
  const api = module.useSongManagement()
  api.songs.value = [first, second]
  await assert.rejects(api.deleteSong(first.meta.id), { code: 'access_denied' })
  assert.equal(api.songs.value.length, 2)
  response = { ok: true, value: [{ ...second, index: 0 }] }
  await api.deleteSong(first.meta.id)
  assert.deepEqual(ids, ['first', 'first'])
  assert.equal(api.songs.value.length, 1)
  assert.equal(api.songs.value[0].meta.id, 'second')
  assert.equal(api.songs.value[0].index, 0)
})

test('preview releases deleted-song media, ignores stale loads and preserves a valid selection', async (context) => {
  const source = await readFile(
    new URL('../src/renderer/src/composables/usePreviewPlayer.ts', import.meta.url),
    'utf8'
  )
  const first = parseSongManifest(JSON.stringify(manifest()), folder, 0, 0, {
    ...meta,
    id: 'first'
  })
  const second = { ...first, index: 1, meta: { ...first.meta, id: 'second' } }
  const third = { ...first, index: 2, meta: { ...first.meta, id: 'third' } }
  const songs = ref([first, second, third])
  const media: Media[] = []
  const cleanup: Array<() => void> = []
  class Media {
    src = ''
    volume = 1
    muted = false
    readyState = 3
    currentTime = 0
    pauses = 0
    plays = 0
    constructor() {
      media.push(this)
      markRaw(this)
    }
    addEventListener(): void {}
    removeEventListener(): void {}
    load(): void {}
    pause(): void {
      this.pauses++
    }
    play(): Promise<void> {
      this.plays++
      return Promise.resolve()
    }
    removeAttribute(name: string): void {
      if (name === 'src') this.src = ''
    }
  }
  const module = loadTestModule(
    source,
    {
      vue: {
        ref,
        computed,
        watch,
        provide: () => {},
        onUnmounted: (callback: () => void) => cleanup.push(callback)
      },
      './useSongManagement': { accessSongManagement: () => ({ songs }) },
      './useSettings': { accessSettings: () => ({ settings: ref({ musicVolume: 0.5 }) }) },
      '@renderer/utils/accessLocalFile': { accessLocalFile: (value: string) => value },
      gsap: { default: {} }
    },
    { Audio: Media, console: { log: () => {} } }
  ) as {
    usePreviewPlayer: (index: number) => {
      currentIndex: {
        value: number
      }
      currentSong: {
        value: Song | undefined
      }
      video: {
        value: Media | null
      }
      isPlaying: {
        value: boolean
      }
      stop: () => void
      reload: () => Promise<void>
    }
  }
  const scope = effectScope()
  context.after(() => {
    for (const callback of cleanup) callback()
    scope.stop()
  })
  const player = scope.run(() => module.usePreviewPlayer(2))!
  const video = new Media()
  player.video.value = video
  await nextTick()
  await nextTick()
  assert.equal(player.currentSong.value?.meta.id, 'third')
  assert.equal(player.isPlaying.value, true)
  songs.value = [
    { ...second, index: 0 },
    { ...third, index: 1 }
  ]
  await nextTick()
  await nextTick()
  assert.equal(player.currentIndex.value, 1)
  assert.equal(player.currentSong.value?.meta.id, 'third')
  const pending = player.reload()
  player.stop()
  await pending
  assert.equal(player.isPlaying.value, false)
  assert.equal(video.src, '')
  assert.equal(media[0].src, '')
  assert.ok(video.pauses > 0)
  songs.value = [{ ...second, index: 0 }]
  await nextTick()
  await nextTick()
  assert.equal(player.currentIndex.value, 0)
  assert.equal(player.currentSong.value?.meta.id, 'second')
  songs.value = []
  await nextTick()
  await nextTick()
  assert.equal(player.currentIndex.value, 0)
  assert.equal(player.currentSong.value, undefined)
  assert.equal(player.isPlaying.value, false)
  assert.equal(video.src, '')
})

for (const scenario of [
  { name: 'audio only', audio: true, video: false, end: '5000', gap: 0, boundary: 5, duration: 5 },
  {
    name: 'video only with positive gap',
    audio: false,
    video: true,
    end: '5000',
    gap: 1.25,
    boundary: 6.25,
    duration: 6.25
  },
  {
    name: 'video only with negative gap',
    audio: false,
    video: true,
    end: '5000',
    gap: -1.25,
    boundary: 3.75,
    duration: 3.75
  },
  {
    name: 'separate audio and video',
    audio: true,
    video: true,
    end: '5000',
    gap: 1.25,
    boundary: 5,
    duration: 5
  },
  {
    name: 'missing END',
    audio: true,
    video: true,
    end: undefined,
    gap: 1.25,
    boundary: undefined,
    duration: 20
  },
  {
    name: 'invalid END',
    audio: false,
    video: true,
    end: 'invalid',
    gap: 0,
    boundary: undefined,
    duration: 30
  },
  {
    name: 'END beyond media duration',
    audio: true,
    video: false,
    end: '40000',
    gap: 0,
    boundary: undefined,
    duration: 20
  }
]) {
  test(`song playback honors END without an outro: ${scenario.name}`, async (context) => {
    const song = parseSongFile(
      [
        '#TITLE:End boundary',
        '#ARTIST:Artist',
        '#BPM:120',
        ...(scenario.audio ? ['#MP3:audio.mp3'] : []),
        ...(scenario.video ? ['#VIDEO:video.mp4'] : []),
        `#VIDEOGAP:${scenario.gap}`,
        ...(scenario.end === undefined ? [] : [`#END:${scenario.end}`]),
        ': 0 4 60 Lyrics',
        'E'
      ].join('\n'),
      folder,
      0,
      250,
      { ...meta }
    )
    const media: Media[] = []
    const frames = new Map<number, () => void>()
    const cleanup: Array<() => void> = []
    let frameId = 0
    class Media {
      src = ''
      currentTime = 0
      duration = 20
      readyState = 3
      volume = 1
      muted = false
      pauses = 0
      onended: (() => void) | null = null
      constructor() {
        media.push(this)
        markRaw(this)
      }
      addEventListener(): void {}
      removeEventListener(): void {}
      load(): void {}
      removeAttribute(name: string): void {
        if (name === 'src') this.src = ''
      }
      pause(): void {
        this.pauses++
      }
      play(): Promise<void> {
        return Promise.resolve()
      }
    }
    const module = loadTestModule(
      await readFile(
        new URL('../src/renderer/src/composables/useSongPlayer.ts', import.meta.url),
        'utf8'
      ),
      {
        vue: {
          ref,
          computed,
          watch,
          provide: () => {},
          onUnmounted: (callback: () => void) => cleanup.push(callback)
        },
        './useSongManagement': { accessSongManagement: () => ({ songs: ref([song]) }) },
        './useSettings': { accessSettings: () => ({ settings: ref({ musicVolume: 0.5 }) }) },
        '@renderer/utils/accessLocalFile': { accessLocalFile: (value: string) => value }
      },
      {
        Audio: Media,
        console: { log: () => {} },
        requestAnimationFrame: (callback: () => void) => {
          frames.set(++frameId, callback)
          return frameId
        },
        cancelAnimationFrame: (id: number) => frames.delete(id)
      }
    ) as {
      useSongPlayer: () => {
        video: { value: Media | null }
        isLoaded: { value: boolean }
        isPlaying: { value: boolean }
        pausedByUser: { value: boolean }
        ended: { value: boolean }
        duration: { value: number }
        play(): Promise<void>
        pause(): void
      }
    }
    const scope = effectScope()
    const player = scope.run(() => module.useSongPlayer())!
    context.after(() => {
      player.pause()
      cleanup.forEach((release) => release())
      scope.stop()
    })
    const video = new Media()
    video.duration = 30
    player.video.value = video
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(player.isLoaded.value, true)
    assert.equal(player.duration.value, scenario.duration)
    const master = scenario.audio ? media[0] : video
    const advance = (time: number): void => {
      master.currentTime = time
      const callbacks = Array.from(frames.values())
      frames.clear()
      callbacks.forEach((callback) => callback())
    }
    await player.play()
    advance((scenario.boundary ?? 10) - 0.01)
    assert.equal(player.ended.value, false)
    assert.equal(player.isPlaying.value, true)
    if (scenario.boundary !== undefined) {
      advance(scenario.boundary)
      assert.equal(player.ended.value, true)
      assert.equal(player.isPlaying.value, false)
      assert.equal(player.pausedByUser.value, false)
      assert.equal(frames.size, 0)
      if (scenario.audio) assert.ok(media[0].pauses > 0)
      if (scenario.video) assert.ok(video.pauses > 0)
    } else {
      advance(15)
      assert.equal(player.ended.value, false)
      master.onended?.()
      assert.equal(player.ended.value, true)
    }
  })
}

test('video playback keeps Chromium frame pacing and GPU synchronization enabled', async () => {
  const source = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true)
  const switches = new Map<string, string | undefined>()
  const app = {
    commandLine: {
      appendSwitch: (name: string, value?: string) => switches.set(name, value)
    }
  }
  for (const statement of sourceFile.statements) {
    if (
      ts.isExpressionStatement(statement) &&
      ts.isCallExpression(statement.expression) &&
      statement.expression.expression.getText(sourceFile) === 'app.commandLine.appendSwitch'
    ) {
      new Script(statement.getText(sourceFile)).runInNewContext({ app })
    }
  }
  assert.equal(switches.has('disable-frame-rate-limit'), false)
  assert.equal(switches.has('disable-gpu-vsync'), false)
  assert.equal(switches.has('disable-gpu'), false)
  assert.equal(switches.has('disable-accelerated-video-decode'), false)
  assert.equal(switches.get('autoplay-policy'), 'no-user-gesture-required')
})
