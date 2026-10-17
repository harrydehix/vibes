import { unwrapApiResult } from '@shared/errors'
import type { YoutubeAuthStatus } from '@shared/types'
import type { AppAPI } from '@shared/api'

export function useYoutubeAuth(): {
  status(): Promise<YoutubeAuthStatus>
  openBrowser(): Promise<void>
  openHelp(): Promise<void>
  importCookies(): Promise<YoutubeAuthStatus>
  signOut(): Promise<YoutubeAuthStatus>
  onChanged: AppAPI['youtubeAuth']['onChanged']
} {
  const api = window.api.youtubeAuth
  return {
    status: () => api.status().then(unwrapApiResult),
    openBrowser: () => api.openBrowser().then(unwrapApiResult),
    openHelp: () => api.openHelp().then(unwrapApiResult),
    importCookies: () => api.importCookies().then(unwrapApiResult),
    signOut: () => api.signOut().then(unwrapApiResult),
    onChanged: api.onChanged
  }
}
