import path from 'path'
import type { Line, Note, Song, VibesSongMeta } from '../../../shared/types'

export function parseSongFile(
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
        case 'END': {
          const endMilliseconds = Number(attributeValue)
          if (Number.isFinite(endMilliseconds) && endMilliseconds > 0) {
            result.audioEndSeconds = endMilliseconds / 1000
          }
          break
        }
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
        ...(note.type === 'golden' || note.type === 'rap golden' ? { isGolden: true } : {}),
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
