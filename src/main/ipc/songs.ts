import { lstat, readdir, readFile, realpath, rm, writeFile } from 'fs/promises'
import { Line, Note, Song, SongDeleteResponse, VibesSongMeta } from '../../shared/types'
import { settingsManager } from './settings'
import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { parseSongManifest, parseSongSource, songManifestFile } from '../song-import/manifest'

function parseSongFile(
  content: string,
  folder: string,
  index: number,
  fixOffsetMs: number,
  meta: VibesSongMeta
): Song {
  const result: Song = {
    lyricsTiming: 'syllable',
    meta,
    title: 'Untitled',
    artist: 'Unknown Artist',
    audio: '',
    ultrastarBpm: 0,
    genre: [],
    tags: [],
    creator: [],
    language: [],
    notes: [],
    lines: {
      P1: [],
      P2: []
    },
    index,
    fixOffsetMs,
    folder,
    usesAudio: false,
    usesVideo: false
  }

  const lines = content.split('\n')
  let noteLines: string[] = []
  let relative = false
  // First parse attributes
  for (const line of lines) {
    if (line.startsWith('#')) {
      // parse attribute
      const colonIndex = line.indexOf(':')
      if (colonIndex === -1) continue
      let attributeName = line.slice(1, colonIndex).trim().toUpperCase()
      let attributeValue = line.slice(colonIndex + 1).trim()
      switch (attributeName) {
        case 'TITLE':
          result.title = attributeValue
          break
        case 'ARTIST':
          result.artist = attributeValue
          break
        case 'AUDIO':
        case 'MP3':
          result.audio = path.join(folder, attributeValue)
          break
        case 'BPM':
          result.ultrastarBpm = parseFloat(attributeValue)
          break
        case 'GAP':
          result.gapMilliseconds = parseInt(attributeValue)
          break
        case 'COVER':
          result.cover = path.join(folder, attributeValue)
          break
        case 'BACKGROUND':
          result.background = path.join(folder, attributeValue)
          break
        case 'VIDEO':
          result.video = path.join(folder, attributeValue)
          result.usesVideo = true
          break
        case 'VIDEOGAP':
          result.videoGapSeconds = parseFloat(attributeValue)
          break
        case 'VOCALS':
          result.vocals = attributeValue
          break
        case 'INSTRUMENTAL':
          result.instrumental = attributeValue
          break
        case 'GENRE':
          result.genre = attributeValue.split(',').map((s) => s.trim())
          break
        case 'TAGS':
          result.tags = attributeValue.split(',').map((s) => s.trim())
          break
        case 'CREATOR':
        case 'AUTHOR':
          result.creator = attributeValue.split(',').map((s) => s.trim())
          break
        case 'LANGUAGE':
          result.language = attributeValue.split(',').map((s) => s.trim())
          break
        case 'YEAR':
          result.year = parseInt(attributeValue)
          break
        case 'START':
          result.audioStartSeconds = parseFloat(attributeValue)
          break
        case 'END':
          result.audioEndSeconds = parseFloat(attributeValue)
          break
        case 'PREVIEWSTART':
        case 'PREVIEW':
          result.previewStartSeconds = parseFloat(attributeValue)
          break
        case 'COMMENT':
          result.comment = attributeValue
          break
        case 'MEDLEYSTARTBEAT':
          result.medleyStartBeat = parseFloat(attributeValue)
          break
        case 'MEDLEYENDBEAT':
          result.medleyEndBeat = parseFloat(attributeValue)
          break
        case 'CALCMEDLEY':
          result.calcMedley = attributeValue.toLowerCase() === 'on'
          break
        case 'P1':
        case 'DUETSINGERP1':
          result.p1 = attributeValue
          break
        case 'P2':
        case 'DUETSINGERP2':
          result.p2 = attributeValue
          break
        case 'PROVIDEDBY':
          result.providedBy = attributeValue
          break
        case 'RELATIVE':
          relative = attributeValue.toLowerCase() === 'yes'
          break
        default:
          console.warn(`Unhandled attribute: ${attributeName}`)
      }
    } else {
      noteLines.push(line)
    }
  }

  result.videoStartSeconds = (result.audioStartSeconds ?? 0) + (result.videoGapSeconds ?? 0)
  result.videoEndSeconds = result.audioEndSeconds
    ? result.audioEndSeconds + (result.videoGapSeconds ?? 0)
    : undefined

  result.usesAudio = result.audio !== '' && !result.audio.includes('.mp4')

  // Parse notes
  let currentPlayer: 'P1' | 'P2' = 'P1'
  for (let line of noteLines) {
    try {
      // remove \r
      line = line.replace(/\r$/, '')
      if (line.trim() === '') continue
      let elements = line.split(' ')
      let [type, startBeat, length, pitch, ...texts] = elements
      let text = texts.join(' ')

      type = type.trim()
      if (type === 'E') break
      else if (type === '-') {
        const beat = parseFloat(startBeat)
        result.notes.push({
          type: 'end-of-phrase',
          startBeat: beat
        })
        continue
      } else if (type === 'P1' || type === 'P2') {
        currentPlayer = type
        continue
      }
      let noteType: Exclude<Note['type'], 'end-of-phrase'>
      switch (type) {
        case ':':
          noteType = 'normal'
          break
        case '*':
          noteType = 'golden'
          break
        case 'F':
          noteType = 'freestyle'
          break
        case 'R':
          noteType = 'rap'
          break
        case 'G':
          noteType = 'rap golden'
          break
        default:
          console.warn(`Unhandled note type: ${type}`)
          continue
      }
      let parsedBeat = parseFloat(startBeat)
      if (relative) {
        console.warn('Relative mode is on, calculating absolute beat for note:', line)
        const lastNote = result.notes[result.notes.length - 1]
        if (lastNote) {
          parsedBeat += lastNote.startBeat
        }
      }

      const beatLength = parseFloat(length)

      result.notes.push({
        type: noteType,
        startBeat: parsedBeat,
        length: beatLength,
        pitch: parseInt(pitch),
        text: text,
        player: currentPlayer
      })
    } catch (error) {
      console.warn(`Error parsing note line: ${line}`, error)
    }
  }

  let currentLine: Partial<Line> = {
    startTimeMs: undefined,
    endTimeMs: undefined,
    syllables: []
  }
  let currentPlayerForLine: 'P1' | 'P2' = 'P1'
  for (const note of result.notes) {
    const startBeatTimeMs = beatsToAudioTimeMs(result, note.startBeat)
    if (currentLine.startTimeMs === undefined) {
      currentLine.startTimeMs = startBeatTimeMs
    }
    if (note.type === 'end-of-phrase') {
      currentLine.endTimeMs = startBeatTimeMs
      result.lines[currentPlayerForLine]!.push(currentLine as Line)
      currentLine = {
        startTimeMs: undefined,
        endTimeMs: undefined,
        syllables: []
      }
    } else {
      currentPlayerForLine = note.player
      currentLine.syllables!.push({
        text: note.text,
        startTimeMs: startBeatTimeMs,
        endTimeMs: beatsToAudioTimeMs(result, note.startBeat + note.length)
      })
    }
  }

  if (currentLine.syllables && currentLine.syllables.length > 0) {
    currentLine.endTimeMs = currentLine.syllables[currentLine.syllables.length - 1].endTimeMs
    result.lines[currentPlayerForLine]!.push(currentLine as Line)
  }

  return result
}

function beatsToAudioTimeMs(song: Song, beat: number): number {
  const msPerBeat = (60 * 1000) / (song.ultrastarBpm * 4)
  return (
    (song.gapMilliseconds ?? 0) +
    beat * msPerBeat +
    // (song?.videoGapSeconds ?? 0) * 1000 +
    (song.fixOffsetMs ?? 0)
  )
}

class SongManager {
  _songs: Song[]
  private _refreshPromise: Promise<void> | null = null

  constructor() {
    this._songs = []
  }

  get songs(): Song[] {
    return this._songs
  }

  async defineIpcHandles() {
    ipcMain.handle(IPC_CHANNELS.SONGS.GET, async () => {
      return this._songs
    })

    ipcMain.handle(IPC_CHANNELS.SONGS.REFRESH, async () => {
      await this._refresh()
      return this._songs
    })

    ipcMain.handle(
      IPC_CHANNELS.SONGS.DELETE,
      async (_, id: string): Promise<SongDeleteResponse> => {
        try {
          await this._deleteSong(id)
          return { ok: true, songs: this._songs }
        } catch (error) {
          console.error('Song deletion failed:', error)
          return {
            ok: false,
            error: 'Could not delete this song. Close any player using it and try again.'
          }
        }
      }
    )

    ipcMain.handle(IPC_CHANNELS.SONGS.FIX_OFFSET, async (_, song: Song, songOffsetMs: number) => {
      await this._fixSong(song, songOffsetMs)
    })

    ipcMain.handle(IPC_CHANNELS.SONGS.SONG_PLAYED, async (_, id: string) => {
      const song = this._songs.find((s) => s.meta.id === id)
      if (song) {
        song.meta.playCount++
        await writeFile(`${song.folder}/meta.vibes`, JSON.stringify(song.meta), 'utf-8')
      }
    })
  }

  /** Resolve an existing identity, never a renderer-supplied filesystem path. */
  private async _deleteSong(id: string): Promise<void> {
    if (typeof id !== 'string' || !id) throw new Error('A song ID is required')
    if (this._refreshPromise) await this._refreshPromise
    const matches = this._songs.filter((song) => song.meta.id === id)
    if (matches.length !== 1) throw new Error('The song could not be uniquely identified')
    const song = matches[0]
    const folder = path.resolve(song.folder)
    const info = await lstat(folder)
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error('Only regular song folders can be deleted')
    const realFolder = await realpath(folder)
    // Physical immediate children only: never delete a library root or follow a directory link.
    const roots = await Promise.all(
      settingsManager.settings.songFolders.map((root) => realpath(root).catch(() => null))
    )
    if (roots.includes(realFolder) || !roots.includes(path.dirname(realFolder)))
      throw new Error('The song folder is outside the configured song libraries')
    await rm(folder, { recursive: true, maxRetries: 3, retryDelay: 100 })
    if (this._refreshPromise) await this._refreshPromise
    this._songs = this._songs
      .filter((entry) => path.resolve(entry.folder) !== folder)
      .map((entry, index) => ({ ...entry, index }))
  }

  private async _fixSong(song: Song, songOffsetMs: number): Promise<Song> {
    await writeFile(`${song.folder}/offset.fix`, songOffsetMs.toString(), 'utf-8')
    return await this._refreshSong(song)
  }

  private async _refreshSong(song: Song): Promise<Song> {
    try {
      const refreshedSong = await this._loadSong(song.folder, song.index)
      this._songs[song.index] = refreshedSong
      console.log(
        `Refreshed song: ${refreshedSong.title} by ${refreshedSong.artist} (id: ${refreshedSong.index})`
      )
      return refreshedSong
    } catch (error) {
      console.warn(`Error refreshing song: ${song.folder}`, error)
      return song
    }
  }

  private async _loadSong(folder: string, index: number): Promise<Song> {
    // find every *.txt file in folder
    const files = await readdir(folder, { withFileTypes: true })
    const manifestFile = files.find((file) => file.isFile() && file.name === songManifestFile)
    const songFilePath = files.filter((file) => file.isFile() && file.name.endsWith('.txt'))[0]
    if (!manifestFile && !songFilePath) {
      throw new Error(`No song manifest or UltraStar file found in folder: ${folder}`)
    }
    const songFile = await readFile(
      path.join(folder, (manifestFile ?? songFilePath)!.name),
      'utf-8'
    )
    let fixOffset = 0
    try {
      const offsetContent = await readFile(`${folder}/offset.fix`, 'utf-8')
      const offset = Number(offsetContent.trim())
      if (Number.isFinite(offset)) fixOffset = offset
    } catch (_) {}

    let meta: VibesSongMeta
    try {
      const metaContent = await readFile(`${folder}/meta.vibes`, 'utf-8')
      meta = JSON.parse(metaContent)
    } catch (_) {
      meta = { playCount: 0, favorite: false, id: uuidv4() }
      try {
        await writeFile(`${folder}/meta.vibes`, JSON.stringify(meta), 'utf-8')
      } catch (error) {
        console.warn(`Error writing meta.vibes file for song: ${folder}`, error)
      }
    }

    const parsedSong = manifestFile
      ? parseSongManifest(songFile, folder, index, fixOffset, meta)
      : parseSongFile(songFile, folder, index, fixOffset, meta)
    if (!manifestFile) {
      try {
        parsedSong.source = parseSongSource(
          JSON.parse(await readFile(path.join(folder, 'source.vibes'), 'utf-8'))
        )
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.warn(`Could not read song provenance: ${folder}`, error)
        }
      }
    }
    console.log(
      `Loaded song: ${parsedSong.title} by ${parsedSong.artist} (index: ${parsedSong.index}, id: ${parsedSong.meta.id})`
    )
    return parsedSong
  }

  private async _refresh() {
    if (this._refreshPromise) await this._refreshPromise

    this._refreshPromise = (async () => {
      const newSongs: Song[] = []
      try {
        // loop through folder and look for songs
        const songFolders = settingsManager.settings.songFolders

        let songIndex = 0
        for (const folder of songFolders) {
          const songs = await readdir(folder, { withFileTypes: true, recursive: false })
          for (let i = 0; i < songs.length; i++) {
            const song = songs[i]
            if (!song.isDirectory() || song.name.startsWith('.import-')) continue
            try {
              const parsedSong = await this._loadSong(`${folder}/${song.name}`, songIndex)
              newSongs.push(parsedSong)
              songIndex++
            } catch (error) {
              console.warn(`Error loading song: ${folder}/${song.name}`, error)
            }
          }
          console.log(`Loaded ${newSongs.length} songs from ${folder}`)
        }
        this._songs = newSongs
      } catch (error) {
        console.warn('Error loading songs:', error)
      } finally {
        this._refreshPromise = null
      }
    })()

    return this._refreshPromise
  }
}

export const songManager = new SongManager()
