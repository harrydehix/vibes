import type { Line } from '../../../shared/types'
import { z } from 'zod'

const CaptionEventSchema = z.object({
  tStartMs: z.number().nonnegative(),
  dDurationMs: z.number().positive(),
  segs: z.array(z.object({ utf8: z.string().catch('') }))
})
const CaptionDocumentSchema = z.object({ events: z.array(z.unknown()) })

/** JSON3 supplies phrase timing, not reliable word timing; keep one timed syllable per cue. */
export function parseYoutubeCaptions(content: string, automatic = false): Line[] {
  const parsed = CaptionDocumentSchema.safeParse(JSON.parse(content))
  if (!parsed.success) throw new Error('Invalid YouTube caption file')
  const cues = parsed.data.events
    .flatMap((value) => {
      const parsedEvent = CaptionEventSchema.safeParse(value)
      if (!parsedEvent.success) return []
      const event = parsedEvent.data
      const text = event.segs
        .map((segment) => segment.utf8)
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
      const start = event.tStartMs
      const duration = event.dDurationMs
      if (!text) return []
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
