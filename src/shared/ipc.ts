export const IPC_CHANNELS = {
  SETTINGS: {
    GET: 'settings:get',
    UPDATE: 'settings:update',
    REFRESH: 'settings:refresh'
  },
  SONGS: {
    GET: 'songs:get',
    REFRESH: 'songs:refresh',
    DELETE: 'songs:delete',
    FIX_OFFSET: 'songs:fixOffset',
    SONG_PLAYED: 'songs:songPlayed'
  },
  DIALOG: {
    OPEN_FOLDER: 'dialog:openFolder'
  },
  YOUTUBE_AUTH: {
    STATUS: 'youtube-auth:status',
    OPEN_BROWSER: 'youtube-auth:openBrowser',
    OPEN_HELP: 'youtube-auth:openHelp',
    IMPORT_COOKIES: 'youtube-auth:importCookies',
    SIGN_OUT: 'youtube-auth:signOut',
    CHANGED: 'youtube-auth:changed'
  },
  DOWNLOADER: {
    SEARCH_USDB: 'downloader:search',
    SEARCH_YOUTUBE: 'downloader:searchYoutube',
    INSPECT_YOUTUBE: 'downloader:inspectYoutube',
    DOWNLOAD: 'downloader:download',
    PROGRESS: 'downloader:progress'
  },
  APP_UPDATE: {
    PROGRESS: 'app-update:progress',
    DOWNLOADED: 'app-update:downloaded',
    INSTALL: 'app-update:install'
  }
} as const
