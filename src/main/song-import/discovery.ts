import type { ImportCandidate } from '../../shared/types'

type YoutubeCandidate = Extract<ImportCandidate, { source: 'youtube' }>

export function isMusicVideo(metadata: {
  categories?: string[]
  track?: string
  artist?: string
}): boolean {
  return Boolean(
    (metadata.track?.trim() && metadata.artist?.trim()) ||
    metadata.categories?.some((category) => category.toLowerCase() === 'music')
  )
}

export async function discoverCaptionedMusic(
  urls: string[],
  inspect: (url: string) => Promise<YoutubeCandidate & { isMusic: boolean }>,
  signal?: AbortSignal
): Promise<YoutubeCandidate[]> {
  signal?.throwIfAborted()
  const results: (YoutubeCandidate | undefined)[] = new Array(urls.length)
  let nextIndex = 0
  let failures = 0
  await Promise.all(
    Array.from({ length: Math.min(3, urls.length) }, async () => {
      while (nextIndex < urls.length) {
        signal?.throwIfAborted()
        const index = nextIndex++
        try {
          const video = await inspect(urls[index])
          signal?.throwIfAborted()
          if (
            video.isMusic &&
            (video.lyricsInVideo === true || video.tracks.some((track) => !track.automatic))
          )
            results[index] = video
        } catch {
          signal?.throwIfAborted()
          failures++
        }
      }
    })
  )
  if (urls.length && failures === urls.length) {
    throw new Error('Could not inspect YouTube results. Please try again.')
  }
  return results.filter((video): video is YoutubeCandidate => Boolean(video))
}
