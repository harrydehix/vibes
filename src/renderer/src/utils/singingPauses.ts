import type { Line } from '@shared/types'

export type SingingPause = {
  startTimeMs: number
  endTimeMs: number
}

export type LyricsRow = Line & { kind: 'lyrics' | 'pause' }

function timedSyllables(lines: readonly Line[]): Line['syllables'] {
  return lines
    .flatMap((line) => line.syllables)
    .filter(
      (syllable) =>
        syllable.text.trim() &&
        Number.isFinite(syllable.startTimeMs) &&
        Number.isFinite(syllable.endTimeMs) &&
        syllable.endTimeMs > syllable.startTimeMs
    )
    .sort((first, second) => first.startTimeMs - second.startTimeMs)
}

/** Use sung syllables, not phrase boundaries that may include trailing instrumental time. */
export function getSingingPauses(lines: readonly Line[]): SingingPause[] {
  const syllables = timedSyllables(lines)
  const pauses: SingingPause[] = []
  let previousEndTimeMs = 0
  for (const syllable of syllables) {
    if (syllable.startTimeMs - previousEndTimeMs > 3000) {
      pauses.push({ startTimeMs: previousEndTimeMs, endTimeMs: syllable.startTimeMs })
    }
    previousEndTimeMs = Math.max(previousEndTimeMs, syllable.endTimeMs)
  }
  return pauses
}

/** Insert scrollable pauses and split display-only phrases around internal instrumental gaps. */
export function getLyricsRows(lines: readonly Line[]): LyricsRow[] {
  const pauses = getSingingPauses(lines)
  const rows: LyricsRow[] = pauses.map((pause) => ({ ...pause, kind: 'pause', syllables: [] }))

  for (const line of lines) {
    let group: Line['syllables'] = []
    let groupEndTimeMs = -Infinity

    function appendGroup(): void {
      if (!group.length) return
      const followingPause = pauses.find((pause) => pause.startTimeMs >= groupEndTimeMs)
      rows.push({
        kind: 'lyrics',
        startTimeMs: group[0].startTimeMs,
        endTimeMs: Math.max(
          groupEndTimeMs,
          Math.min(line.endTimeMs, followingPause?.startTimeMs ?? Infinity)
        ),
        syllables: group
      })
      group = []
      groupEndTimeMs = -Infinity
    }

    for (const syllable of timedSyllables([line])) {
      if (
        group.length &&
        pauses.some(
          (pause) => pause.startTimeMs >= groupEndTimeMs && pause.endTimeMs <= syllable.startTimeMs
        )
      )
        appendGroup()
      group.push(syllable)
      groupEndTimeMs = Math.max(groupEndTimeMs, syllable.endTimeMs)
    }
    appendGroup()
  }

  return rows.sort((first, second) => first.startTimeMs - second.startTimeMs)
}
