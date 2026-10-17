import assert from 'node:assert/strict'
import { test } from 'node:test'
import path from 'node:path'
import { normalizeYoutubeUrl } from '../src/shared/youtubeUrl.ts'
import { parseYoutubeCaptions } from '../src/main/song-management/lyrics/captions.ts'
import { parseSongManifest } from '../src/main/song-management/formats/manifest.ts'
import * as captionTracks from '../src/shared/captionTracks.ts'
import type { CaptionTrack } from '../src/shared/types.ts'
import { videoId, canonicalUrl, captionFile, cue, folder, meta, manifest } from './fixtures.ts'

test('caption selection prioritizes the main track and retains explicit fallback rules', () => {
  const manual = { id: 'manual:de', language: 'de', name: 'German', automatic: false }
  const automatic = { id: 'auto:en', language: 'en', name: 'English', automatic: true }
  assert.equal(captionTracks.defaultCaptionTrackId([]), '')
  assert.equal(captionTracks.defaultCaptionTrackId([automatic]), automatic.id)
  assert.equal(captionTracks.defaultCaptionTrackId([automatic, manual]), manual.id)
  assert.equal(
    captionTracks.defaultCaptionTrackId([manual, { ...automatic, isDefault: true }]),
    automatic.id
  )
})

test('caption main-track aliases prefer original automatic captions and never guess languages', () => {
  const main = { id: 'auto:en', language: 'en', name: 'English', automatic: true }
  const tracks: CaptionTrack[] = [{ ...main }, { ...main, id: 'auto:en-orig' }]
  captionTracks.markDefaultCaptionTrack(tracks, main)
  assert.equal(tracks[0].isDefault, undefined)
  assert.equal(tracks[1].isDefault, true)
  const unmatched: CaptionTrack[] = [{ ...main, id: 'auto:de', language: 'de' }]
  captionTracks.markDefaultCaptionTrack(unmatched, main)
  assert.equal(unmatched[0].isDefault, undefined)
})

test('normalizes supported YouTube URLs and removes playlists and tracking parameters', () => {
  for (const url of [
    `${canonicalUrl}&list=playlist&t=20`,
    `https://youtu.be/${videoId}?si=tracking`,
    `https://music.youtube.com/watch?v=${videoId}`,
    `https://m.youtube.com/watch?v=${videoId}`,
    `https://www.youtube.com/shorts/${videoId}`,
    `https://youtube.com/embed/${videoId}`,
    `https://youtube.com/live/${videoId}`
  ])
    assert.equal(normalizeYoutubeUrl(url), canonicalUrl)
})

test('rejects non-YouTube, playlist-only, malformed and credential-bearing URLs', () => {
  for (const url of [
    'not a URL',
    'https://youtube.com/playlist?list=abc',
    'https://youtube.com/watch?v=short',
    `https://youtube.com.evil.example/watch?v=${videoId}`,
    `https://user:password@youtube.com/watch?v=${videoId}`,
    `http://localhost/watch?v=${videoId}`,
    `ftp://youtube.com/watch?v=${videoId}`
  ])
    assert.throws(() => normalizeYoutubeUrl(url), /YouTube/)
})

test('preserves phrase timing and joins caption segments without inventing word timestamps', () => {
  const lines = parseYoutubeCaptions(
    captionFile([
      {
        tStartMs: 1200,
        dDurationMs: 2100,
        segs: [{ utf8: 'Hello ' }, { utf8: 'world\nagain', tOffsetMs: 500 }]
      }
    ])
  )
  assert.deepEqual(lines, [
    {
      startTimeMs: 1200,
      endTimeMs: 3300,
      syllables: [{ text: 'Hello world again', startTimeMs: 1200, endTimeMs: 3300 }]
    }
  ])
})

test('YouTube caption preprocessing keeps only music-prefixed cues above 80 percent and preserves timing', () => {
  const marked = Array.from({ length: 9 }, (_, index) =>
    cue(index * 1000, 700, `  ${index % 2 ? '\u266a' : '\u266b'} Line ${index} \u266b  `)
  )
  const content = captionFile([
    ...marked,
    cue(9000, 700, 'Spoken introduction'),
    ...Array.from({ length: 10 }, () => ({ tStartMs: 0 })),
    cue(-1, 1000, 'Invalid timing'),
    cue(0, 0, 'Invalid duration'),
    cue(10000, 1000, '   ')
  ])
  for (const automatic of [false, true]) {
    const lines = parseYoutubeCaptions(content, automatic)
    assert.equal(lines.length, 9)
    assert.deepEqual(
      lines.map((line) => [line.startTimeMs, line.endTimeMs, line.syllables[0].text]),
      marked.map((event, index) => [event.tStartMs, event.tStartMs + 700, `Line ${index}`])
    )
  }
})

test('YouTube caption preprocessing retains unmarked cues at or below 80 percent and removes music symbols everywhere', () => {
  for (const markedCount of [0, 1, 4]) {
    const content = captionFile(
      Array.from({ length: 5 }, (_, index) =>
        cue(index * 1000, 700, `${index < markedCount ? '\u266a ' : ''}Line \u266b ${index} \u266a`)
      )
    )
    const lines = parseYoutubeCaptions(content)
    assert.deepEqual(
      lines.map((line) => line.syllables[0].text),
      ['Line 0', 'Line 1', 'Line 2', 'Line 3', 'Line 4']
    )
  }
})

test('YouTube caption preprocessing counts music markers before overlapping cues are merged', () => {
  const content = captionFile([
    ...Array.from({ length: 9 }, () => cue(0, 1000, '\u266a Refrain \u266a')),
    cue(2000, 700, 'Spoken interlude')
  ])
  const lines = parseYoutubeCaptions(content)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].syllables[0].text, 'Refrain')
  assert.equal(lines[0].startTimeMs, 0)
  assert.equal(lines[0].endTimeMs, 1000)
})

test('YouTube caption preprocessing cleans music markers before removing automatic rolling overlap', () => {
  const content = captionFile([
    cue(0, 3000, '\u266a one two \u266b'),
    cue(2000, 2000, '\u266b two three \u266a')
  ])
  assert.equal(parseYoutubeCaptions(content, true)[1].syllables[0].text, 'three')
  assert.equal(parseYoutubeCaptions(content, false)[1].syllables[0].text, 'two three')
})

test('YouTube caption preprocessing drops symbol-only cues and rejects tracks without remaining text', () => {
  const lines = parseYoutubeCaptions(
    captionFile([cue(0, 1000, '\u266a \u266b'), cue(2000, 700, 'Words')])
  )
  assert.equal(lines.length, 1)
  assert.equal(lines[0].startTimeMs, 2000)
  assert.equal(lines[0].syllables[0].text, 'Words')
  assert.throws(
    () => parseYoutubeCaptions(captionFile([cue(0, 1000, '\u266a \u266b')])),
    /no usable timed text/
  )
})

test('sorts cues and clips overlapping phrases to the next start', () => {
  const lines = parseYoutubeCaptions(
    captionFile([cue(2000, 1500, 'second'), cue(1000, 2000, 'first')])
  )
  assert.deepEqual(
    lines.map((line) => [line.startTimeMs, line.endTimeMs]),
    [
      [1000, 2000],
      [2000, 3500]
    ]
  )
})

test('merges identical overlapping captions but keeps repetitions sung later', () => {
  const lines = parseYoutubeCaptions(
    captionFile([cue(0, 2000, 'hello'), cue(1000, 2000, 'hello'), cue(4000, 1000, 'hello')]),
    true
  )
  assert.equal(lines.length, 2)
  assert.equal(lines[0].endTimeMs, 3000)
  assert.equal(lines[1].startTimeMs, 4000)
})

test('removes rolling automatic caption overlap without removing creator-written words', () => {
  const content = captionFile([cue(0, 3000, 'one two'), cue(2000, 2000, 'two three')])
  assert.equal(parseYoutubeCaptions(content, true)[1].syllables[0].text, 'three')
  assert.equal(parseYoutubeCaptions(content, false)[1].syllables[0].text, 'two three')
})

test('replaces updated text at the same timestamp and skips blank window events', () => {
  const lines = parseYoutubeCaptions(
    captionFile([
      cue(0, 1000, 'one'),
      cue(0, 1500, 'one two'),
      { tStartMs: 500 },
      cue(2000, 1000, '\n')
    ])
  )
  assert.equal(lines.length, 1)
  assert.equal(lines[0].syllables[0].text, 'one two')
  assert.equal(lines[0].endTimeMs, 1500)
})

test('rejects empty, invalid and unusable caption files', () => {
  for (const content of [
    '{}',
    'null',
    captionFile([]),
    captionFile([cue(-1, 1000, 'bad'), cue(0, 0, 'bad')])
  ]) {
    assert.throws(() => parseYoutubeCaptions(content), /caption|timed text/)
  }
})

test('loads native video songs with provenance, library metadata and offset-adjusted cues', () => {
  const song = parseSongManifest(JSON.stringify(manifest()), folder, 7, -250, meta)
  assert.equal(song.source?.id, videoId)
  assert.equal(song.lyricsTiming, 'phrase')
  assert.equal(song.video, path.join(folder, 'video.mp4'))
  assert.equal(song.audio, song.video)
  assert.equal(song.usesVideo, true)
  assert.equal(song.usesAudio, false)
  assert.equal(song.lines.P1[0].startTimeMs, 750)
  assert.equal(song.lines.P1[0].syllables[0].endTimeMs, 1750)
  assert.equal(song.index, 7)
  assert.deepEqual(song.meta, meta)
  assert.deepEqual(song.notes, [])
})

test('native manifests allow empty lyrics only for video-embedded lyrics with video media', () => {
  const data = manifest()
  data.lyrics = { timing: 'video', lines: [] }
  data.language = []
  const song = parseSongManifest(JSON.stringify(data), folder, 0, 0, meta)
  assert.equal(song.usesVideo, true)
  assert.equal(song.lyricsTiming, 'video')
  assert.equal(song.lines.P1.length, 0)
  assert.equal(song.notes.length, 0)
  data.lyrics = { timing: 'phrase', lines: [] }
  assert.throws(
    () => parseSongManifest(JSON.stringify(data), folder, 0, 0, meta),
    /no timed lyrics/
  )
  data.lyrics = { timing: 'video', lines: manifest().lyrics.lines }
  assert.throws(
    () => parseSongManifest(JSON.stringify(data), folder, 0, 0, meta),
    /must not contain timed cues/
  )
  data.lyrics = { timing: 'video', lines: [] }
  data.media = { audio: 'audio.mp3' }
  assert.throws(
    () => parseSongManifest(JSON.stringify(data), folder, 0, 0, meta),
    /require video media/
  )
})

test('native manifests also support other providers and audio-only media', () => {
  const data = manifest()
  data.source = { provider: 'another-provider', id: 'external-id' }
  data.media = { audio: 'audio.mp3' }
  const song = parseSongManifest(JSON.stringify(data), folder, 0, 0, meta)
  assert.equal(song.source?.provider, 'another-provider')
  assert.equal(song.usesAudio, true)
  assert.equal(song.usesVideo, false)
  assert.equal(song.video, undefined)
})

test('native manifests support existing syllable-timed lyric rendering', () => {
  const data = manifest()
  data.lyrics.timing = 'syllable'
  data.lyrics.lines[0].syllables = [
    { text: 'Hello ', startTimeMs: 1000, endTimeMs: 1500 },
    { text: 'world', startTimeMs: 1500, endTimeMs: 2000 }
  ]
  const song = parseSongManifest(JSON.stringify(data), folder, 0, 100, meta)
  assert.equal(song.lyricsTiming, 'syllable')
  assert.equal(song.lines.P1[0].syllables.length, 2)
  assert.equal(song.lines.P1[0].syllables[1].startTimeMs, 1600)
})

test('rejects media paths outside the song folder', () => {
  for (const filename of ['../outside.mp4', path.resolve('outside.mp4')]) {
    const data = manifest()
    data.media.video = filename
    assert.throws(
      () => parseSongManifest(JSON.stringify(data), folder, 0, 0, meta),
      /inside its folder/
    )
  }
})

test('rejects invalid manifest versions, missing media and malformed timing', () => {
  const data = manifest()
  assert.throws(
    () => parseSongManifest(JSON.stringify({ ...data, version: 2 }), folder, 0, 0, meta),
    /version/
  )
  assert.throws(
    () => parseSongManifest(JSON.stringify({ ...data, media: {} }), folder, 0, 0, meta),
    /no media/
  )
  data.lyrics.lines[0].syllables[0].endTimeMs = 3000
  assert.throws(
    () => parseSongManifest(JSON.stringify(data), folder, 0, 0, meta),
    /syllable timing/
  )
})
