import assert from 'node:assert/strict'
import { test } from 'node:test'
import path from 'node:path'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { loadTestModule } from './helpers.ts'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { Effect } from 'effect'
import { compileScript, parse } from '@vue/compiler-sfc'
import { computed, effectScope, nextTick, reactive, ref, watch } from 'vue'
import {
  parseYoutubeCookies,
  requiresYoutubeAuthentication
} from '../src/main/song-import/youtubeCookies.ts'
import * as downloadErrors from '../src/shared/errors.ts'
import type { YoutubeAuthStatus } from '../src/shared/types.ts'
import { createFfmpegFixture, createYoutubeAuthFixture } from './fixtures.ts'

test('startup installs and verifies app-managed FFmpeg and FFprobe when they are missing', async (context) => {
  const { manager, folder } = await createFfmpegFixture(context)
  await manager.init()
  assert.equal(manager.verified, true)
  assert.equal(await readFile(manager.binPath, 'utf8'), 'ffmpeg version fixture')
  assert.equal(await readFile(manager.probePath, 'utf8'), 'ffprobe version fixture')
  assert.equal(manager.binDir, path.join(folder, 'ffmpeg'))
  assert.equal(
    (await readdir(folder)).some((name) => name.startsWith('.ffmpeg-install-')),
    false
  )
})

test('startup reuses healthy managed binaries without reinstalling them', async (context) => {
  const { manager, checks } = await createFfmpegFixture(context)
  await mkdir(manager.binDir)
  await writeFile(manager.binPath, 'ffmpeg version fixture')
  await writeFile(manager.probePath, 'ffprobe version fixture')
  await manager.init()
  assert.equal(manager.verified, true)
  assert.deepEqual(checks.sort(), [manager.binPath, manager.probePath].sort())
})

test('startup repairs damaged managed binaries', async (context) => {
  const { manager } = await createFfmpegFixture(context)
  await mkdir(manager.binDir)
  await writeFile(manager.binPath, 'damaged executable')
  await writeFile(manager.probePath, 'ffprobe version fixture')
  await manager.init()
  assert.equal(manager.verified, true)
  assert.equal(await readFile(manager.binPath, 'utf8'), 'ffmpeg version fixture')
})

test('failed FFmpeg installation is not marked verified and cleans up its staging files', async (context) => {
  const { manager, sources, folder } = await createFfmpegFixture(context)
  await writeFile(sources.ffprobe, 'damaged bundled executable')
  await assert.rejects(manager.init(), /could not be verified/)
  assert.equal(manager.verified, false)
  assert.equal(existsSync(manager.binPath), false)
  assert.equal(
    (await readdir(folder)).some((name) => name.startsWith('.ffmpeg-install-')),
    false
  )
})

test('both YouTube download paths accept separate streams and produce an MP4 via the yt-dlp preset', async () => {
  const source = await readFile(
    new URL('../src/main/ultrastar-download/youtube/download.ts', import.meta.url),
    'utf8'
  )
  const calls: string[][] = []
  const downloader = loadTestModule(source, {
    'node:child_process': {
      spawn: (_bin: string, args: string[]) => {
        calls.push(args)
        const child = Object.assign(new EventEmitter(), {
          stdout: new PassThrough(),
          stderr: new PassThrough()
        })
        queueMicrotask(() => child.emit('close', 0))
        return child
      }
    },
    '../../ipc/ytdlp': { ytDlpManager: { binPath: 'fixture-yt-dlp' } },
    '../../ipc/ffmpeg': {
      ffmpegManager: { verified: true, binDir: path.resolve('managed-ffmpeg') }
    },
    '../../ipc/youtubeAuth': {
      youtubeAuthManager: {
        withCookies: (operation: (args: string[]) => Promise<void>) => operation([])
      }
    }
  }) as {
    downloadYoutubeVideo: (url: string, filename: string) => Effect.Effect<void, Error>
    downloadYoutubeVideoWithProgress: (
      url: string,
      filename: string,
      onProgress: (progress: { percent: number }) => void
    ) => Effect.Effect<void, Error>
  }
  const filename = path.resolve('test-song', 'video.mp4')
  const url = 'https://www.youtube.com/watch?v=BaW_jenozKc'
  await Effect.runPromise(downloader.downloadYoutubeVideo(url, filename))
  const progress: number[] = []
  await Effect.runPromise(
    downloader.downloadYoutubeVideoWithProgress(url, filename, (update) =>
      progress.push(update.percent)
    )
  )
  assert.equal(calls.length, 2)
  for (const args of calls) {
    assert.equal(args[args.indexOf('--format') + 1], 'bv*+ba/b')
    assert.equal(args[args.indexOf('--preset-alias') + 1], 'mp4')
    assert.equal(args[args.indexOf('--ffmpeg-location') + 1], path.resolve('managed-ffmpeg'))
    assert.equal(args[args.indexOf('-o') + 1], path.resolve('test-song', 'video.%(ext)s'))
    assert.ok(args.includes('--ignore-config'))
    assert.equal(args.at(-2), '--')
    assert.equal(args.at(-1), url)
  }
  assert.deepEqual(progress, [1])
})

test('YouTube sessions are verified, stored encrypted and restored without retaining temporary cookies', async (context) => {
  const fixture = await createYoutubeAuthFixture(context)
  assert.equal((await fixture.manager.getStatus()).authenticated, false)
  assert.equal((await fixture.importCookies()).authenticated, true)
  assert.doesNotMatch(
    await readFile(fixture.sessionPath, 'utf8'),
    /fixture-session|unrelated-fixture/
  )
  assert.equal((await fixture.restart().getStatus()).authenticated, true)
  let requestCookiePath = ''
  const result = await fixture.manager.withCookies(async (args) => {
    assert.equal(args[0], '--cookies')
    requestCookiePath = args[1]
    assert.match(await readFile(requestCookiePath, 'utf8'), /fixture-session/)
    return 'downloaded'
  })
  assert.equal(result, 'downloaded')
  for (const filename of [...fixture.temporaryFiles, requestCookiePath]) {
    await assert.rejects(readFile(filename), { code: 'ENOENT' })
  }
})

test('YouTube requests run anonymously when no session is configured', async (context) => {
  const fixture = await createYoutubeAuthFixture(context)
  const result = await fixture.manager.withCookies(async (args) => {
    assert.equal(args.length, 0)
    return 'anonymous-download'
  })
  assert.equal(result, 'anonymous-download')
  assert.equal(fixture.events.length, 0)
  assert.equal(fixture.temporaryFiles.length, 0)
})

test('YouTube auth failures update the session, ordinary failures do not', async (context) => {
  const fixture = await createYoutubeAuthFixture(context)
  await fixture.importCookies()
  let requestCookiePath = ''
  await assert.rejects(
    fixture.manager.withCookies(async (args) => {
      requestCookiePath = args[1]
      throw new Error('Video unavailable')
    }),
    /Video unavailable/
  )
  assert.equal((await fixture.manager.getStatus()).authenticated, true)
  await assert.rejects(readFile(requestCookiePath), { code: 'ENOENT' })
  const rateLimit = new Error('HTTP Error 429: Too Many Requests')
  await assert.rejects(
    fixture.manager.withCookies(async () => {
      throw rateLimit
    }),
    (error: unknown) => {
      assert.ok(error instanceof downloadErrors.DownloadError)
      assert.equal(error.code, 'rate_limited')
      assert.equal(error.cause, rateLimit)
      assert.match(error.message, /YouTube is limiting requests/)
      return true
    }
  )
  assert.equal((await fixture.manager.getStatus()).authenticated, false)
  assert.equal(fixture.events.at(-1)?.authenticated, false)
  await assert.rejects(readFile(fixture.sessionPath), { code: 'ENOENT' })
})

test('canceling the YouTube cookie picker preserves an existing sign-in', async (context) => {
  const fixture = await createYoutubeAuthFixture(context)
  await fixture.importCookies()
  fixture.cancelPicker()
  assert.equal((await fixture.importCookies()).authenticated, true)
  assert.equal((await fixture.manager.getStatus()).authenticated, true)
})

test('signing out removes the saved session and returns to anonymous requests', async (context) => {
  const fixture = await createYoutubeAuthFixture(context)
  await fixture.importCookies()
  assert.equal((await fixture.signOut()).authenticated, false)
  await assert.rejects(readFile(fixture.sessionPath), { code: 'ENOENT' })
  await fixture.manager.withCookies(async (args) => {
    assert.equal(args.length, 0)
  })
})

test('dismissing the automatic popup survives later errors and remounts; Settings can still open it', async (context) => {
  const source = await readFile(
    new URL('../src/renderer/src/components/YoutubeAuthPopup.vue', import.meta.url),
    'utf8'
  )
  const { descriptor } = parse(source)
  const script = compileScript(descriptor, { id: 'youtube-auth-dismissal-test' })
  const saved = { youtubeSignInDismissed: false }
  const settings = ref({ ...saved })
  let notify = (_status: YoutubeAuthStatus): void => {}
  const mountPopup = async (manual = false) => {
    let mount = async (): Promise<void> => {}
    const scope = effectScope()
    context.after(() => scope.stop())
    const component = loadTestModule(
      script.content,
      {
        vue: {
          ref,
          watch,
          defineComponent: (value: unknown) => value,
          onMounted: (callback: () => Promise<void>) => {
            mount = callback
          },
          onUnmounted: () => {}
        },
        '@renderer/composables/useSettings': { accessSettings: () => ({ settings }) },
        './Popup.vue': {},
        './LoadingSpinner.vue': {}
      },
      {
        window: {
          api: {
            settings: {
              get: async () => ({ ...saved }),
              update: async (value: typeof saved) => Object.assign(saved, value)
            },
            youtubeAuth: {
              status: async () => ({ authenticated: false, message: null }),
              onChanged: (callback: typeof notify) => {
                notify = callback
                return () => {}
              }
            }
          }
        }
      }
    ).default as {
      setup: (
        props: object,
        context: object
      ) => {
        visible: {
          value: boolean
        }
        closePopup: () => Promise<void>
      }
    }
    const state = scope.run(() =>
      component.setup({ manual }, { expose: () => {}, emit: () => {} })
    )!
    await mount()
    return state
  }
  const first = await mountPopup()
  assert.equal(first.visible.value, true)
  await first.closePopup()
  assert.equal(saved.youtubeSignInDismissed, true)
  notify({ authenticated: false, message: 'HTTP 429' })
  assert.equal(first.visible.value, false)
  const restarted = await mountPopup()
  assert.equal(restarted.visible.value, false)
  notify({ authenticated: false, message: 'Sign in to confirm' })
  assert.equal(restarted.visible.value, false)
  const settingsPopup = await mountPopup(true)
  assert.equal(settingsPopup.visible.value, true)
})

test('the YouTube popup is enabled only after the first SongList visit', async (context) => {
  const source = await readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const script = compileScript(descriptor, { id: 'youtube-auth-route-test' })
  const route = reactive({ path: '/' })
  const component = loadTestModule(script.content, {
    vue: { computed, ref, watch, provide: () => {}, defineComponent: (value: unknown) => value },
    'vue-router': { useRoute: () => route },
    './composables/useBackgroundMusic': { useBackgroundMusic: () => {} },
    './composables/useController': { useController: () => {} },
    './composables/useSettings': { useSettings: () => ({}) },
    './composables/useSongs': { useSongs: () => {} },
    './components/PlayerSettings.vue': {},
    './components/UpdatePopup.vue': {},
    './components/YoutubeAuthPopup.vue': {}
  }).default as {
    setup: (
      props: object,
      context: object
    ) => {
      youtubeAuthEnabled: {
        value: boolean
      }
    }
  }
  const scope = effectScope()
  context.after(() => scope.stop())
  const state = scope.run(() => component.setup({}, { expose: () => {} }))!
  assert.equal(state.youtubeAuthEnabled.value, false)
  route.path = '/installing'
  await nextTick()
  assert.equal(state.youtubeAuthEnabled.value, false)
  route.path = '/song-list'
  await nextTick()
  assert.equal(state.youtubeAuthEnabled.value, true)
  route.path = '/search'
  await nextTick()
  assert.equal(state.youtubeAuthEnabled.value, true)
  assert.match(descriptor.template!.content, /<YoutubeAuthPopup v-if="youtubeAuthEnabled"/)
})

test('YouTube cookie import keeps only active YouTube cookies, including HttpOnly entries', () => {
  const cookies = parseYoutubeCookies(
    [
      '# Netscape HTTP Cookie File',
      '#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tfixture-session',
      '.youtube.com\tTRUE\t/\tTRUE\t1\tSAPISID\texpired-fixture',
      '.example.com\tTRUE\t/\tTRUE\t0\tSID\tunrelated-fixture',
      '.notyoutube.com\tTRUE\t/\tTRUE\t0\tSID\tunrelated-fixture'
    ].join('\n'),
    2000
  )
  assert.match(cookies, /#HttpOnly_\.youtube.com/)
  assert.doesNotMatch(cookies, /expired-fixture|unrelated-fixture/)
})

test('YouTube cookie import rejects anonymous, expired and malformed cookie files', () => {
  for (const content of [
    'not a cookie file',
    '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tVISITOR_INFO1_LIVE\tfixture',
    '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t1\tSID\tfixture',
    '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\tnot-a-date\tSID\tfixture',
    '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tfixture\textra',
    '# Netscape HTTP Cookie File\n' + 'x'.repeat(1024 * 1024)
  ]) {
    assert.throws(() => parseYoutubeCookies(content, 2000))
  }
})

test('YouTube authentication prompts respond to rate limits and sign-in errors, not other failures', () => {
  assert.equal(requiresYoutubeAuthentication('HTTP Error 429: Too Many Requests'), true)
  assert.equal(requiresYoutubeAuthentication('Sign in to confirm you\u2019re not a bot'), true)
  assert.equal(requiresYoutubeAuthentication('Sign in to confirm your age'), true)
  assert.equal(requiresYoutubeAuthentication('The cookies are no longer valid'), true)
  assert.equal(requiresYoutubeAuthentication('Video unavailable'), false)
  assert.equal(requiresYoutubeAuthentication('HTTP Error 403: Forbidden'), false)
  assert.equal(requiresYoutubeAuthentication('Network timeout'), false)
})
