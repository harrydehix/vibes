import path from 'node:path'
import { SongManifestSchema, SongSourceSchema } from '../../../shared/types.ts'
import type { Line, Song, SongSource, VibesSongMeta } from '../../../shared/types'

export const songManifestFile = 'song.vibes.json'

export function parseSongSource(value: unknown): SongSource {
  return SongSourceSchema.parse(value)
}

export function parseSongManifest(
  content: string,
  folder: string,
  index: number,
  fixOffsetMs: number,
  meta: VibesSongMeta
): Song {
  const manifest = SongManifestSchema.parse(JSON.parse(content))
  const { media, lyrics } = manifest
  const localFile = (filename: string | undefined): string | undefined => {
    if (filename === undefined) return undefined
    const resolved = path.resolve(folder, filename)
    const relative = path.relative(path.resolve(folder), resolved)
    if (
      path.isAbsolute(filename) ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      !relative
    ) {
      throw new Error('Song media must be inside its folder')
    }
    return resolved
  }
  const lines: Line[] = lyrics.lines.map((line) => ({
    ...line,
    startTimeMs: line.startTimeMs + fixOffsetMs,
    endTimeMs: line.endTimeMs + fixOffsetMs,
    syllables: line.syllables.map((syllable) => ({
      ...syllable,
      startTimeMs: syllable.startTimeMs + fixOffsetMs,
      endTimeMs: syllable.endTimeMs + fixOffsetMs
    }))
  }))
  const video = localFile(media.video)
  const audio = localFile(media.audio)
  return {
    source: manifest.source,
    lyricsTiming: lyrics.timing,
    title: manifest.title,
    artist: manifest.artist,
    language: manifest.language,
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
