const accountCookieNames = new Set([
  'SID',
  'SAPISID',
  '__Secure-1PSID',
  '__Secure-3PSID',
  '__Secure-1PAPISID',
  '__Secure-3PAPISID'
])

export function parseYoutubeCookies(content: string, now = Date.now()): string {
  if (Buffer.byteLength(content, 'utf8') > 1024 * 1024) {
    throw new Error('The cookie file is too large. Export only youtube.com cookies.')
  }
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (!/^# (?:Netscape HTTP Cookie File|HTTP Cookie File)/.test(lines[0] ?? '')) {
    throw new Error('Please choose a Netscape-format cookie file exported from YouTube.')
  }
  const cookies: string[] = []
  let hasAccountCookie = false
  for (const line of lines.slice(1)) {
    if (!line.trim() || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) continue
    const columns = line.replace(/^#HttpOnly_/, '').split('\t')
    if (columns.length !== 7) throw new Error('The cookie file contains an invalid entry.')
    const [domain, subdomains, path, secure, expires, name, value] = columns
    const host = domain.replace(/^\./, '').toLowerCase()
    if (host !== 'youtube.com' && !host.endsWith('.youtube.com')) continue
    if (
      !/^(TRUE|FALSE)$/.test(subdomains) ||
      !/^(TRUE|FALSE)$/.test(secure) ||
      !path.startsWith('/') ||
      !/^\d+$/.test(expires) ||
      !Number.isSafeInteger(Number(expires)) ||
      !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) ||
      /[\r\n\0]/.test(value)
    ) {
      throw new Error('The cookie file contains an invalid YouTube cookie.')
    }
    if (Number(expires) !== 0 && Number(expires) * 1000 <= now) continue
    cookies.push(line)
    if (accountCookieNames.has(name) && value.trim()) hasAccountCookie = true
  }
  if (!hasAccountCookie) {
    throw new Error('No active YouTube sign-in was found. Sign in and export fresh cookies.')
  }
  return ['# Netscape HTTP Cookie File', ...cookies, ''].join('\n')
}

export function requiresYoutubeAuthentication(message: string): boolean {
  return /HTTP Error 429|Too Many Requests|sign in to confirm|log ?in required|login_required|cookies (?:are )?no longer valid|cookies have expired|no active YouTube sign-in/i.test(
    message
  )
}
