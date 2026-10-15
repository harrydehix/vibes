import path from 'node:path'
import type { Line, Song, SongSource, VibesSongMeta } from '../../shared/types'

export const songManifestFile = 'song.vibes.json'

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid song manifest')
  }
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Missing song metadata')
  return value
}

function time(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Invalid lyric timestamp')
  }
  return value
}

export function parseSongSource(value: unknown): SongSource {
  const source = record(value)
  return {
    provider: text(source.provider),
    id: text(source.id),
    url: source.url === undefined ? undefined : text(source.url)
  }
}

export function parseSongManifest(
  content: string,
  folder: string,
  index: number,
  fixOffsetMs: number,
  meta: VibesSongMeta
): Song {
  const manifest = record(JSON.parse(content))
  if (manifest.version !== 1) throw new Error('Unsupported song manifest version')
  const media = record(manifest.media)
  const lyrics = record(manifest.lyrics)
  if (lyrics.timing !== 'phrase' && lyrics.timing !== 'syllable' && lyrics.timing !== 'video') {
    throw new Error('Unsupported lyric timing')
  }
  if (!Array.isArray(lyrics.lines) || (lyrics.timing !== 'video' && lyrics.lines.length === 0)) {
    throw new Error('Song has no timed lyrics')
  }
  if (lyrics.timing === 'video' && lyrics.lines.length > 0) {
    throw new Error('Video-embedded lyrics must not contain timed cues')
  }
  const localFile = (value: unknown): string | undefined => {
    if (value === undefined) return undefined
    const filename = text(value)
    const resolved = path.resolve(folder, filename)
    const relative = path.relative(path.resolve(folder), resolved)
    if (path.isAbsolute(filename) || relative.startsWith('..') || !relative) {
      throw new Error('Song media must be inside its folder')
    }
    return resolved
  }
  const lines: Line[] = lyrics.lines.map((value: unknown) => {
    const line = record(value)
    const startTimeMs = time(line.startTimeMs)
    const endTimeMs = time(line.endTimeMs)
    if (endTimeMs <= startTimeMs || !Array.isArray(line.syllables) || !line.syllables.length) {
      throw new Error('Invalid lyric cue')
    }
    return {
      startTimeMs: startTimeMs + fixOffsetMs,
      endTimeMs: endTimeMs + fixOffsetMs,
      syllables: line.syllables.map((value: unknown) => {
        const syllable = record(value)
        const start = time(syllable.startTimeMs)
        const end = time(syllable.endTimeMs)
        if (end <= start || start < startTimeMs || end > endTimeMs) {
          throw new Error('Invalid syllable timing')
        }
        return {
          text: text(syllable.text),
          startTimeMs: start + fixOffsetMs,
          endTimeMs: end + fixOffsetMs
        }
      })
    }
  })
  const video = localFile(media.video)
  const audio = localFile(media.audio)
  if (!video && !audio) throw new Error('Song has no media')
  if (lyrics.timing === 'video' && !video)
    throw new Error('Video-embedded lyrics require video media')
  return {
    source: parseSongSource(manifest.source),
    lyricsTiming: lyrics.timing,
    title: text(manifest.title),
    artist: text(manifest.artist),
    language: Array.isArray(manifest.language) ? manifest.language.map(text) : [],
    folder,
    index,
    fixOffsetMs,
    meta,
    video,
    audio: audio ?? video ?? '',
    cover: localFile(media.cover),
    usesVideo: Boolean(video),
    usesAudio: Boolean(audio),
    ultrastarBpm: 0,
    notes: [],
    genre: [],
    tags: [],
    creator: [],
    lines: { P1: lines, P2: [] }
  }
}
