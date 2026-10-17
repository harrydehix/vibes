import type { ProgressInfo, UpdateInfo } from 'electron-updater'
import type { ApiFailure, ApiResult } from './errors'
import type {
  AppSettings,
  ImportCandidate,
  Song,
  SongImportRequest,
  SongMetadataUpdate,
  SongSearchOptions,
  SongSearchResult,
  VibesSongMeta,
  YoutubeAuthStatus
} from './types'

export type Unsubscribe = () => void

export interface AppAPI {
  settings: {
    get(): Promise<ApiResult<AppSettings>>
    update(patch: Partial<AppSettings>): Promise<ApiResult<AppSettings>>
    refresh(): Promise<ApiResult<AppSettings>>
  }
  songs: {
    getSongs(): Promise<ApiResult<Song[]>>
    searchSongs(query: string, options?: SongSearchOptions): Promise<ApiResult<SongSearchResult>>
    downloadSong(request: SongImportRequest): Promise<ApiResult<Song>>
    deleteSong(id: string): Promise<ApiResult<Song[]>>
    updateSong(id: string, patch: SongMetadataUpdate): Promise<ApiResult<VibesSongMeta>>
    onDownloadProgress(
      callback: (candidate: ImportCandidate, progress: number) => void
    ): Unsubscribe
  }
  youtubeAuth: {
    status(): Promise<ApiResult<YoutubeAuthStatus>>
    openBrowser(): Promise<ApiResult<void>>
    openHelp(): Promise<ApiResult<void>>
    importCookies(): Promise<ApiResult<YoutubeAuthStatus>>
    signOut(): Promise<ApiResult<YoutubeAuthStatus>>
    onChanged(callback: (status: YoutubeAuthStatus) => void): Unsubscribe
  }
  dialog: { openFolder(): Promise<ApiResult<string | null>> }
  updater: {
    check(): Promise<ApiResult<UpdateInfo | null>>
    install(): Promise<ApiResult<void>>
    onAvailable(callback: (update: UpdateInfo) => void): Unsubscribe
    onProgress(callback: (progress: ProgressInfo) => void): Unsubscribe
    onDownloaded(callback: (update: UpdateInfo) => void): Unsubscribe
    onError(callback: (error: ApiFailure) => void): Unsubscribe
  }
}
