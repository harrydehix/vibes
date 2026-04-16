import { readdir, readFile, writeFile } from 'fs/promises'
import { Line, Note, Song } from '../../shared/types'
import { settingsManager } from './settings'
import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc'
import path from 'path/win32'

function parseSongFile(content: string, folder: string, index: number, fixOffsetMs: number): Song {
  const result: Song = {
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
    folder
  }

  const lines = content.split('\n')
  let noteLines: string[] = []
  let relative = false
  // First parse attributes
  for (const line of lines) {
    if (line.startsWith('#')) {
      // parse attribute
      let [attributeName, attributeValue] = line.slice(1).split(':')
      attributeValue = attributeValue.trim()
      attributeName = attributeName.trim().toUpperCase()
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
          result.gap = parseInt(attributeValue)
          break
        case 'COVER':
          result.cover = path.join(folder, attributeValue)
          break
        case 'BACKGROUND':
          result.background = path.join(folder, attributeValue)
          break
        case 'VIDEO':
          result.video = path.join(folder, attributeValue)
          break
        case 'VIDEOGAP':
          result.videoGap = parseInt(attributeValue)
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
          result.start = parseFloat(attributeValue)
          break
        case 'END':
          result.end = parseFloat(attributeValue)
          break
        case 'PREVIEWSTART':
        case 'PREVIEW':
          result.previewStart = parseFloat(attributeValue)
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
    const startBeatTimeMs = beatsToTimeMs(result, note.startBeat)
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
        endTimeMs: beatsToTimeMs(result, note.startBeat + note.length)
      })
    }
  }
  return result
}

function beatsToTimeMs(song: Song, beat: number): number {
  const msPerBeat = (60 * 1000) / (song.ultrastarBpm * 4)
  return (song.gap ?? 0) + beat * msPerBeat + (song?.videoGap ?? 0) * 1000 + (song.fixOffsetMs ?? 0)
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

    ipcMain.handle(IPC_CHANNELS.SONGS.FIX_OFFSET, async (_, song: Song, songOffsetMs: number) => {
      await this._fixSong(song, songOffsetMs)
    })
  }

  private async _fixSong(song: Song, songOffsetMs: number): Promise<Song> {
    await writeFile(`${song.folder}/fix-offset.txt`, songOffsetMs.toString(), 'utf-8')
    return await this._refreshSong(song)
  }

  private async _refreshSong(song: Song): Promise<Song> {
    try {
      const refreshedSong = await this._loadSong(song.folder, song.index, song.fixOffsetMs ?? 0)
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

  private async _loadSong(folder: string, index: number, fixOffset: number): Promise<Song> {
    const songFile = await readFile(`${folder}/song.txt`, 'utf-8')
    const parsedSong = parseSongFile(songFile, folder, index, fixOffset)
    console.log(
      `Loaded song: ${parsedSong.title} by ${parsedSong.artist} (id: ${parsedSong.index})`
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

        for (const folder of songFolders) {
          // a song is always a folder and contains at least a song.txt file
          // loop through subfolders
          const songs = await readdir(folder, { withFileTypes: true, recursive: false })
          let songIndex = 0
          for (let i = 0; i < songs.length; i++) {
            const song = songs[i]
            if (!song.isDirectory()) continue
            try {
              const songFile = await readFile(`${folder}/${song.name}/song.txt`, 'utf-8')
              let fixOffset = 0
              try {
                const offsetContent = await readFile(
                  `${folder}/${song.name}/fix-offset.txt`,
                  'utf-8'
                )
                fixOffset = parseInt(offsetContent.trim())
              } catch (_) {}
              const parsedSong = parseSongFile(
                songFile,
                path.join(folder, song.name),
                songIndex,
                fixOffset
              )
              newSongs.push(parsedSong)
              songIndex++
              console.log(
                `Loaded song: ${parsedSong.title} by ${parsedSong.artist} (id: ${parsedSong.index})`
              )
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
