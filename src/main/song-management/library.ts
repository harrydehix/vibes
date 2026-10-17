import { parseSongFile } from './formats/ultrastar'
import { lstat, readdir, readFile, realpath, rm, writeFile } from 'fs/promises'
import { SongMetadataUpdateSchema, VibesSongMetaSchema } from '../../shared/types'
import type { Song, SongMetadataUpdate, VibesSongMeta } from '../../shared/types'
import { settingsManager } from '../settings/index'
import { ApiError } from '../../shared/errors'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { parseSongManifest, parseSongSource, songManifestFile } from './formats/manifest'

class SongManager {
  _songs: Song[]
  private _refreshPromise: Promise<void> | null = null
  private updates = new Map<string, Promise<VibesSongMeta>>()

  constructor() {
    this._songs = []
  }

  get songs(): Song[] {
    return this._songs
  }

  async getSongs(): Promise<Song[]> {
    await Promise.allSettled(this.updates.values())
    await this._refresh()
    return this._songs
  }

  async addSong(folder: string): Promise<Song> {
    if (this._refreshPromise) await this._refreshPromise
    const song = await this.loadSong(folder, this._songs.length)
    const existing = this._songs.find(
      (entry) => path.resolve(entry.folder) === path.resolve(folder)
    )
    if (existing) return existing
    this._songs.push(song)
    return song
  }

  async deleteSong(id: string): Promise<Song[]> {
    await this.updates.get(id)?.catch(() => {})
    await this._deleteSong(id)
    return this._songs
  }

  async updateSong(id: string, patch: SongMetadataUpdate): Promise<VibesSongMeta> {
    const validated = SongMetadataUpdateSchema.safeParse(patch)
    if (typeof id !== 'string' || !id || !validated.success) throw new ApiError('invalid_request')
    const previous = this.updates.get(id) ?? Promise.resolve()
    const pending = previous
      .catch(() => {})
      .then(async () => {
        if (this._refreshPromise) await this._refreshPromise
        const matches = this._songs.filter((song) => song.meta.id === id)
        if (matches.length !== 1) throw new ApiError('song_not_found')
        const song = matches[0]
        const meta = VibesSongMetaSchema.parse({ ...song.meta, ...validated.data })
        await writeFile(path.join(song.folder, 'meta.vibes'), JSON.stringify(meta), 'utf-8')
        Object.assign(song.meta, meta)
        return meta
      })
    this.updates.set(id, pending)
    try {
      return await pending
    } finally {
      if (this.updates.get(id) === pending) this.updates.delete(id)
    }
  }

  /** Resolve an existing identity, never a renderer-supplied filesystem path. */
  private async _deleteSong(id: string): Promise<void> {
    if (typeof id !== 'string' || !id) throw new ApiError('invalid_request')
    if (this._refreshPromise) await this._refreshPromise
    const matches = this._songs.filter((song) => song.meta.id === id)
    if (matches.length !== 1) throw new ApiError('song_not_found')
    const song = matches[0]
    const folder = path.resolve(song.folder)
    const info = await lstat(folder)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new ApiError('unsafe_path')
    const realFolder = await realpath(folder)
    // Physical immediate children only: never delete a library root or follow a directory link.
    const roots = await Promise.all(
      settingsManager.settings.songFolders.map((root) => realpath(root).catch(() => null))
    )
    if (roots.includes(realFolder) || !roots.includes(path.dirname(realFolder)))
      throw new ApiError('unsafe_path')
    await rm(folder, { recursive: true, maxRetries: 3, retryDelay: 100 })
    if (this._refreshPromise) await this._refreshPromise
    this._songs = this._songs
      .filter((entry) => path.resolve(entry.folder) !== folder)
      .map((entry, index) => ({ ...entry, index }))
  }

  async loadSong(folder: string, index: number): Promise<Song> {
    // find every *.txt file in folder
    const files = await readdir(folder, { withFileTypes: true })
    const manifestFile = files.find((file) => file.isFile() && file.name === songManifestFile)
    const songFilePath = files.filter((file) => file.isFile() && file.name.endsWith('.txt'))[0]
    if (!manifestFile && !songFilePath) {
      throw new Error(`No song manifest or UltraStar file found in folder: ${folder}`)
    }
    const songFile = await readFile(
      path.join(folder, (manifestFile ?? songFilePath)!.name),
      'utf-8'
    )
    let fixOffset = 0
    try {
      const offsetContent = await readFile(`${folder}/offset.fix`, 'utf-8')
      const offset = Number(offsetContent.trim())
      if (Number.isFinite(offset)) fixOffset = offset
    } catch (_) {}

    let meta: VibesSongMeta
    try {
      const metaContent = await readFile(`${folder}/meta.vibes`, 'utf-8')
      meta = VibesSongMetaSchema.parse(JSON.parse(metaContent))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      meta = { playCount: 0, favorite: false, id: uuidv4() }
      await writeFile(`${folder}/meta.vibes`, JSON.stringify(meta), 'utf-8')
    }

    if (typeof meta.fixOffsetMs === 'number' && Number.isFinite(meta.fixOffsetMs)) {
      fixOffset = meta.fixOffsetMs
    }

    const parsedSong = manifestFile
      ? parseSongManifest(songFile, folder, index, fixOffset, meta)
      : parseSongFile(songFile, folder, index, fixOffset, meta)
    if (!manifestFile) {
      try {
        parsedSong.source = parseSongSource(
          JSON.parse(await readFile(path.join(folder, 'source.vibes'), 'utf-8'))
        )
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.warn(`Could not read song provenance: ${folder}`, error)
        }
      }
    }
    console.log(
      `Loaded song: ${parsedSong.title} by ${parsedSong.artist} (index: ${parsedSong.index}, id: ${parsedSong.meta.id})`
    )
    return parsedSong
  }

  private async _refresh() {
    if (this._refreshPromise) return this._refreshPromise

    this._refreshPromise = (async () => {
      const newSongs: Song[] = []
      try {
        // loop through folder and look for songs
        const songFolders = settingsManager.settings.songFolders

        let songIndex = 0
        for (const folder of songFolders) {
          const songs = await readdir(folder, { withFileTypes: true, recursive: false }).catch(
            (error: NodeJS.ErrnoException) => {
              if (error.code === 'ENOENT') return []
              throw error
            }
          )
          for (let i = 0; i < songs.length; i++) {
            const song = songs[i]
            if (!song.isDirectory() || song.name.startsWith('.import-')) continue
            try {
              const parsedSong = await this.loadSong(`${folder}/${song.name}`, songIndex)
              newSongs.push(parsedSong)
              songIndex++
            } catch (error) {
              console.warn(`Error loading song: ${folder}/${song.name}`, error)
            }
          }
          console.log(`Loaded ${newSongs.length} songs from ${folder}`)
        }
        this._songs = newSongs
      } finally {
        this._refreshPromise = null
      }
    })()

    return this._refreshPromise
  }
}

export const songManager = new SongManager()
