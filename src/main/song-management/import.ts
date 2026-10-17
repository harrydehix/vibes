import { access, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SongImportResult, ImportCandidate, SongImportRequest } from '../../shared/types'
import { DownloadError } from '../../shared/errors'
import { downloadUsdbSong } from './providers/usdb/index'
import { importYoutube } from './providers/youtube/index'

type ImportProvider = (
  request: SongImportRequest,
  folder: string,
  onProgress: (progress: number) => void
) => Promise<string>

const providers: Record<ImportCandidate['source'], ImportProvider> = {
  usdb: async (request, folder, onProgress) => {
    if (request.candidate.source !== 'usdb')
      throw new DownloadError('invalid_request', 'Invalid USDB import request')
    if (String(request.candidate.song.apiId) !== request.candidate.id)
      throw new DownloadError('invalid_request', 'Invalid USDB song identity')
    const result = await downloadUsdbSong({
      song: request.candidate.song,
      cookie: '',
      baseDir: folder,
      onProgress
    })
    return result.songDir
  },
  youtube: async (request, folder, onProgress) => {
    if (!('title' in request) || request.candidate.source !== 'youtube')
      throw new DownloadError('invalid_request', 'Invalid YouTube import request')
    await importYoutube(request, folder, onProgress)
    return folder
  }
}

const activeImports = new Set<string>()

/** Stage a complete import, then publish by rename. Failures never leave a partial library entry. */
export async function importSong(
  request: SongImportRequest,
  baseDir: string,
  onProgress: (progress: number) => void,
  prepare?: (folder: string) => Promise<unknown>
): Promise<SongImportResult> {
  const candidate = request?.candidate
  if (
    !candidate ||
    !Object.hasOwn(providers, candidate.source) ||
    !/^[a-zA-Z0-9_-]+$/.test(candidate.id)
  ) {
    throw new DownloadError('invalid_request', 'Unsupported song source or invalid identity')
  }
  const dirName = `${candidate.source}-${candidate.id}`
  const songDir = join(baseDir, dirName)
  if (activeImports.has(dirName))
    throw new DownloadError('import_in_progress', 'This song is already being imported')
  activeImports.add(dirName)
  let staging: string | undefined
  try {
    await mkdir(baseDir, { recursive: true })
    const exists = await access(songDir).then(
      () => true,
      () => false
    )
    if (exists) throw new DownloadError('already_imported', 'This song has already been imported')
    staging = await mkdtemp(join(baseDir, '.import-'))
    onProgress(0)
    const preparedFolder = await providers[candidate.source](request, staging, (progress) => {
      // Reserve 100% for the commit, not just completion of the provider's media download.
      if (Number.isFinite(progress)) onProgress(Math.max(0, Math.min(0.99, progress)))
    })
    await writeFile(
      join(preparedFolder, 'source.vibes'),
      JSON.stringify({
        provider: candidate.source,
        id: candidate.id,
        url: candidate.source === 'youtube' ? candidate.url : undefined
      }),
      'utf8'
    )
    await prepare?.(preparedFolder)
    await rename(preparedFolder, songDir)
    onProgress(1)
    return { dirName, songDir }
  } finally {
    activeImports.delete(dirName)
    if (staging) await rm(staging, { recursive: true, force: true })
  }
}
