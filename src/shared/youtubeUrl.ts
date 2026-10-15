const youtubeHosts = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be'
])

/** Recognize links for routing; normalizeYoutubeUrl performs the actual validation. */
export function isYoutubeLink(input: string): boolean {
  try {
    return youtubeHosts.has(new URL(input.trim()).hostname)
  } catch {
    return false
  }
}

export function normalizeYoutubeUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error('Enter a valid YouTube video URL')
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) {
    throw new Error('Enter a valid YouTube video URL')
  }
  let id: string | null = null
  if (url.hostname === 'youtu.be') {
    id = url.pathname.slice(1)
  } else if (youtubeHosts.has(url.hostname)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v')
    else if (/^\/(shorts|embed|live)\//.test(url.pathname)) id = url.pathname.split('/')[2]
  }
  if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) {
    throw new Error('Enter a YouTube video URL, not a channel or playlist')
  }
  return `https://www.youtube.com/watch?v=${id}`
}
