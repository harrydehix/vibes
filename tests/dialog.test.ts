import './setup-dom.ts'
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { readFile } from 'node:fs/promises'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as vue from 'vue'
import type { Component } from 'vue'
import type { Song, SongDeleteResponse } from '../src/shared/types.ts'
import * as captionTracks from '../src/shared/captionTracks.ts'
import { loadTestModule } from './helpers.ts'
import { computed, effectScope, nextTick, reactive, ref, watch } from 'vue'
import { parseSongManifest } from '../src/main/song-import/manifest.ts'
import { folder, meta, manifest } from './fixtures.ts'

const domGlobals = { document, HTMLElement, console }
const animations = {
  context: (run: () => void) => {
    run()
    return { add: (callback: () => void) => callback(), revert: () => {} }
  },
  to: () => {},
  fromTo: () => {}
}

async function loadComponent(
  file: string,
  modules: Record<string, unknown> = {}
): Promise<Component> {
  const source = await readFile(new URL(`../src/renderer/src/${file}`, import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const script = compileScript(descriptor, { id: file, inlineTemplate: true })
  const component = loadTestModule(
    script.content,
    {
      vue,
      gsap: { default: animations },
      '@renderer/composables/useSound': { useSound: () => ({ play: () => {} }) },
      ...modules
    },
    domGlobals
  ).default as Component & { __cssModules: object }
  component.__cssModules = { $style: new Proxy({}, { get: (_, name) => name }) }
  return component
}

async function loadPopup(): Promise<Component> {
  const source = await readFile(
    new URL('../src/renderer/src/composables/useDialogFocus.ts', import.meta.url),
    'utf8'
  )
  const focus = loadTestModule(source, { vue }, domGlobals)
  return await loadComponent('components/Popup.vue', {
    '@renderer/composables/useDialogFocus': focus
  })
}

function mount(
  context: TestContext,
  component: Component,
  props: object = {},
  slots: object = {}
): { host: HTMLDivElement; unmount: () => void } {
  const host = document.createElement('div')
  document.body.append(host)
  const app = vue.createApp({ render: () => vue.h(component, props, slots) })
  app.component('v-icon', { props: ['name'], template: '<i :data-icon="name"></i>' })
  app.mount(host)
  context.after(async () => {
    app.unmount()
    await vue.nextTick()
    host.remove()
  })
  return { host, unmount: () => app.unmount() }
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
  await vue.nextTick()
  await vue.nextTick()
}

function tab(element: Element, shiftKey = false): void {
  element.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
  )
}

test('rendered popup traps focus, skips disabled controls, shows progress and restores its opener', async (context) => {
  const opener = document.createElement('button')
  document.body.append(opener)
  context.after(() => opener.remove())
  opener.focus()
  const events: string[] = []
  const props = vue.reactive({
    title: 'Download',
    visible: true,
    okText: 'Downloading 50%',
    okIcon: 'md-clouddownload',
    okProgress: 0.5,
    okDisabled: true,
    cancelText: 'Close',
    cancelDisabled: false,
    initialFocus: 'first' as 'first' | 'cancel',
    onOk: () => events.push('ok'),
    onCancel: () => events.push('cancel')
  })
  const { host, unmount } = mount(context, await loadPopup(), props, {
    default: () => vue.h('input', { 'aria-label': 'Title' })
  })
  await settle()
  const dialog = host.querySelector('[role="dialog"]')!
  const input = dialog.querySelector('input')!
  const [confirm, cancel] = Array.from(dialog.querySelectorAll('button'))
  assert.equal(document.activeElement, input)
  assert.equal(confirm.disabled, true)
  assert.equal(confirm.getAttribute('aria-busy'), 'true')
  assert.match(confirm.textContent!, /Downloading 50%/)
  assert.ok(confirm.querySelector('[data-icon="md-clouddownload"]'))
  assert.ok(confirm.querySelector('[style*="width: 50%"]'))
  cancel.focus()
  tab(cancel)
  assert.equal(document.activeElement, input)
  tab(input, true)
  assert.equal(document.activeElement, cancel)
  confirm.click()
  assert.deepEqual(events, [])
  cancel.click()
  assert.deepEqual(events, ['cancel'])
  props.cancelDisabled = true
  await settle()
  cancel.click()
  assert.deepEqual(events, ['cancel'])
  props.visible = false
  await settle()
  assert.ok(host.querySelector('[inert][aria-hidden="true"]'))
  assert.equal(document.activeElement, opener)
  props.visible = true
  props.initialFocus = 'cancel'
  props.okDisabled = false
  props.cancelDisabled = false
  await settle()
  assert.equal(document.activeElement, cancel)
  unmount()
  await settle()
  assert.equal(document.activeElement, opener)
})

test('rendered song deletion displays disk errors and restores focus after removing the opener', async (context) => {
  const song = (id: string, index: number): Song =>
    ({
      title: 'Song',
      artist: 'Artist',
      index,
      folder: id,
      meta: { id, playCount: 0, favorite: false }
    }) as Song
  const songs = vue.ref([song('first', 0), song('second', 1)])
  let response: SongDeleteResponse = { ok: false, error: 'Could not delete this song.' }
  const preview = {
    songs,
    currentIndex: vue.ref(0),
    currentSong: vue.computed(() => songs.value[0]),
    video: vue.ref(null),
    stop: () => {},
    reload: async () => {}
  }
  const component = await loadComponent('pages/SongList.vue', {
    '@renderer/components/Popup.vue': { default: await loadPopup() },
    '@renderer/components/LeavePopup.vue': { default: { render: () => null } },
    '@renderer/composables/useBackgroundMusic': {
      accessBackgroundMusic: () => ({ disable: () => {} })
    },
    '@renderer/composables/useController': {
      accessController: () => ({ controller: vue.ref(null) })
    },
    '@renderer/composables/usePreviewPlayer': { usePreviewPlayer: () => preview },
    '@renderer/composables/useSettingsView': {
      useSettingsView: () => ({ settingsOpened: vue.ref(false) })
    },
    '@renderer/composables/useSongs': {
      accessSongs: () => ({
        songs,
        refresh: () => {},
        deleteSong: async () => {
          if (response.ok) songs.value = response.songs
          return response
        }
      })
    },
    '@renderer/router': { default: { replace: async () => {} } },
    '@renderer/utils/accessLocalFile': { accessLocalFile: (value: string) => value },
    '@renderer/assets/cover-fallback.png': { default: 'cover' },
    '@vueuse/core': { onKeyStroke: () => {} },
    'vue-router': { useRoute: () => ({ query: {} }) }
  })
  const { host } = mount(context, component)
  const opener = host.querySelector<HTMLButtonElement>('button[title="Delete song"]')!
  opener.focus()
  opener.click()
  await settle()
  const dialog = document.querySelector('[role="dialog"]')!
  const [confirm, cancel] = Array.from(dialog.querySelectorAll('button'))
  assert.equal(document.activeElement, cancel)
  assert.equal(host.querySelector('[inert]') !== null, true)
  confirm.click()
  await settle()
  assert.equal(
    dialog.querySelector('[role="alert"]')?.textContent,
    response.error,
    document.body.innerHTML
  )
  assert.equal(songs.value.length, 2)
  cancel.click()
  await settle()
  assert.equal(document.activeElement, opener)
  opener.click()
  await settle()
  response = { ok: true, songs: [song('second', 0)] }
  document.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click()
  await settle()
  assert.equal(opener.isConnected, false)
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.equal(document.activeElement, host.querySelector('button[title="Delete song"]'))
})

test('rendered YouTube import focuses metadata, selects main captions and displays safe download errors', async (context) => {
  const video = {
    source: 'youtube',
    id: 'video000000',
    title: 'Artist - Song (Lyrics)',
    artist: 'Channel',
    url: 'https://www.youtube.com/watch?v=video000000',
    tracks: [
      { id: 'manual:de', name: 'German', language: 'de', automatic: false },
      { id: 'auto:en', name: 'English', language: 'en', automatic: true, isDefault: true }
    ]
  }
  const downloads = vue.ref([
    {
      candidate: video,
      status: 'error',
      progress: 0,
      error: 'YouTube is limiting requests. Please try again later.'
    }
  ])
  const component = await loadComponent('components/YoutubeImport.vue', {
    './Popup.vue': { default: await loadPopup() },
    '@shared/captionTracks': captionTracks,
    '@renderer/composables/useDownloader': {
      useDownloader: () => ({ downloads, importSong: async () => null })
    },
    '@renderer/composables/useSongs': { accessSongs: () => ({ songs: vue.ref([]) }) },
    '@renderer/assets/cover-fallback.png': { default: 'cover' }
  })
  mount(context, component, { video })
  await settle()
  const dialog = document.querySelector('[role="dialog"]')!
  const inputs = Array.from(dialog.querySelectorAll('input'))
  assert.equal(document.activeElement, inputs[0])
  assert.equal(inputs[0].value, 'Song')
  assert.equal(inputs[1].value, 'Artist')
  assert.equal(dialog.querySelector('select')!.value, 'auto:en')
  assert.equal(dialog.querySelector('[role="alert"]')?.textContent, downloads.value[0].error)
})

test('carousel song deletion requires confirmation, prevents repeats, handles failure and exits an empty library', async (context) => {
  const source = await readFile(
    new URL('../src/renderer/src/pages/SongList.vue', import.meta.url),
    'utf8'
  )
  const { descriptor } = parse(source)
  const script = compileScript(descriptor, { id: 'carousel-delete-test' })
  const first = parseSongManifest(JSON.stringify(manifest()), folder, 0, 0, {
    ...meta,
    id: 'first'
  })
  const second = { ...first, index: 1, meta: { ...first.meta, id: 'second' } }
  const songs = ref([first, second])
  const requests: string[] = []
  const navigation: object[] = []
  const keys = new Map<string, (event: { preventDefault: () => void }) => void>()
  let stops = 0
  let reloads = 0
  let response: SongDeleteResponse = { ok: false, error: 'Could not delete this song.' }
  const preview = {
    songs,
    currentIndex: ref(0),
    currentSong: computed(() => songs.value[0]),
    video: ref(null),
    stop: () => {
      stops++
    },
    reload: async () => {
      reloads++
    }
  }
  const component = loadTestModule(
    script.content,
    {
      vue: {
        ref,
        watch,
        nextTick,
        onMounted: () => {},
        onUnmounted: () => {},
        useCssModule: () => ({}),
        defineComponent: (value: unknown) => value
      },
      '@renderer/components/LeavePopup.vue': {},
      '@renderer/components/Popup.vue': {},
      '@renderer/composables/useBackgroundMusic': {
        accessBackgroundMusic: () => ({ disable: () => {} })
      },
      '@renderer/composables/useController': {
        accessController: () => ({ controller: ref(null) })
      },
      '@renderer/composables/usePreviewPlayer': { usePreviewPlayer: () => preview },
      '@renderer/composables/useSettingsView': {
        useSettingsView: () => ({ settingsOpened: ref(false) })
      },
      '@renderer/composables/useSongs': {
        accessSongs: () => ({
          songs,
          refresh: () => {},
          deleteSong: async (song: Song) => {
            requests.push(song.meta.id)
            if (response.ok) songs.value = response.songs
            return response
          }
        })
      },
      '@renderer/composables/useSound': { useSound: () => ({ play: () => {} }) },
      '@renderer/router': { default: { replace: async (route: object) => navigation.push(route) } },
      '@renderer/utils/accessLocalFile': { accessLocalFile: (value: string) => value },
      '@renderer/assets/cover-fallback.png': 'cover',
      '@vueuse/core': {
        onKeyStroke: (
          names: string | string[],
          callback: (event: { preventDefault: () => void }) => void
        ) => {
          for (const name of typeof names === 'string' ? [names] : names) keys.set(name, callback)
        }
      },
      'vue-router': { useRoute: () => ({ query: {} }) },
      gsap: { default: {} }
    },
    { document: { activeElement: null }, HTMLElement: class {}, console: { error: () => {} } }
  ).default as {
    setup: (
      props: object,
      context: object
    ) => {
      openDelete: (song: Song) => void
      closeDelete: () => void
      confirmDelete: () => Promise<void>
      songToDelete: {
        value: Song | null
      }
      deleting: {
        value: boolean
      }
      deletionError: {
        value: string
      }
    }
  }
  const scope = effectScope()
  context.after(() => scope.stop())
  const state = scope.run(() => component.setup({}, { expose: () => {} }))!
  state.openDelete(first)
  assert.equal(requests.length, 0)
  state.closeDelete()
  assert.equal(state.songToDelete.value, null)
  assert.equal(stops, 0)
  state.openDelete(first)
  let prevented = false
  keys.get('ArrowRight')!({
    preventDefault: () => {
      prevented = true
    }
  })
  assert.equal(prevented, false)
  assert.equal(preview.currentIndex.value, 0)
  const pending = state.confirmDelete()
  assert.equal(state.deleting.value, true)
  state.closeDelete()
  assert.equal(state.songToDelete.value?.meta.id, 'first')
  await state.confirmDelete()
  await pending
  assert.deepEqual(requests, ['first'])
  assert.equal(stops, 1)
  assert.equal(reloads, 1)
  assert.equal(state.deletionError.value, 'Could not delete this song.')
  assert.equal(state.deleting.value, false)
  assert.equal(songs.value.length, 2)
  response = { ok: true, songs: [{ ...second, index: 0 }] }
  await state.confirmDelete()
  assert.equal(state.songToDelete.value, null)
  assert.equal(songs.value[0].meta.id, 'second')
  assert.equal(navigation.length, 0)
  state.openDelete(second)
  response = { ok: true, songs: [] }
  await state.confirmDelete()
  assert.equal(navigation.length, 1)
  assert.equal(
    (
      navigation[0] as {
        path: string
      }
    ).path,
    '/search'
  )
  assert.match(descriptor.template!.content, /@click.stop="openDelete\(song, \$event\)"/)
  assert.match(descriptor.template!.content, /v-icon name="io-trash-bin-sharp"/)
  assert.match(descriptor.template!.content, /:key="song.meta.id"/)
  assert.match(descriptor.template!.content, /:cancelDisabled="deleting"/)
  assert.match(descriptor.template!.content, /v-if="deletionError"[^>]*role="alert"/)
  const search = await readFile(
    new URL('../src/renderer/src/pages/SongSearch.vue', import.meta.url),
    'utf8'
  )
  assert.doesNotMatch(search, /openDelete|deleteButton/)
})

test('YouTube downloads use the standard popup without expanding the search result', async (context) => {
  const source = await readFile(
    new URL('../src/renderer/src/components/YoutubeImport.vue', import.meta.url),
    'utf8'
  )
  const { descriptor } = parse(source)
  const script = compileScript(descriptor, { id: 'youtube-import-popup-test' })
  const video = {
    source: 'youtube',
    id: 'fixture-video',
    title: 'Fixture title',
    artist: 'Fixture artist',
    lyricsInVideo: false,
    tracks: [
      { id: 'creator-en', name: 'English', language: 'en', automatic: false },
      { id: 'auto-de', name: 'German', language: 'de', automatic: true }
    ]
  }
  const downloads = ref<
    Array<{
      candidate: typeof video
      status: 'downloading' | 'completed' | 'error'
      progress: number
      error?: string
    }>
  >([])
  const songs = ref<
    Array<{
      source: {
        provider: string
        id: string
      }
      title: string
    }>
  >([])
  const requests: object[] = []
  const events: Array<{
    name: string
    value: unknown
  }> = []
  const sounds: string[] = []
  const component = loadTestModule(script.content, {
    vue: {
      computed,
      ref,
      watch,
      defineComponent: (value: unknown) => value
    },
    '@renderer/composables/useDownloader': {
      useDownloader: () => ({
        downloads,
        importSong: async (request: object) => {
          requests.push(request)
          return { status: 'completed' }
        }
      })
    },
    '@renderer/composables/useSongs': { accessSongs: () => ({ songs }) },
    '@renderer/composables/useSound': {
      useSound: () => ({ play: (name: string) => sounds.push(name) })
    },
    '@renderer/assets/cover-fallback.png': 'fixture-cover',
    '@shared/captionTracks': captionTracks,
    './Popup.vue': {}
  }).default as {
    setup: (
      props: object,
      context: object
    ) => {
      title: {
        value: string
      }
      artist: {
        value: string
      }
      captionTrackId: {
        value: string
      }
      canDownload: {
        value: unknown
      }
      downloading: {
        value: boolean
      }
      confirm: () => Promise<void>
    }
  }
  const scope = effectScope()
  context.after(() => scope.stop())
  const props = reactive({ video })
  const state = scope.run(() =>
    component.setup(props, {
      expose: () => {},
      emit: (name: string, value: unknown) => events.push({ name, value })
    })
  )!
  for (const [input, artist, title] of [
    ['Kesha - TikTok (Official Video)', 'Kesha', 'TikTok'],
    ['Kesha (VEVO) - TikTok [Lyrics]', 'Kesha', 'TikTok'],
    ['Jay-Z - Song - Live (Official Video)', 'Jay-Z', 'Song - Live'],
    ['  Kesha   -  TikTok  (Official Video) ', 'Kesha', 'TikTok'],
    ['Kesha \u2013 TikTok [Lyrics]', 'Kesha', 'TikTok'],
    ['Kesha \u2014 TikTok (Lyrics)', 'Kesha', 'TikTok'],
    ['Song (Official Video)', 'Fixture artist', 'Song'],
    ['Fixture title', 'Fixture artist', 'Fixture title'],
    ['(Intro)', 'Fixture artist', '(Intro)']
  ]) {
    props.video = { ...video, title: input }
    await nextTick()
    assert.equal(state.artist.value, artist, input)
    assert.equal(state.title.value, title, input)
  }
  props.video = { ...video, tracks: [video.tracks[1], video.tracks[0]] }
  await nextTick()
  assert.equal(state.captionTrackId.value, 'creator-en')
  props.video = { ...video, tracks: [video.tracks[1]] }
  await nextTick()
  assert.equal(state.captionTrackId.value, 'auto-de')
  props.video = {
    ...video,
    tracks: [video.tracks[0], Object.assign({ ...video.tracks[1] }, { isDefault: true })]
  }
  await nextTick()
  assert.equal(state.captionTrackId.value, 'auto-de')
  const mainManualTrack = {
    ...video.tracks[0],
    id: 'creator-fr',
    language: 'fr',
    name: 'French',
    isDefault: true
  }
  props.video = { ...video, tracks: [...video.tracks, mainManualTrack] }
  await nextTick()
  assert.equal(state.captionTrackId.value, 'creator-fr')
  props.video = video
  await nextTick()
  assert.equal(state.captionTrackId.value, 'creator-en')
  state.title.value = ' '
  assert.equal(Boolean(state.canDownload.value), false)
  await state.confirm()
  assert.equal(requests.length, 0)
  state.title.value = 'Edited title'
  state.artist.value = 'Edited artist'
  state.captionTrackId.value = 'auto-de'
  downloads.value = [{ candidate: video, status: 'downloading', progress: 0.5 }]
  assert.equal(state.downloading.value, true)
  await state.confirm()
  assert.equal(requests.length, 0)
  downloads.value = [{ candidate: video, status: 'error', progress: 0, error: 'Try again' }]
  await state.confirm()
  assert.equal(requests.length, 1)
  assert.equal(
    (
      requests[0] as {
        captionTrackId: string
      }
    ).captionTrackId,
    'auto-de'
  )
  assert.equal(
    (
      requests[0] as {
        title: string
      }
    ).title,
    'Edited title'
  )
  assert.deepEqual(sounds, ['downloadSuccess'])
  const song = { source: { provider: 'youtube', id: video.id }, title: 'Edited title' }
  songs.value = [song]
  await state.confirm()
  assert.equal(requests.length, 1)
  assert.equal(events.at(-1)?.name, 'play')
  assert.equal((events.at(-1)?.value as typeof song).title, song.title)
  songs.value = []
  props.video = { ...video, id: 'lyrics-video', lyricsInVideo: true, tracks: [] }
  await nextTick()
  assert.equal(state.captionTrackId.value, '')
  assert.equal(Boolean(state.canDownload.value), true)
  await state.confirm()
  assert.equal(requests.length, 2)
  assert.equal(
    (
      requests[1] as {
        lyricsInVideo: boolean
      }
    ).lyricsInVideo,
    true
  )
  assert.equal(Object.hasOwn(requests[1], 'captionTrackId'), false)
  assert.equal(
    (
      requests[1] as {
        candidate: typeof video
      }
    ).candidate.lyricsInVideo,
    true
  )
  state.title.value = ' '
  await state.confirm()
  assert.equal(requests.length, 2)
  props.video = { ...video, tracks: [] }
  await nextTick()
  assert.equal(state.captionTrackId.value, '')
  assert.equal(Boolean(state.canDownload.value), false)
  assert.match(descriptor.template!.content, /<Teleport to="body">/)
  assert.match(descriptor.template!.content, /v-if="candidate.tracks.length"/)
  assert.match(
    descriptor.template!.content,
    /:okProgress="downloading \? \(state\?\.progress \?\? 0\) : undefined"/
  )
  assert.match(
    descriptor.template!.content,
    /Downloading \$\{Math.floor\(\(state\?\.progress \?\? 0\) \* 100\)\}%/
  )
  assert.match(descriptor.template!.content, /:okIcon="\s*localSong \? 'fa-play'/)
  assert.match(descriptor.template!.content, /cancelIcon="io-close-sharp"/)
  assert.doesNotMatch(descriptor.template!.content, /<progress\b|downloadProgress/)
  assert.match(descriptor.template!.content, /<Popup[\s\S]*@ok="confirm"/)
  assert.match(descriptor.template!.content, /@cancel="emit\('close'\)"/)
  assert.match(descriptor.template!.content, /:okDisabled="!localSong && !canDownload"/)
  const search = await readFile(
    new URL('../src/renderer/src/pages/SongSearch.vue', import.meta.url),
    'utf8'
  )
  assert.equal(search.match(/<YoutubeImport\b/g)?.length, 1)
  assert.doesNotMatch(search, /captionDetails|closeDetails/)
  assert.match(search, /@close="selectedYoutube = null"/)
})

test('video-embedded lyrics playback omits the karaoke captions layer', async () => {
  const source = await readFile(
    new URL('../src/renderer/src/pages/SongPlayer.vue', import.meta.url),
    'utf8'
  )
  const { descriptor } = parse(source)
  assert.match(
    descriptor.template!.content,
    /<SimpleKaraokeLyrics v-if="player.currentSong.value\?\.lyricsTiming !== 'video'"/
  )
})

test('standard popup displays optional button icons and progress, blocks disabled confirmation but allows closing', async (context) => {
  const source = await readFile(
    new URL('../src/renderer/src/components/Popup.vue', import.meta.url),
    'utf8'
  )
  const { descriptor } = parse(source)
  const script = compileScript(descriptor, { id: 'popup-disabled-test' })
  const props = reactive({
    visible: true,
    title: 'Download',
    okDisabled: true,
    cancelDisabled: false,
    okProgress: undefined as number | undefined
  })
  const events: string[] = []
  const sounds: string[] = []
  const component = loadTestModule(script.content, {
    vue: {
      computed,
      ref,
      watch,
      onUnmounted: () => {},
      useCssModule: () => ({}),
      defineComponent: (value: unknown) => value
    },
    gsap: {},
    '@renderer/composables/useDialogFocus': { useDialogFocus: () => ({ trapFocus: () => {} }) },
    '@renderer/composables/useSound': {
      useSound: () => ({ play: (name: string) => sounds.push(name) })
    }
  }).default as {
    setup: (
      props: object,
      context: object
    ) => {
      onOk: () => void
      onCancel: () => void
      progress: {
        value: number | undefined
      }
    }
  }
  const scope = effectScope()
  context.after(() => scope.stop())
  const state = scope.run(() =>
    component.setup(props, {
      expose: () => {},
      emit: (name: string) => events.push(name)
    })
  )!
  assert.equal(state.progress.value, undefined)
  for (const [input, expected] of [
    [0, 0],
    [0.5, 0.5],
    [1, 1],
    [-0.2, 0],
    [1.2, 1]
  ]) {
    props.okProgress = input
    assert.equal(state.progress.value, expected)
  }
  props.okProgress = undefined
  assert.equal(state.progress.value, undefined)
  assert.match(descriptor.template!.content, /v-if="progress !== undefined"/)
  assert.match(descriptor.template!.content, /width: `\$\{progress \* 100\}%`/)
  assert.match(descriptor.template!.content, /:aria-busy="progress !== undefined"/)
  assert.match(descriptor.template!.content, /v-if="props.okIcon" :name="props.okIcon"/)
  assert.match(descriptor.template!.content, /v-if="props.cancelIcon" :name="props.cancelIcon"/)
  state.onOk()
  assert.deepEqual(events, [])
  assert.deepEqual(sounds, [])
  state.onCancel()
  assert.deepEqual(events, ['cancel'])
  props.cancelDisabled = true
  state.onCancel()
  assert.deepEqual(events, ['cancel'])
  props.cancelDisabled = false
  props.okDisabled = false
  state.onOk()
  assert.deepEqual(events, ['cancel', 'ok'])
})
