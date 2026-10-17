import Fuse from 'fuse.js'
import { ApiError, getApiErrorCode } from '../../shared/errors'
import { SongSearchOptionsSchema } from '../../shared/types'
import { Cause, Runtime } from 'effect'
import type {
  ImportCandidate,
  Song,
  SongProvider,
  SongSearchEntry,
  SongSearchOptions,
  SongSearchResult
} from '../../shared/types'

type RemoteProvider = Exclude<SongProvider, 'local'>
export type SongSearchProviders = Record<
  RemoteProvider,
  (query: string, signal?: AbortSignal) => Promise<ImportCandidate[]>
>

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function rank(entries: SongSearchEntry[], query: string, threshold: number): SongSearchEntry[] {
  if (!query) return entries
  const indexed = entries.map((entry) => ({
    entry,
    title: normalize(entry.title),
    artist: normalize(entry.artist),
    text: normalize(`${entry.artist} ${entry.title}`),
    reversed: normalize(`${entry.title} ${entry.artist}`)
  }))
  return new Fuse(indexed, {
    keys: ['text', 'reversed', 'title', 'artist'],
    threshold,
    ignoreLocation: true,
    includeScore: true
  })
    .search(normalize(query))
    .map(({ item }) => item.entry)
}

export async function searchSongs(
  query: string,
  options: SongSearchOptions,
  library: Song[],
  providers: SongSearchProviders,
  signal?: AbortSignal
): Promise<SongSearchResult> {
  const parsed = SongSearchOptionsSchema.safeParse(options)
  if (typeof query !== 'string' || !parsed.success) throw new ApiError('invalid_request')
  const allowed = parsed.data.providers ?? ['local', 'usdb', 'youtube']
  const text = query.trim()
  const local: SongSearchEntry[] = allowed.includes('local')
    ? library.map((song) => ({
        provider: 'local',
        id: song.meta.id,
        title: song.title,
        artist: song.artist,
        thumbnail: song.cover,
        downloaded: true,
        song
      }))
    : []
  const result: SongSearchResult = { songs: rank(local, text, 0.2), errors: [] }
  if (!text) return result
  const remote = [...new Set(allowed)].filter(
    (provider): provider is RemoteProvider => provider !== 'local'
  )
  const batches = await Promise.all(
    remote.map(async (provider) => {
      try {
        return { provider, candidates: await providers[provider](text, signal) }
      } catch (error) {
        const reason = Runtime.isFiberFailure(error)
          ? Cause.squash(error[Runtime.FiberFailureCauseId])
          : error
        return { provider, candidates: [], code: getApiErrorCode(reason) }
      }
    })
  )
  const seen = new Set<string>()
  for (const batch of batches) {
    if (batch.code) result.errors.push({ provider: batch.provider, code: batch.code })
    for (const candidate of batch.candidates) {
      const key = `${candidate.source}:${candidate.id}`
      if (seen.has(key)) continue
      seen.add(key)
      const existing = library.find(
        (song) =>
          (song.source?.provider === candidate.source && song.source.id === candidate.id) ||
          (normalize(song.title) === normalize(candidate.title) &&
            normalize(song.artist) === normalize(candidate.artist))
      )
      const localIndex = existing
        ? result.songs.findIndex(
            (entry) => entry.downloaded && entry.song.meta.id === existing.meta.id
          )
        : -1
      if (localIndex >= 0) result.songs.splice(localIndex, 1)
      const display = {
        provider: candidate.source,
        id: candidate.id,
        title: candidate.title,
        artist: candidate.artist,
        thumbnail: candidate.source === 'youtube' ? candidate.thumbnail : undefined,
        candidate
      }
      result.songs.push(
        existing
          ? { ...display, downloaded: true, song: existing }
          : { ...display, downloaded: false }
      )
    }
  }
  const ranked = rank(result.songs, text, 1)
  result.songs = [...ranked, ...result.songs.filter((entry) => !ranked.includes(entry))]
  return result
}
