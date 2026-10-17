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

const apiMessages = {
  ...downloadMessages,
  song_not_found: 'This song could not be uniquely identified.',
  unsafe_path: 'This song folder cannot be deleted safely.',
  library_unavailable: 'The song library could not be loaded.',
  settings_failed: 'The app settings could not be saved or loaded.',
  authentication_failed: 'The YouTube session could not be verified.',
  secure_storage_unavailable: 'Secure session storage is unavailable.',
  dialog_failed: 'The file dialog could not be opened.',
  update_failed: 'The app update could not be checked or installed.',
  update_not_ready: 'No downloaded app update is ready to install.'
} as const

export type ApiErrorCode = keyof typeof apiMessages
export type ApiFailure = { code: ApiErrorCode }
export type ApiResult<Value> = { ok: true; value: Value } | { ok: false; error: ApiFailure }

export class ApiError extends Error {
  readonly code: ApiErrorCode

  constructor(code: ApiErrorCode) {
    super(apiMessages[code])
    this.name = 'ApiError'
    this.code = code
  }
}

export function getApiErrorCode(error: unknown, fallback: ApiErrorCode = 'unknown'): ApiErrorCode {
  for (
    let depth = 0, current = error;
    depth < 5 && typeof current === 'object' && current !== null;
    depth++
  ) {
    if (
      'code' in current &&
      typeof current.code === 'string' &&
      Object.hasOwn(apiMessages, current.code)
    ) {
      return current.code as ApiErrorCode
    }
    current = 'cause' in current ? current.cause : undefined
  }
  const downloadCode = getDownloadErrorCode(error)
  return downloadCode === 'unknown' ? fallback : downloadCode
}

export function getApiErrorMessage(code: ApiErrorCode): string {
  return apiMessages[code]
}

export function unwrapApiResult<Value>(result: ApiResult<Value>): Value {
  if (!result.ok) throw new ApiError(result.error.code)
  return result.value
}

export class DownloadError extends Error {
  readonly code: DownloadErrorCode

  constructor(code: DownloadErrorCode, detail?: string, options?: ErrorOptions) {
    super(detail ?? downloadMessages[code], options)
    this.code = code
    this.name = 'DownloadError'
  }
}

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
