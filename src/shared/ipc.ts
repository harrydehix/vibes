export const IPC_CHANNELS = {
  SETTINGS: {
    GET: 'settings:get',
    UPDATE: 'settings:update',
    REFRESH: 'settings:refresh'
  },
  SONGS: {
    GET: 'songs:get',
    REFRESH: 'songs:refresh',
    FIX_OFFSET: 'songs:fixOffset'
  },
  DIALOG: {
    OPEN_FOLDER: 'dialog:openFolder'
  },
  DOWNLOADER: {
    SEARCH: 'downloader:search',
    DOWNLOAD: 'downloader:download',
    PROGRESS: 'downloader:progress'
  },
  YTDLP: {
    ENSURE_INSTALLED: 'ytdlp:ensureInstalled'
  }
} as const
