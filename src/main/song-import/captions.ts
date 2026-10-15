import type { Line } from '../../shared/types'

type CaptionEvent = {
  tStartMs?: number
  dDurationMs?: number
  segs?: { utf8?: string }[]
}

/** JSON3 supplies phrase timing, not reliable word timing; keep one timed syllable per cue. */
export function parseYoutubeCaptions(content: string, automatic = false): Line[] {
  const data = JSON.parse(content) as { events?: CaptionEvent[] }
  if (!data || !Array.isArray(data.events)) throw new Error('Invalid YouTube caption file')
  const cues = data.events
    .flatMap((event) => {
      if (!event || !Array.isArray(event.segs)) return []
      const text = event.segs
        .map((segment) => (typeof segment.utf8 === 'string' ? segment.utf8 : ''))
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
      const start = event.tStartMs
      const duration = event.dDurationMs
      if (
        !text ||
        typeof start !== 'number' ||
        !Number.isFinite(start) ||
        start < 0 ||
        typeof duration !== 'number' ||
        !Number.isFinite(duration) ||
        duration <= 0
      )
        return []
      return [{ text, start, end: start + duration }]
    })
    .sort((first, second) => first.start - second.start)

  // Count raw valid cues before overlap merging; exactly 80% must not remove unmarked text.
  const filterUnmarkedCues =
    cues.filter((cue) => /^[\u266a\u266b]/.test(cue.text)).length > cues.length * 0.8
  const normalized: typeof cues = []
  for (const cue of cues) {
    if (filterUnmarkedCues && !/^[\u266a\u266b]/.test(cue.text)) continue
    cue.text = cue.text
      .replace(/[\u266a\u266b]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!cue.text) continue
    const previous = normalized[normalized.length - 1]
    if (previous && cue.start < previous.end) {
      if (cue.text === previous.text) {
        previous.end = Math.max(previous.end, cue.end)
        continue
      }
      if (cue.start === previous.start) {
        previous.text = cue.text
        previous.end = Math.max(previous.end, cue.end)
        continue
      }
      if (automatic) {
        // Only generated captions repeat rolling prefixes; authored repetitions may be lyrics.
        const previousWords = previous.text.split(' ')
        const words = cue.text.split(' ')
        for (let count = Math.min(previousWords.length, words.length - 1); count > 0; count--) {
          if (previousWords.slice(-count).join(' ') === words.slice(0, count).join(' ')) {
            cue.text = words.slice(count).join(' ')
            break
          }
        }
      }
      previous.end = cue.start
    }
    normalized.push(cue)
  }
  if (!normalized.length) throw new Error('The selected caption track has no usable timed text')
  return normalized.map((cue) => ({
    startTimeMs: cue.start,
    endTimeMs: cue.end,
    syllables: [{ text: cue.text, startTimeMs: cue.start, endTimeMs: cue.end }]
  }))
}
