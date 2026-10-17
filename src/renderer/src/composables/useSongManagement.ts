import {
  computed,
  inject,
  onMounted,
  onScopeDispose,
  provide,
  ref,
  watch,
  type Ref,
  type ComputedRef
} from 'vue'
import { ApiError, getApiErrorCode, unwrapApiResult, type ApiFailure } from '@shared/errors'
import type {
  ImportCandidate,
  Song,
  SongImportRequest,
  SongMetadataUpdate,
  SongProvider,
  SongSearchEntry,
  SongSearchOptions,
  SongSearchResult,
  YoutubeImportCandidate,
  VibesSongMeta
} from '@shared/types'
import { isYoutubeLink } from '@shared/youtubeUrl'

export type DownloadState = {
  candidate: ImportCandidate
  progress: number
  status: 'downloading' | 'completed' | 'error'
  error?: ApiFailure
}

export type SongManagement = {
  songs: Ref<Song[]>
  downloads: Ref<DownloadState[]>
  query: Ref<string>
  results: Ref<SongSearchEntry[]>
  searchErrors: Ref<(ApiFailure & { provider?: SongProvider })[]>
  searching: Ref<boolean>
  searchingLocal: Ref<boolean>
  selectedYoutube: Ref<YoutubeImportCandidate | null>
  localResults: ComputedRef<Song[]>
  availableResults: ComputedRef<ImportCandidate[]>
  getSongs(): Promise<Song[]>
  searchSongs(text: string, options?: SongSearchOptions): Promise<SongSearchResult>
  updateSong(id: string, patch: SongMetadataUpdate): Promise<VibesSongMeta>
  deleteSong(id: string): Promise<Song[]>
  downloadSong(request: SongImportRequest): Promise<Song>
  cancelSearch(): void
}

export function useSongManagement(): SongManagement {
  const songs = ref<Song[]>([])
  const downloads = ref<DownloadState[]>([])
  const query = ref('')
  const results = ref<SongSearchEntry[]>([])
  const searchErrors = ref<(ApiFailure & { provider?: SongProvider })[]>([])
  const searching = ref(false)
  const searchingLocal = ref(false)
  const selectedYoutube = ref<YoutubeImportCandidate | null>(null)
  let searchVersion = 0
  let activeSearches = 0
  let searchTimer: ReturnType<typeof setTimeout> | undefined

  const localResults = computed(() =>
    results.value.flatMap((entry) => (entry.downloaded ? [entry.song] : []))
  )
  const availableResults = computed(() =>
    results.value.flatMap((entry) => (entry.downloaded ? [] : [entry.candidate]))
  )

  async function getSongs(): Promise<Song[]> {
    songs.value = unwrapApiResult(await window.api.songs.getSongs())
    return songs.value
  }

  async function searchSongs(text: string, options?: SongSearchOptions): Promise<SongSearchResult> {
    return unwrapApiResult(await window.api.songs.searchSongs(text, options))
  }

  async function updateSong(id: string, patch: SongMetadataUpdate): Promise<VibesSongMeta> {
    const metadata = unwrapApiResult(await window.api.songs.updateSong(id, patch))
    const song = songs.value.find((entry) => entry.meta.id === id)
    if (song) Object.assign(song.meta, metadata)
    return metadata
  }

  async function deleteSong(id: string): Promise<Song[]> {
    songs.value = unwrapApiResult(await window.api.songs.deleteSong(id))
    return songs.value
  }

  async function downloadSong(request: SongImportRequest): Promise<Song> {
    const candidate = request.candidate
    let state = downloads.value.find(
      (entry) => entry.candidate.source === candidate.source && entry.candidate.id === candidate.id
    )
    if (state?.status === 'downloading') throw new ApiError('import_in_progress')
    if (!state) {
      downloads.value.push({ candidate, progress: 0, status: 'downloading' })
      state = downloads.value[downloads.value.length - 1]
    } else {
      Object.assign(state, { candidate, progress: 0, status: 'downloading', error: undefined })
    }
    try {
      const song = unwrapApiResult(
        await window.api.songs.downloadSong(JSON.parse(JSON.stringify(request)))
      )
      state.progress = 1
      state.status = 'completed'
      songs.value = [...songs.value.filter((entry) => entry.meta.id !== song.meta.id), song]
      return song
    } catch (error) {
      console.error('Song download failed:', error)
      state.status = 'error'
      state.error = { code: getApiErrorCode(error) }
      throw new ApiError(state.error.code)
    }
  }

  const unsubscribe = window.api.songs.onDownloadProgress((candidate, progress) => {
    const state = downloads.value.find(
      (entry) => entry.candidate.source === candidate.source && entry.candidate.id === candidate.id
    )
    if (state && Number.isFinite(progress))
      state.progress = Math.max(state.progress, Math.min(1, progress))
  })

  function invalidateSearch(): void {
    searchVersion++
    if (searchTimer !== undefined) clearTimeout(searchTimer)
    searchTimer = undefined
    searching.value = false
    searchingLocal.value = false
  }

  function cancelSearch(): void {
    invalidateSearch()
    if (activeSearches) void window.api.songs.searchSongs('', { providers: [] }).catch(() => {})
  }

  async function runSearch(text: string, version: number, local: boolean): Promise<void> {
    activeSearches++
    try {
      const result = await searchSongs(text, local ? { providers: ['local'] } : undefined)
      if (version !== searchVersion) return
      results.value = result.songs
      if (!local) {
        searchErrors.value = result.errors
        if (isYoutubeLink(text)) {
          const candidate = result.songs.find(
            (entry) => entry.candidate?.source === 'youtube'
          )?.candidate
          if (candidate?.source === 'youtube') selectedYoutube.value = candidate
        }
      }
    } catch (error) {
      if (version === searchVersion) searchErrors.value = [{ code: getApiErrorCode(error) }]
    } finally {
      activeSearches--
      if (version === searchVersion) {
        if (local) searchingLocal.value = false
        else searching.value = false
      }
    }
  }

  function scheduleSearch(text: string, keepSelection = false): void {
    invalidateSearch()
    const version = searchVersion
    if (!keepSelection) selectedYoutube.value = null
    results.value = []
    searchErrors.value = []
    searchingLocal.value = true
    searching.value = Boolean(text.trim())
    searchTimer = setTimeout(async () => {
      searchTimer = undefined
      if (version !== searchVersion) return
      await runSearch(text.trim(), version, true)
      if (version === searchVersion && text.trim()) await runSearch(text.trim(), version, false)
    }, 300)
  }

  watch(query, (text) => scheduleSearch(text))
  watch(songs, () => scheduleSearch(query.value, true))
  onMounted(() => {
    void getSongs().catch((error) => console.error('Could not load songs:', error))
  })
  onScopeDispose(() => {
    cancelSearch()
    unsubscribe()
  })

  const management = {
    songs,
    downloads,
    query,
    results,
    searchErrors,
    searching,
    searchingLocal,
    localResults,
    availableResults,
    selectedYoutube,
    getSongs,
    searchSongs,
    downloadSong,
    deleteSong,
    updateSong,
    cancelSearch
  }
  provide('songManagement', management)
  return management
}

export function accessSongManagement(): ReturnType<typeof useSongManagement> {
  const management = inject<ReturnType<typeof useSongManagement>>('songManagement')
  if (!management) throw new Error('Song management has not been provided')
  return management
}
