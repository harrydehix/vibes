export const IPC_CHANNELS = {
  SETTINGS: {
    GET: 'settings:get',
    UPDATE: 'settings:update',
    REFRESH: 'settings:refresh'
  },
  SONGS: {
    GET: 'songs:get',
    REFRESH: 'songs:refresh',
    FIX_OFFSET: 'songs:fixOffset',
    SONG_PLAYED: 'songs:songPlayed'
  },
  DIALOG: {
    OPEN_FOLDER: 'dialog:openFolder'
  },
  DOWNLOADER: {
    SEARCH: 'downloader:search',
    DOWNLOAD: 'downloader:download',
    PROGRESS: 'downloader:progress'
  },
  APP_UPDATE: {
    PROGRESS: 'app-update:progress',
    DOWNLOADED: 'app-update:downloaded',
    INSTALL: 'app-update:install'
  }
} as const
