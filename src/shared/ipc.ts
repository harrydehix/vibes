export const IPC_CHANNELS = {
  SETTINGS: {
    GET: 'settings:get',
    UPDATE: 'settings:update',
    REFRESH: 'settings:refresh'
  },
  SONGS: {
    GET: 'songs:get',
    SEARCH: 'songs:search',
    DOWNLOAD: 'songs:download',
    DELETE: 'songs:delete',
    UPDATE: 'songs:update',
    PROGRESS: 'songs:downloadProgress'
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
  APP_UPDATE: {
    CHECK: 'app-update:check',
    AVAILABLE: 'app-update:available',
    ERROR: 'app-update:error',
    PROGRESS: 'app-update:progress',
    DOWNLOADED: 'app-update:downloaded',
    INSTALL: 'app-update:install'
  }
} as const
