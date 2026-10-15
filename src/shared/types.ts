export type AppSettings = {
  songFolders: string[]
  musicVolume: number
  sfxVolume: number
  lyricsFontScale: number
  lyricsAlignment: 'left' | 'center'
  syncOffsetMs: number
  highContrastMode: boolean
  lowPerformanceMode: boolean
  youtubeSignInDismissed: boolean
}

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

export type VibesSongMeta = {
  fixOffsetMs?: number
  playCount: number
  favorite: boolean
  id: string
}

export type Line = {
  startTimeMs: number
  endTimeMs: number
  syllables: {
    text: string
    startTimeMs: number
    endTimeMs: number
  }[]
}

export type UsdbSong = {
  apiId: number
  artist: string
  title: string
  languages: string[]
}

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

export type SongSource = {
  provider: string
  id: string
  url?: string
}

export type SongManifest = {
  version: 1
  source: SongSource
  title: string
  artist: string
  language: string[]
  media: {
    video?: string
    audio?: string
    cover?: string
  }
  lyrics: {
    timing: 'syllable' | 'phrase' | 'video'
    lines: Line[]
    originalFile?: string
    language?: string
    automatic?: boolean
  }
}

export type SongDeleteResponse = { ok: true; songs: Song[] } | { ok: false; error: string }

export type CaptionTrack = {
  id: string
  language: string
  name: string
  automatic: boolean
  isDefault?: boolean
}

export type ImportCandidate =
  | {
      source: 'usdb'
      id: string
      title: string
      artist: string
      song: UsdbSong
    }
  | {
      source: 'youtube'
      id: string
      title: string
      artist: string
      url: string
      tracks: CaptionTrack[]
      lyricsInVideo?: boolean
      thumbnail?: string
    }

export type SongImportRequest =
  | { candidate: Extract<ImportCandidate, { source: 'usdb' }> }
  | ({
      candidate: Extract<ImportCandidate, { source: 'youtube' }>
      title: string
      artist: string
    } & (
      | { captionTrackId: string; lyricsInVideo?: false }
      | { lyricsInVideo: true; captionTrackId?: never }
    ))
