import type { SongImportResult } from './types'

const downloadMessages = {
  captions_unavailable: 'The selected captions are unavailable. Please choose another track.',
  invalid_captions: 'These captions could not be read. Please choose another video.',
  already_imported: 'This song is already in your library.',
  import_in_progress: 'This song is already downloading.',
  invalid_request: 'Please select a valid song and enter its title and artist.',
  video_unavailable: 'This video is unavailable. Please choose another one.',
  live_video: 'Live videos cannot be downloaded.',
  not_music: 'Please choose a music video.',
  disk_full: 'Not enough disk space. Free some space and try again.',
  access_denied: 'Cannot write to the download folder. Check its permissions.',
  network_error: 'Could not connect. Check your connection and try again.',
  rate_limited: 'YouTube is limiting requests. Please try again later.',
  unknown: 'Download failed. Please try again.'
} as const

export type DownloadErrorCode = keyof typeof downloadMessages

export class DownloadError extends Error {
  readonly code: DownloadErrorCode

  constructor(code: DownloadErrorCode, detail?: string, options?: ErrorOptions) {
    super(detail ?? downloadMessages[code], options)
    this.code = code
    this.name = 'DownloadError'
  }
}

/** Only whitelisted codes cross IPC; diagnostic messages and causes stay in logs. */
export type SongDownloadResponse =
  | { ok: true; result: SongImportResult }
  | { ok: false; error: { code: DownloadErrorCode } }

const httpRateLimitPattern =
  /\b(?:HTTP(?: Error| status)?|status(?: code)?)\s*:?\s*429\b|\bToo Many Requests\b/i
const youtubeRateLimitPattern =
  /\brate[-\s]limited by YouTube\b|\bYouTube is limiting (?:requests|searches)\b/i

// Intentional UX classification for this yt-dlp failure, not for arbitrary HTTP 403s.
const youtubeVideoForbiddenPattern =
  /\bunable to download video data:\s*HTTP Error 403:\s*Forbidden\b/i

function isRateLimited(error: object): boolean {
  if (
    ('status' in error && error.status === 429) ||
    ('statusCode' in error && error.statusCode === 429)
  )
    return true
  const message = 'message' in error && typeof error.message === 'string' ? error.message : ''
  const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : ''
  const detail = `${message}\n${stderr}`
  return [httpRateLimitPattern, youtubeRateLimitPattern, youtubeVideoForbiddenPattern].some(
    (pattern) => pattern.test(detail)
  )
}

/** Preserve explicit domain errors and bound traversal even for circular cause chains. */
export function getDownloadErrorCode(error: unknown): DownloadErrorCode {
  for (let depth = 0; depth < 5 && typeof error === 'object' && error !== null; depth++) {
    if (error instanceof DownloadError && error.code !== 'unknown') return error.code
    if (isRateLimited(error)) return 'rate_limited'
    if ('code' in error) {
      switch (error.code) {
        case 'ENOSPC':
          return 'disk_full'
        case 'EACCES':
        case 'EPERM':
          return 'access_denied'
        case 'ENOTFOUND':
        case 'ECONNREFUSED':
        case 'ECONNRESET':
        case 'ETIMEDOUT':
          return 'network_error'
      }
    }
    error = 'cause' in error ? error.cause : undefined
  }
  return 'unknown'
}

export function getDownloadErrorMessage(code: unknown): string {
  return typeof code === 'string' && Object.hasOwn(downloadMessages, code)
    ? downloadMessages[code as DownloadErrorCode]
    : downloadMessages.unknown
}
