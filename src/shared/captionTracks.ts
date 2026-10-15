import type { CaptionTrack } from './types'

/** The video's main captions take precedence, including automatic tracks. */
export function defaultCaptionTrackId(tracks: CaptionTrack[]): string {
  return (
    tracks.find((track) => track.isDefault)?.id ??
    tracks.find((track) => !track.automatic)?.id ??
    tracks[0]?.id ??
    ''
  )
}

function normalizeLanguage(language: string): string {
  return language
    .replace(/-orig$/i, '')
    .replace(/_/g, '-')
    .toLowerCase()
}

/** Resolve SDK/native aliases without switching caption kind or guessing ambiguous languages. */
export function resolveCaptionTrack(
  id: string | undefined,
  requestedTracks: CaptionTrack[],
  availableTracks: CaptionTrack[]
): CaptionTrack | undefined {
  const exact = availableTracks.find((track) => track.id === id)
  if (exact) return exact
  const requested = requestedTracks.find((track) => track.id === id)
  if (!requested) return undefined
  const requestedLanguage = normalizeLanguage(requested.language)
  const compatible = availableTracks.filter((track) => {
    const language = normalizeLanguage(track.language)
    return (
      track.automatic === requested.automatic &&
      (language === requestedLanguage ||
        (!requestedLanguage.includes('-') && language.startsWith(`${requestedLanguage}-`)))
    )
  })
  const named = compatible.filter(
    (track) => track.name.toLowerCase() === requested.name.toLowerCase()
  )
  return named.length === 1 ? named[0] : compatible.length === 1 ? compatible[0] : undefined
}

/** yt-dlp exposes original automatic captions as an additional `-orig` track. */
export function markDefaultCaptionTrack(
  tracks: CaptionTrack[],
  main: CaptionTrack | undefined
): void {
  if (!main) return
  const original = main.automatic
    ? tracks.find((track) => track.id === `${main.id}-orig`)
    : undefined
  const selected = original ?? tracks.find((track) => track.id === main.id)
  if (selected) selected.isDefault = true
}
