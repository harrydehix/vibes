import { onScopeDispose, ref, watch, type Ref } from 'vue'
import type { ImportCandidate } from '@shared/types'
import { getDownloadErrorCode, getDownloadErrorMessage } from '@shared/errors'
import { isYoutubeLink } from '@shared/youtubeUrl'
import type { useDownloader } from './useDownloader'

type SearchDownloader = Pick<
  ReturnType<typeof useDownloader>,
  'cancelYoutubeSearch' | 'inspectYoutube' | 'searchAll'
>

type RemoteSongSearchState = {
  selectedYoutube: Ref<Extract<ImportCandidate, { source: 'youtube' }> | null>
  searchErrors: Ref<string[]>
  availableForDownloadSongs: Ref<ImportCandidate[]>
  onlineLoading: Ref<boolean>
}

/** Owns debounce and stale replies independently of the local library and page animations. */
export function useRemoteSongSearch(
  search: Ref<string>,
  downloader: SearchDownloader
): RemoteSongSearchState {
  const selectedYoutube = ref<Extract<ImportCandidate, { source: 'youtube' }> | null>(null)
  const searchErrors = ref<string[]>([])
  const availableForDownloadSongs = ref<ImportCandidate[]>([])
  const onlineLoading = ref(false)
  let searchVersion = 0
  let searchTimeout: number | undefined

  function cancelPendingSearch(): void {
    searchVersion++
    downloader.cancelYoutubeSearch()
    if (searchTimeout !== undefined) clearTimeout(searchTimeout)
    searchTimeout = undefined
  }

  async function inspectLink(url: string, version: number): Promise<void> {
    try {
      const video = await downloader.inspectYoutube(url)
      if (version !== searchVersion) return
      const candidate = video.tracks.length ? video : { ...video, lyricsInVideo: true }
      availableForDownloadSongs.value = [candidate]
      selectedYoutube.value = candidate
    } catch (error) {
      if (version !== searchVersion) return
      console.error('YouTube link inspection failed:', error)
      const code = getDownloadErrorCode(error)
      searchErrors.value = [
        code === 'unknown'
          ? 'Could not load this YouTube video. Check the link and try again.'
          : getDownloadErrorMessage(code)
      ]
    } finally {
      if (version === searchVersion) onlineLoading.value = false
    }
  }

  async function searchSources(query: string, version: number): Promise<void> {
    await downloader.searchAll(query, (result) => {
      if (version !== searchVersion) return
      availableForDownloadSongs.value = result.candidates
      searchErrors.value = result.errors
      onlineLoading.value = result.pending > 0
    })
  }

  function scheduleSearch(query: string): void {
    cancelPendingSearch()
    const version = searchVersion
    selectedYoutube.value = null
    searchErrors.value = []
    availableForDownloadSongs.value = []
    onlineLoading.value = Boolean(query.trim())
    if (!query.trim()) return
    searchTimeout = window.setTimeout(async () => {
      searchTimeout = undefined
      // Version checks protect both late replies and already queued timer callbacks.
      if (version !== searchVersion) return
      if (isYoutubeLink(query)) await inspectLink(query.trim(), version)
      else await searchSources(query, version)
    }, 400)
  }

  watch(search, scheduleSearch, { immediate: true })
  onScopeDispose(cancelPendingSearch)

  return { selectedYoutube, searchErrors, availableForDownloadSongs, onlineLoading }
}
