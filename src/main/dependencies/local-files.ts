import { protocol } from 'electron'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'

export function registerLocalScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'local',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true
      }
    }
  ])
}

export function defineLocalProtocol(): void {
  protocol.handle('local', (request) => {
    const actualPath = new URL(request.url).searchParams.get('path')
    if (!actualPath || !existsSync(actualPath))
      return new Response('File not found', { status: 404 })
    const total = statSync(actualPath).size
    const rangeHeader = request.headers.get('Range')
    let contentType = 'video/mp4'
    if (actualPath.endsWith('.webm')) contentType = 'video/webm'
    else if (actualPath.endsWith('.mkv')) contentType = 'video/x-matroska'
    else if (actualPath.endsWith('.mp3')) contentType = 'audio/mpeg'

    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1
      return new Response(
        Readable.toWeb(createReadStream(actualPath, { start, end })) as ReadableStream<Uint8Array>,
        {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(end - start + 1),
            'Content-Type': contentType
          }
        }
      )
    }
    return new Response(
      Readable.toWeb(createReadStream(actualPath)) as ReadableStream<Uint8Array>,
      {
        status: 200,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': String(total),
          'Content-Type': contentType
        }
      }
    )
  })
}
