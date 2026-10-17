import { z } from 'zod'

export const AppSettingsSchema = z.object({
  songFolders: z.array(z.string().min(1)),
  musicVolume: z.number().min(0).max(1),
  sfxVolume: z.number().min(0).max(1),
  lyricsFontScale: z.number().positive(),
  lyricsAlignment: z.enum(['left', 'center']),
  syncOffsetMs: z.number(),
  highContrastMode: z.boolean(),
  lowPerformanceMode: z.boolean(),
  youtubeSignInDismissed: z.boolean()
})
export type AppSettings = z.infer<typeof AppSettingsSchema>

export const AppSettingsUpdateSchema = AppSettingsSchema.partial().strict()
export type AppSettingsUpdate = z.infer<typeof AppSettingsUpdateSchema>

export type YoutubeAuthStatus = {
  authenticated: boolean
  message: string | null
}

export type Note =
  | {
      type: 'normal' | 'golden' | 'freestyle' | 'rap' | 'rap golden'
      startBeat: number
      length: number
      pitch: number
      text: string
      player: 'P1' | 'P2'
    }
  | {
      type: 'end-of-phrase'
      startBeat: number
    }

export type Song = {
  source?: SongSource
  lyricsTiming?: 'syllable' | 'phrase' | 'video'
  folder: string
  usesAudio: boolean
  usesVideo: boolean
  fixOffsetMs?: number
  index: number
  title: string
  artist: string
  audio: string
  ultrastarBpm: number
  gapMilliseconds?: number
  cover?: string
  background?: string
  video?: string
  videoGapSeconds?: number
  vocals?: string
  instrumental?: string
  genre: string[]
  tags: string[]
  creator: string[]
  language: string[]
  year?: number
  videoStartSeconds?: number
  audioStartSeconds?: number
  videoEndSeconds?: number
  audioEndSeconds?: number
  previewStartSeconds?: number
  comment?: string
  providedBy?: string
  p1?: string
  p2?: string
  medleyStartBeat?: number
  medleyEndBeat?: number
  calcMedley?: boolean
  notes: Note[]
  lines: {
    P1: Line[]
    P2?: Line[]
  }
  meta: VibesSongMeta
}

export const VibesSongMetaSchema = z.object({
  fixOffsetMs: z.number().optional(),
  playCount: z.number().int().nonnegative(),
  favorite: z.boolean(),
  id: z.string().min(1)
})
export type VibesSongMeta = z.infer<typeof VibesSongMetaSchema>

export const LineSchema = z
  .object({
    startTimeMs: z.number().nonnegative(),
    endTimeMs: z.number().nonnegative(),
    syllables: z
      .array(
        z.object({
          text: z.string().refine((value) => Boolean(value.trim()), 'Missing lyric text'),
          isGolden: z.boolean().optional(),
          startTimeMs: z.number().nonnegative(),
          endTimeMs: z.number().nonnegative()
        })
      )
      .min(1)
  })
  .superRefine((line, context) => {
    if (line.endTimeMs <= line.startTimeMs) {
      context.addIssue({ code: 'custom', message: 'Invalid lyric cue' })
    }
    for (const syllable of line.syllables) {
      if (
        syllable.endTimeMs <= syllable.startTimeMs ||
        syllable.startTimeMs < line.startTimeMs ||
        syllable.endTimeMs > line.endTimeMs
      ) {
        context.addIssue({ code: 'custom', message: 'Invalid syllable timing' })
      }
    }
  })
export type Line = z.infer<typeof LineSchema>

export const UsdbSongSchema = z.object({
  apiId: z.number().int().positive(),
  artist: z.string().min(1),
  title: z.string().min(1),
  languages: z.array(z.string())
})
export type UsdbSong = z.infer<typeof UsdbSongSchema>

export type UsdbSearchPage = {
  totalPages: number
  songs: UsdbSong[]
}

export type UsdbSearchParams = {
  interpret?: string // artist name
  title?: string // song title
  limit?: number // max 100
  start?: number // pagination offset
}

export type UsdbDownloadParams = {
  song: UsdbSong
  cookie: string
  baseDir?: string
  onProgress?: (progress: number) => void
}

export type SongImportResult = {
  dirName: string
  songDir: string
}

export const SongSourceSchema = z.object({
  provider: z.string().trim().min(1),
  id: z.string().trim().min(1),
  url: z.string().trim().min(1).optional()
})
export type SongSource = z.infer<typeof SongSourceSchema>

export type SongProvider = 'local' | 'usdb' | 'youtube'

export const SongSearchOptionsSchema = z
  .object({
    providers: z.array(z.enum(['local', 'usdb', 'youtube'])).optional()
  })
  .strict()
export type SongSearchOptions = z.infer<typeof SongSearchOptionsSchema>

export type SongSearchEntry = {
  provider: SongProvider
  id: string
  title: string
  artist: string
  thumbnail?: string
} & (
  | { downloaded: true; song: Song; candidate?: ImportCandidate }
  | { downloaded: false; candidate: ImportCandidate; song?: never }
)

export type SongSearchResult = {
  songs: SongSearchEntry[]
  errors: { provider: SongProvider; code: import('./errors').ApiErrorCode }[]
}

export const SongMetadataUpdateSchema = VibesSongMetaSchema.omit({ id: true }).partial().strict()
export type SongMetadataUpdate = z.infer<typeof SongMetadataUpdateSchema>

export const SongManifestSchema = z
  .object({
    version: z.literal(1),
    source: SongSourceSchema,
    title: z.string().trim().min(1),
    artist: z.string().trim().min(1),
    language: z.array(z.string().trim().min(1)).default([]),
    media: z
      .object({
        video: z.string().min(1).optional(),
        audio: z.string().min(1).optional(),
        cover: z.string().min(1).optional()
      })
      .refine((media) => Boolean(media.video || media.audio), 'Song has no media'),
    lyrics: z.object({
      timing: z.enum(['syllable', 'phrase', 'video']),
      lines: z.array(LineSchema),
      originalFile: z.string().optional(),
      language: z.string().optional(),
      automatic: z.boolean().optional()
    })
  })
  .superRefine((manifest, context) => {
    if (manifest.lyrics.timing === 'video') {
      if (manifest.lyrics.lines.length)
        context.addIssue({
          code: 'custom',
          message: 'Video-embedded lyrics must not contain timed cues'
        })
      if (!manifest.media.video)
        context.addIssue({ code: 'custom', message: 'Video-embedded lyrics require video media' })
    } else if (!manifest.lyrics.lines.length) {
      context.addIssue({ code: 'custom', message: 'Song has no timed lyrics' })
    }
  })
export type SongManifest = z.infer<typeof SongManifestSchema>

export const CaptionTrackSchema = z.object({
  id: z.string().min(1),
  language: z.string().min(1),
  name: z.string(),
  automatic: z.boolean(),
  isDefault: z.boolean().optional()
})
export type CaptionTrack = z.infer<typeof CaptionTrackSchema>

export const UsdbImportCandidateSchema = z.object({
  source: z.literal('usdb'),
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  title: z.string().min(1),
  artist: z.string().min(1),
  song: UsdbSongSchema
})
export type UsdbImportCandidate = z.infer<typeof UsdbImportCandidateSchema>

export const YoutubeImportCandidateSchema = z.object({
  source: z.literal('youtube'),
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  title: z.string().min(1),
  artist: z.string().min(1),
  url: z.url(),
  tracks: z.array(CaptionTrackSchema),
  lyricsInVideo: z.boolean().optional(),
  thumbnail: z.string().optional()
})
export type YoutubeImportCandidate = z.infer<typeof YoutubeImportCandidateSchema>

export const ImportCandidateSchema = z.discriminatedUnion('source', [
  UsdbImportCandidateSchema,
  YoutubeImportCandidateSchema
])
export type ImportCandidate = z.infer<typeof ImportCandidateSchema>

export const SongImportRequestSchema = z.union([
  z.object({ candidate: UsdbImportCandidateSchema }).strict(),
  z
    .object({
      candidate: YoutubeImportCandidateSchema,
      title: z.string().trim().min(1),
      artist: z.string().trim().min(1),
      captionTrackId: z.string().min(1),
      lyricsInVideo: z.literal(false).optional()
    })
    .strict(),
  z
    .object({
      candidate: YoutubeImportCandidateSchema,
      title: z.string().trim().min(1),
      artist: z.string().trim().min(1),
      lyricsInVideo: z.literal(true),
      captionTrackId: z.never().optional()
    })
    .strict()
])
export type SongImportRequest = z.infer<typeof SongImportRequestSchema>
