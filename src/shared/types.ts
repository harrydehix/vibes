export type AppSettings = {
  songFolders: string[]
  musicVolume: number
  sfxVolume: number
  lyricsFontScale: number
  syncOffsetMs: number
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
  fixOffsetMs?: number
  index: number
  title: string
  artist: string
  audio: string
  ultrastarBpm: number
  gap?: number
  cover?: string
  background?: string
  video?: string
  videoGap?: number
  vocals?: string
  instrumental?: string
  genre: string[]
  tags: string[]
  creator: string[]
  language: string[]
  year?: number
  start?: number
  end?: number
  previewStart?: number
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
