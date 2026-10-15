import assert from 'node:assert/strict'
import { test } from 'node:test'
import path from 'node:path'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { Script } from 'node:vm'
import { loadTestModule } from './helpers.ts'
import ts from 'typescript'
import { computed, effectScope, markRaw, nextTick, ref, watch } from 'vue'
import { parseSongManifest } from '../src/main/song-import/manifest.ts'
import type { Song, SongDeleteResponse } from '../src/shared/types.ts'
import { createSongDeletionFixture, folder, meta, manifest } from './fixtures.ts'

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
    await assert.rejects(fixture.fixOffset(song, offset), /finite number/)
  }
  await assert.rejects(
    fixture.fixOffset({ ...song, meta: { ...song.meta, id: 'unknown' } }, 100),
    /uniquely identified/
  )
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
  assert.equal(result.ok && result.songs[0].meta.id, 'second')
  assert.equal(fixture.errors.length, 0)
  assert.equal((await fixture.deleteSong(second.meta.id)).ok, true)
  assert.equal(fixture.manager.songs.length, 0)
  assert.equal(existsSync(fixture.root), true)
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
    assert.equal(!result.ok && result.error.includes(fixture.base), false)
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
  assert.equal(!result.ok && result.error.includes('Private'), false)
  assert.equal(existsSync(song.folder), true)
  assert.equal(fixture.manager.songs[0], song)
  assert.equal((fixture.errors[0] as unknown[])[1], failure)
  const duplicate = await fixture.addSong(path.join(fixture.root, 'duplicate'), song.meta.id)
  assert.equal((await fixture.deleteSong(song.meta.id)).ok, false)
  assert.equal(existsSync(song.folder), true)
  assert.equal(existsSync(duplicate.folder), true)
})

test('saving a song offset only persists the file without changing the shared lyrics or media', async () => {
  const song = parseSongManifest(JSON.stringify(manifest()), folder, 0, 0, meta)
  const module = loadTestModule(
    await readFile(new URL('../src/renderer/src/composables/useSongs.ts', import.meta.url), 'utf8'),
    { vue: { ref, provide: () => undefined, onMounted: () => undefined } },
    {
      window: {
        api: {
          songs: {
            fixOffset: async (received: string, offset: number) => {
              assert.equal(received, song.meta.id)
              assert.equal(offset, 100)
            }
          }
        }
      }
    }
  ) as {
    useSongs(): {
      songs: ReturnType<typeof ref<Song[]>>
      fixOffset(song: Song, offset: number): Promise<void>
    }
  }
  const api = module.useSongs()
  api.songs.value = [song]
  const library = api.songs.value
  const playing = api.songs.value[0]
  const lines = playing.lines
  await api.fixOffset(playing, 100)
  assert.equal(api.songs.value, library)
  assert.equal(api.songs.value[0], playing)
  assert.equal(playing.video, song.video)
  assert.equal(playing.audio, song.audio)
  assert.equal(playing.lines, lines)
  assert.equal(playing.fixOffsetMs, 0)
  assert.equal(playing.meta.fixOffsetMs, undefined)
})

test('shared song library sends only the song ID and changes only after successful deletion', async () => {
  const source = await readFile(
    new URL('../src/renderer/src/composables/useSongs.ts', import.meta.url),
    'utf8'
  )
  const first = parseSongManifest(JSON.stringify(manifest()), folder, 0, 0, {
    ...meta,
    id: 'first'
  })
  const second = { ...first, index: 1, meta: { ...first.meta, id: 'second' } }
  const ids: string[] = []
  let response: SongDeleteResponse = { ok: false, error: 'Cannot delete' }
  const module = loadTestModule(
    source,
    {
      vue: { ref, provide: () => {}, onMounted: () => {} }
    },
    {
      window: {
        api: {
          songs: {
            deleteSong: async (id: string) => {
              ids.push(id)
              return response
            }
          }
        }
      }
    }
  ) as {
    useSongs: () => {
      songs: {
        value: Song[]
      }
      deleteSong: (song: Song) => Promise<SongDeleteResponse>
    }
  }
  const api = module.useSongs()
  api.songs.value = [first, second]
  assert.equal((await api.deleteSong(first)).ok, false)
  assert.equal(api.songs.value.length, 2)
  response = { ok: true, songs: [{ ...second, index: 0 }] }
  assert.equal((await api.deleteSong(first)).ok, true)
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
      './useSongs': { accessSongs: () => ({ songs }) },
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
