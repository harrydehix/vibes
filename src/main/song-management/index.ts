import { rm } from 'node:fs/promises'
import { ApiError } from '../../shared/errors'
import { SongImportRequestSchema } from '../../shared/types'
import type {
  ImportCandidate,
  Song,
  SongImportRequest,
  SongSearchOptions,
  SongSearchResult
} from '../../shared/types'
import { basePathForDownload } from '../settings/index'
import { songManager } from './library'
import { importSong } from './import'
import { searchSongs as search } from './search'
import { searchUsdbCandidates } from './providers/usdb/index'
import { searchYoutubeCandidates } from './providers/youtube/index'

export const getSongs = (): Promise<Song[]> => songManager.getSongs()
export const deleteSong = songManager.deleteSong.bind(songManager)
export const updateSong = songManager.updateSong.bind(songManager)

export function searchSongs(
  query: string,
  options: SongSearchOptions = {},
  signal?: AbortSignal
): Promise<SongSearchResult> {
  return search(
    query,
    options,
    songManager.songs,
    {
      usdb: searchUsdbCandidates,
      youtube: searchYoutubeCandidates
    },
    signal
  )
}

export async function downloadSong(
  request: SongImportRequest,
  onProgress: (candidate: ImportCandidate, progress: number) => void
): Promise<Song> {
  const parsed = SongImportRequestSchema.safeParse(request)
  if (!parsed.success) throw new ApiError('invalid_request')
  const validated = parsed.data
  if (
    songManager.songs.some(
      (song) =>
        song.source?.provider === validated.candidate.source &&
        song.source.id === validated.candidate.id
    )
  ) {
    throw new ApiError('already_imported')
  }
  const result = await importSong(
    validated,
    basePathForDownload,
    (progress) => onProgress(validated.candidate, Math.min(progress, 0.99)),
    (folder) => songManager.loadSong(folder, songManager.songs.length)
  )
  try {
    const song = await songManager.addSong(result.songDir)
    onProgress(validated.candidate, 1)
    return song
  } catch (error) {
    await rm(result.songDir, { recursive: true, force: true })
    throw error
  }
}
