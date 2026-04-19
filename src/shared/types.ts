export type AppSettings = {
  songFolders: string[]
  musicVolume: number
  sfxVolume: number
  lyricsFontScale: number
  syncOffsetMs: number
  highContrastMode: boolean
  lowPerformanceMode: boolean
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

export type DownloadSongParams = {
  song: UsdbSong
  cookie: string
  baseDir?: string
}

export type DownloadSongResult = {
  dirName: string
  songDir: string
}
