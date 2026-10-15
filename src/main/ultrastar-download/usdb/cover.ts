import { Effect } from 'effect'
import { USDB_API_URL } from './config.js'

/* Code by: https://github.com/martiinii/UltraStar-CLI */

/**
 * Download song cover image bytes by id.
 * Returns null if the image is not available (non-ok response).
 */
export const downloadUsdbCoverById = (
  id: number,
  cookie?: string
): Effect.Effect<Uint8Array | null, Error, never> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: async () =>
        await fetch(`${USDB_API_URL}/data/cover/${id}.jpg`, {
          method: 'GET',
          headers: {
            ...(cookie ? { Cookie: cookie } : {})
          }
        }),
      catch: (e) => (e instanceof Error ? e : new Error('Failed to fetch cover'))
    })

    if (!response.ok) {
      return null
    }

    const buffer = yield* Effect.tryPromise({
      try: async () => new Uint8Array(await response.arrayBuffer()),
      catch: (e) => (e instanceof Error ? e : new Error('Failed to read cover bytes'))
    })

    return buffer
  })
