import type { ImportCandidate } from '../../../shared/types'

export type SearchProvider = {
  name: string
  search: (query: string) => Promise<ImportCandidate[]>
}

export type SourceSearchResult = {
  candidates: ImportCandidate[]
  errors: string[]
  pending: number
}

export async function searchSources(
  query: string,
  providers: SearchProvider[],
  onResult?: (result: SourceSearchResult) => void
): Promise<SourceSearchResult> {
  const results: ImportCandidate[][] = providers.map(() => [])
  const errors: string[] = providers.map(() => '')
  let pending = providers.length
  const snapshot = (): SourceSearchResult => ({
    candidates: [
      ...new Map(
        results.flat().map((candidate) => [`${candidate.source}:${candidate.id}`, candidate])
      ).values()
    ],
    errors: errors.filter(Boolean),
    pending
  })
  if (!query.trim()) return { candidates: [], errors: [], pending: 0 }
  await Promise.all(
    providers.map(async (provider, index) => {
      try {
        results[index] = await provider.search(query)
      } catch (error) {
        errors[index] =
          `${provider.name}: ${error instanceof Error ? error.message : 'Search unavailable'}`
      }
      pending--
      onResult?.(snapshot())
    })
  )
  return snapshot()
}
