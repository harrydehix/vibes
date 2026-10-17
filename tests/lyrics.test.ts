import './setup-dom.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { compileStyleAsync, parse } from '@vue/compiler-sfc'
import { onKeyStroke } from '@vueuse/core'
import * as vue from 'vue'
import { addIcons, OhVueIcon } from 'oh-vue-icons'
import { MdMusicnote } from 'oh-vue-icons/icons/md/index.js'
import type { Line } from '../src/shared/types.ts'
import { getLyricsRows, getSingingPauses } from '../src/renderer/src/utils/singingPauses.ts'
import { loadVueComponent } from './helpers.ts'

function line(startTimeMs: number, endTimeMs: number, text = 'Lyrics'): Line {
  return {
    startTimeMs,
    endTimeMs,
    syllables: [{ text, startTimeMs, endTimeMs }]
  }
}

test('singing pauses include the intro and gaps longer than three seconds, but not the outro', () => {
  assert.deepEqual(getSingingPauses([line(5000, 6000), line(10000, 11000)]), [
    { startTimeMs: 0, endTimeMs: 5000 },
    { startTimeMs: 6000, endTimeMs: 10000 }
  ])
  assert.deepEqual(getSingingPauses([line(3000, 4000), line(7000, 8000)]), [])
  assert.deepEqual(getSingingPauses([line(3001, 4000)]), [{ startTimeMs: 0, endTimeMs: 3001 }])
  assert.deepEqual(getSingingPauses([]), [])
})

test('singing pauses follow syllables within a phrase rather than its trailing boundary', () => {
  const phrase = line(0, 15000)
  phrase.syllables = [line(0, 1000).syllables[0], line(7000, 8000).syllables[0]]
  assert.deepEqual(getSingingPauses([phrase, line(12000, 13000)]), [
    { startTimeMs: 1000, endTimeMs: 7000 },
    { startTimeMs: 8000, endTimeMs: 12000 }
  ])
})

test('singing pauses merge overlapping vocals, ignore invalid cues and leave original lyrics unchanged', () => {
  const lines = [
    line(500, 8000),
    line(0, 1000),
    line(10000, 10500),
    line(14500, 15500),
    line(12000, 13000, ' '),
    line(NaN, 14000),
    line(11000, Infinity),
    line(10000, 9000)
  ]
  const original = structuredClone(lines)
  assert.deepEqual(getSingingPauses(lines), [{ startTimeMs: 10500, endTimeMs: 14500 }])
  assert.deepEqual(lines, original)
  assert.deepEqual(getSingingPauses([line(-1000, 1000), line(5000, 6000)]), [
    { startTimeMs: 1000, endTimeMs: 5000 }
  ])
})

test('lyrics rows put intro and instrumental pauses directly before the next visible lyrics', () => {
  const lines = [line(5000, 6000, 'First line'), line(10000, 11000, 'Next line')]
  const original = structuredClone(lines)
  const rows = getLyricsRows(lines)
  assert.deepEqual(
    rows.map((row) => row.kind),
    ['pause', 'lyrics', 'pause', 'lyrics']
  )
  assert.deepEqual(
    rows.map((row) => row.startTimeMs),
    [0, 5000, 6000, 10000]
  )
  assert.deepEqual(
    rows.map((row) => row.syllables.map((syllable) => syllable.text).join('')),
    ['', 'First line', '', 'Next line']
  )
  assert.deepEqual(lines, original)
})

test('lyrics rows split long pauses inside a phrase without losing or retiming syllables', () => {
  const phrase = line(0, 15000)
  phrase.syllables = [line(0, 1000, 'Before').syllables[0], line(7000, 8000, 'After').syllables[0]]
  const original = structuredClone(phrase)
  const rows = getLyricsRows([phrase, line(12000, 13000, 'Next')])
  assert.deepEqual(
    rows.map((row) => [row.kind, row.startTimeMs, row.endTimeMs]),
    [
      ['lyrics', 0, 1000],
      ['pause', 1000, 7000],
      ['lyrics', 7000, 8000],
      ['pause', 8000, 12000],
      ['lyrics', 12000, 13000]
    ]
  )
  assert.deepEqual(
    rows.filter((row) => row.kind === 'lyrics').flatMap((row) => row.syllables),
    [...phrase.syllables, line(12000, 13000, 'Next').syllables[0]]
  )
  assert.deepEqual(phrase, original)
  assert.deepEqual(getLyricsRows([]), [])
})

for (const timing of ['phrase', 'syllable'] as const) {
  test(`rendered ${timing} lyrics show a filling pause cue synchronized with playback, seeking and offsets`, async (context) => {
    const lyrics = [line(5000, 6000, 'First line'), line(10000, 11000, 'Next line')]
    lyrics[1].syllables[0].isGolden = true
    const currentSong = vue.ref({ index: 0, lyricsTiming: timing, lines: { P1: lyrics, P2: [] } })
    const settings = vue.ref<{
      syncOffsetMs: number
      lyricsFontScale: number
      lyricsAlignment?: 'left' | 'center'
      lowPerformanceMode?: boolean
    }>({ syncOffsetMs: 0, lyricsFontScale: 1 })
    let currentTime = 0
    const songOffsetPreviewMs = vue.ref<number | null>(null)
    const callbacks = new Set<() => void>()
    const highlighted: HTMLElement[] = []
    const scrollPositions: number[] = []
    const animations: { killed: boolean }[] = []
    const source = await readFile(
      new URL('../src/renderer/src/components/SimpleKaraokeLyrics.vue', import.meta.url),
      'utf8'
    )
    const { descriptor } = parse(source)
    const compiledStyles = await compileStyleAsync({
      source: descriptor.styles[0].content,
      filename: 'SimpleKaraokeLyrics.vue',
      id: 'lyrics-state-test',
      preprocessLang: 'less'
    })
    assert.deepEqual(compiledStyles.errors, [])
    const stylesheet = document.createElement('style')
    stylesheet.textContent = compiledStyles.code
    document.head.append(stylesheet)
    context.after(() => stylesheet.remove())
    const component = loadVueComponent(
      source,
      {
        vue,
        '@renderer/utils/singingPauses': { getLyricsRows },
        '@renderer/composables/useSettings': { accessSettings: () => ({ settings }) },
        '@renderer/composables/useSongPlayer': {
          accessSongPlayer: () => ({
            currentSong,
            songOffsetPreviewMs,
            video: vue.ref({}),
            isPlaying: vue.ref(true),
            isUsingVideo: vue.ref(true),
            getCurrentTime: () => currentTime
          })
        },
        gsap: {
          gsap: {
            ticker: {
              add: (callback: () => void) => callbacks.add(callback),
              remove: (callback: () => void) => callbacks.delete(callback)
            },
            to: (element: HTMLElement, options: { y?: number; opacity?: number }) => {
              if (options.y !== undefined) scrollPositions.push(options.y)
              if (options.opacity !== undefined) element.style.opacity = String(options.opacity)
            },
            set: (elements: HTMLElement[]) => {
              for (const element of elements) {
                element.style.removeProperty('opacity')
                element.style.removeProperty('transform')
              }
            },
            timeline: () => {
              const animation = { killed: false }
              animations.push(animation)
              return {
                to: (element: HTMLElement, options: { opacity?: number; scale?: number }) => {
                  highlighted.push(element)
                  if (options.opacity !== undefined) element.style.opacity = String(options.opacity)
                  if (options.scale !== undefined)
                    element.style.transform = `scale(${options.scale})`
                },
                play: () => undefined,
                kill: () => {
                  animation.killed = true
                }
              }
            }
          }
        }
      },
      { window, console: { log: () => undefined } }
    )
    const host = document.createElement('div')
    document.body.append(host)
    addIcons(MdMusicnote)
    const app = vue.createApp(component)
    app.component('VIcon', OhVueIcon)
    app.mount(host)
    context.after(async () => {
      app.unmount()
      await vue.nextTick()
      host.remove()
      assert.equal(callbacks.size, 0)
    })
    await vue.nextTick()
    await vue.nextTick()
    const tick = async (time: number): Promise<void> => {
      currentTime = time
      for (const callback of callbacks) callback()
      await vue.nextTick()
    }
    const indicator = (): HTMLElement | null =>
      host.querySelector<HTMLElement>('[role="progressbar"][data-active="true"]')
    const progress = (): number => Number(indicator()?.getAttribute('aria-valuenow'))
    const track = host.querySelector<HTMLElement>('.track')!
    if (timing === 'syllable') {
      const golden = track.querySelector<HTMLElement>('.golden')!
      assert.equal(golden.textContent, 'Next line')
      assert.equal(track.querySelectorAll('.golden').length, 1)
      assert.equal(golden.classList.contains('glitter'), true)
      assert.equal(window.getComputedStyle(golden).animationPlayState, 'paused')
      assert.match(window.getComputedStyle(golden).backgroundImage, /radial-gradient/)
      assert.equal(window.getComputedStyle(golden).backgroundClip, 'text')
      settings.value.lowPerformanceMode = true
      await vue.nextTick()
      assert.equal(golden.classList.contains('glitter'), false)
      assert.match(window.getComputedStyle(golden).color, /^(#f5cb66|rgb\(245, 203, 102\))$/)
      settings.value.lowPerformanceMode = false
      await vue.nextTick()
    }
    assert.equal(track.classList.contains('centered'), false)
    settings.value.lyricsAlignment = 'center'
    await vue.nextTick()
    assert.equal(track.classList.contains('centered'), true)
    settings.value.lyricsAlignment = 'left'
    await vue.nextTick()
    assert.equal(track.classList.contains('centered'), false)
    Object.defineProperty(host.querySelector('.lyricsContainer'), 'clientHeight', { value: 600 })
    let top = 0
    for (const element of Array.from(track.children)) {
      const height = element.matches('.pauseCue') ? 88 : 48
      Object.defineProperties(element, {
        offsetTop: { value: top },
        clientHeight: { value: height }
      })
      top += height + 32
    }
    await tick(0)
    assert.equal(progress(), 0)
    assert.equal(track.style.visibility, '')
    assert.equal(indicator()!.parentElement, track)
    assert.equal(indicator()!.nextElementSibling!.textContent, 'First line')
    assert.ok(indicator()!.querySelector('.pauseBackground'))
    assert.equal(scrollPositions.at(-1), 256)
    assert.equal(indicator()!.querySelectorAll('svg').length, 2)
    await tick(2.5)
    assert.equal(progress(), 50)
    assert.equal(indicator()!.style.getPropertyValue('--pause-fill'), '50%')
    songOffsetPreviewMs.value = 1000
    await tick(2.5)
    assert.equal(progress(), 30)
    settings.value.syncOffsetMs = -500
    await tick(2.5)
    assert.equal(progress(), 40)
    assert.equal(currentSong.value.lines.P1[0].startTimeMs, 5000)
    songOffsetPreviewMs.value = null
    settings.value.syncOffsetMs = 0
    await tick(2.5)
    assert.equal(progress(), 50)
    await tick(1)
    assert.equal(progress(), 20)
    settings.value.syncOffsetMs = -1000
    await tick(1)
    assert.equal(progress(), 40)
    settings.value.syncOffsetMs = 0
    await tick(5)
    assert.equal(indicator(), null)
    assert.equal(track.style.visibility, '')
    assert.equal(scrollPositions.at(-1), 156)
    await tick(7)
    assert.equal(progress(), 25)
    assert.equal(indicator()!.nextElementSibling!.textContent, 'Next line')
    assert.equal(scrollPositions.at(-1), 56)
    const activePause = indicator()!
    assert.equal(window.getComputedStyle(activePause).opacity, '1')
    settings.value.lyricsFontScale = 1.2
    await vue.nextTick()
    await vue.nextTick()
    await vue.nextTick()
    assert.equal(indicator(), activePause)
    assert.equal(window.getComputedStyle(activePause).opacity, '1')
    assert.equal(scrollPositions.at(-1), 56)
    assert.equal(activePause.style.getPropertyValue('--pause-fill'), '25%')
    await tick(10)
    assert.equal(indicator(), null)
    assert.equal(scrollPositions.at(-1), -44)
    if (timing === 'syllable') {
      assert.equal(highlighted.at(-1)?.textContent, 'Next line')
      assert.equal(
        window.getComputedStyle(track.querySelector('.golden')!).animationPlayState,
        'running'
      )
    }
    await tick(12)
    assert.equal(indicator(), null)
    const previousAnimations = animations.slice()
    await tick(0)
    assert.equal(progress(), 0)
    assert.equal(window.getComputedStyle(indicator()!).opacity, '1')
    if (timing === 'syllable') {
      assert.equal(
        window.getComputedStyle(track.querySelector('.golden')!).animationPlayState,
        'paused'
      )
    }
    assert.ok(previousAnimations.every((animation) => animation.killed))
    for (const span of track.querySelectorAll('span')) {
      assert.equal(span.style.opacity, '')
      assert.equal(span.style.transform, '')
      if (timing === 'syllable') assert.equal(window.getComputedStyle(span).opacity, '0.5')
    }
    await tick(7)
    assert.equal(progress(), 25)
    assert.equal(window.getComputedStyle(indicator()!).opacity, '1')
    await tick(10)
    if (timing === 'syllable') assert.equal(highlighted.at(-1)?.textContent, 'Next line')
    const phrase = line(0, 15000)
    phrase.syllables = [
      line(0, 1000, 'Before').syllables[0],
      line(7000, 8000, 'After').syllables[0]
    ]
    currentSong.value = { ...currentSong.value, lines: { P1: [phrase], P2: [] } }
    await tick(3)
    assert.equal(indicator()!.nextElementSibling!.textContent, 'After')
    await tick(7)
    assert.equal(indicator(), null)
    if (timing === 'syllable') assert.equal(highlighted.at(-1)?.textContent, 'After')
    await tick(0)
    const upcomingSpan = Array.from(track.querySelectorAll('span')).find(
      (span) => span.textContent === 'After'
    )!
    assert.equal(upcomingSpan.style.opacity, '')
    assert.equal(upcomingSpan.style.transform, '')
    if (timing === 'syllable') {
      assert.equal(window.getComputedStyle(upcomingSpan).opacity, '0.5')
      assert.equal(highlighted.at(-1)?.textContent, 'Before')
    }
    await tick(7)
    if (timing === 'syllable') assert.equal(highlighted.at(-1)?.textContent, 'After')
    currentSong.value = {
      ...currentSong.value,
      lines: { P1: [line(0, 1000), line(3000, 4000)], P2: [] }
    }
    await tick(2)
    assert.equal(indicator(), null)
  })
}

test('F opens a nonmodal live song-offset editor; Apply saves and Escape closes without pausing', async (context) => {
  const currentSong = vue.ref({
    index: 0,
    lyricsTiming: 'phrase',
    fixOffsetMs: 50,
    meta: { id: 'song', fixOffsetMs: 50 },
    lines: { P1: [line(1050, 2050)], P2: [] }
  })
  const settings = vue.ref({ syncOffsetMs: 200, highContrastMode: false })
  const songOffsetPreviewMs = vue.ref<number | null>(null)
  const saved: number[] = []
  let saveAttempts = 0
  let refreshCalls = 0
  let failSave = false
  let pauseCalls = 0
  let playCalls = 0
  const isPlaying = vue.ref(true)
  const player = {
    currentSong,
    songOffsetPreviewMs,
    currentIndex: vue.ref(0),
    video: vue.ref(null),
    isLoaded: vue.ref(false),
    ended: vue.ref(false),
    isPlaying,
    pausedByUser: vue.computed(() => !isPlaying.value),
    pause: () => {
      pauseCalls++
      isPlaying.value = false
    },
    play: () => {
      playCalls++
      isPlaying.value = true
    }
  }
  const songs = {
    updateSong: async (_id: string, patch: { fixOffsetMs: number }) => {
      saveAttempts++
      if (failSave) throw new Error('Private disk diagnostic')
      saved.push(patch.fixOffsetMs)
    },
    getSongs: async () => {
      refreshCalls++
      const value = saved.at(-1)!
      currentSong.value = {
        ...currentSong.value,
        fixOffsetMs: value,
        meta: { ...currentSong.value.meta, fixOffsetMs: value }
      }
    }
  }
  const modules = {
    vue,
    '@vueuse/core': { onKeyStroke },
    '@renderer/composables/useSongPlayer': {
      accessSongPlayer: () => player,
      useSongPlayer: () => player
    },
    '@renderer/composables/useSongManagement': { accessSongManagement: () => songs },
    '@renderer/composables/useSettings': { accessSettings: () => ({ settings }) },
    '@renderer/composables/useController': {
      accessController: () => ({ controller: vue.ref(null) })
    },
    'vue-router': { useRoute: () => ({ query: {} }) },
    '@renderer/router': { default: { push: () => undefined } },
    gsap: { default: {} }
  }
  const editor = loadVueComponent(
    await readFile(
      new URL('../src/renderer/src/components/SongOffsetEditor.vue', import.meta.url),
      'utf8'
    ),
    modules,
    { document, HTMLElement }
  )
  const emptyComponent = { default: { render: () => null } }
  const component = loadVueComponent(
    await readFile(new URL('../src/renderer/src/pages/SongPlayer.vue', import.meta.url), 'utf8'),
    {
      ...modules,
      '@renderer/components/SongOffsetEditor.vue': { default: editor },
      '@renderer/components/PlayerPauseMenu.vue': emptyComponent,
      '@renderer/components/SimpleKaraokeLyrics.vue': emptyComponent
    },
    { console: { log: () => undefined } }
  )
  const host = document.createElement('div')
  document.body.append(host)
  const app = vue.createApp(component)
  app.component('VIcon', { render: () => vue.h('svg') })
  app.mount(host)
  context.after(async () => {
    app.unmount()
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(refreshCalls, 1)
    assert.equal(currentSong.value.fixOffsetMs, -75)
    host.remove()
  })
  const key = async (target: EventTarget, value: string, repeat = false): Promise<void> => {
    target.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: value, repeat, bubbles: true, cancelable: true })
    )
    await vue.nextTick()
    await vue.nextTick()
  }
  assert.equal(host.querySelector('form'), null)
  await key(window, 'f', true)
  assert.equal(host.querySelector('form'), null)
  await key(window, 'F')
  let form = host.querySelector<HTMLFormElement>('form')!
  let input = form.querySelector<HTMLInputElement>('input')!
  const apply = form.querySelector<HTMLButtonElement>('button[type="submit"]')!
  assert.equal(document.activeElement, input)
  assert.equal(input.value, '50')
  assert.equal(form.getAttribute('aria-modal'), null)
  assert.equal(pauseCalls, 0)
  assert.equal(playCalls, 0)
  const enter = async (value: string): Promise<void> => {
    input.value = value
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await vue.nextTick()
  }
  const submit = async (): Promise<void> => {
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await new Promise<void>((resolve) => setImmediate(resolve))
    await vue.nextTick()
  }
  await enter('125.5')
  assert.equal(songOffsetPreviewMs.value, 125.5)
  assert.equal(currentSong.value.fixOffsetMs, 50)
  assert.equal(saved.length, 0)
  await enter('')
  assert.equal(songOffsetPreviewMs.value, 125.5)
  assert.equal(apply.disabled, true)
  await submit()
  assert.equal(saved.length, 0)
  await enter('not-a-number')
  assert.equal(songOffsetPreviewMs.value, 125.5)
  assert.equal(apply.disabled, true)
  await enter('-75')
  await key(input, 'ArrowUp')
  await key(input, 'ArrowDown')
  await key(input, 'c')
  assert.equal(settings.value.syncOffsetMs, 200)
  assert.equal(settings.value.highContrastMode, false)
  assert.equal(songOffsetPreviewMs.value, -75)
  await submit()
  assert.deepEqual(saved, [-75])
  assert.equal(currentSong.value.meta.fixOffsetMs, 50)
  assert.equal(currentSong.value.fixOffsetMs, 50)
  assert.equal(songOffsetPreviewMs.value, -75)
  assert.equal(host.querySelector('form'), null)
  assert.equal(refreshCalls, 0)
  await key(window, 'f')
  form = host.querySelector<HTMLFormElement>('form')!
  input = form.querySelector<HTMLInputElement>('input')!
  assert.equal(input.value, '-75')
  await enter('300')
  failSave = true
  await submit()
  assert.equal(saveAttempts, 2, form.outerHTML)
  assert.ok(form.querySelector('[role="alert"]'), form.outerHTML)
  assert.match(form.querySelector('[role="alert"]')!.textContent!, /Could not save/)
  assert.doesNotMatch(form.textContent!, /Private/)
  assert.equal(songOffsetPreviewMs.value, 300)
  await key(input, 'Escape')
  assert.equal(host.querySelector('form'), null)
  assert.equal(songOffsetPreviewMs.value, -75)
  assert.equal(currentSong.value.fixOffsetMs, 50)
  assert.equal(refreshCalls, 0)
  assert.equal(pauseCalls, 0)
  assert.equal(playCalls, 0)
  await key(window, 'f')
  assert.equal(host.querySelector<HTMLInputElement>('input')!.value, '-75')
  await key(host.querySelector('input')!, 'Escape')
  await key(window, 'ArrowUp')
  assert.equal(settings.value.syncOffsetMs, 225)
  await key(window, 'Escape')
  assert.equal(pauseCalls, 1)
})

for (const scenario of [
  'untouched',
  'failed',
  'pending',
  'pending-after-save',
  'failed-after-save'
] as const) {
  test(`song offsets refresh only after unmount and successful persistence: ${scenario}`, async (context) => {
    const preview = vue.ref<number | null>(null)
    const player = {
      currentSong: vue.ref({ fixOffsetMs: 0, meta: { id: 'song' } }),
      pausedByUser: vue.ref(false),
      songOffsetPreviewMs: preview
    }
    let refreshCalls = 0
    let saveCalls = 0
    let finishSave: () => void = () => undefined
    const pendingSave = new Promise<void>((resolve, reject) => {
      finishSave =
        scenario === 'failed-after-save' ? () => reject(new Error('Disk write failed')) : resolve
    })
    const songs = {
      updateSong: async () => {
        saveCalls++
        if (scenario === 'failed') throw new Error('Disk write failed')
        if (scenario.endsWith('after-save') && saveCalls === 1) return
        await pendingSave
      },
      getSongs: async () => {
        refreshCalls++
      }
    }
    const component = loadVueComponent(
      await readFile(
        new URL('../src/renderer/src/components/SongOffsetEditor.vue', import.meta.url),
        'utf8'
      ),
      {
        vue,
        '@vueuse/core': { onKeyStroke },
        '@renderer/composables/useSongPlayer': { accessSongPlayer: () => player },
        '@renderer/composables/useSongManagement': { accessSongManagement: () => songs }
      },
      { document, HTMLElement, console: { error: () => undefined } }
    )
    const host = document.createElement('div')
    document.body.append(host)
    const app = vue.createApp(component)
    app.component('VIcon', { render: () => vue.h('svg') })
    app.mount(host)
    let unmounted = false
    context.after(() => {
      if (!unmounted) app.unmount()
      host.remove()
    })
    const open = async (): Promise<void> => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'f', cancelable: true }))
      await vue.nextTick()
      await vue.nextTick()
    }
    const submit = (): void => {
      host.querySelector('form')!.dispatchEvent(new window.Event('submit', { cancelable: true }))
    }
    const settle = async (): Promise<void> => {
      await new Promise<void>((resolve) => setImmediate(resolve))
      await vue.nextTick()
    }
    await open()
    if (scenario.endsWith('after-save')) {
      submit()
      await settle()
      assert.equal(host.querySelector('form'), null)
      assert.equal(refreshCalls, 0)
      await open()
    }
    if (scenario !== 'untouched') {
      submit()
      await settle()
      if (scenario === 'failed') assert.ok(host.querySelector('[role="alert"]'))
    }
    assert.equal(refreshCalls, 0)
    app.unmount()
    unmounted = true
    assert.equal(preview.value, null)
    assert.equal(refreshCalls, 0)
    if (scenario.includes('pending') || scenario === 'failed-after-save') finishSave()
    await settle()
    assert.equal(refreshCalls, scenario === 'untouched' || scenario === 'failed' ? 0 : 1)
  })
}
