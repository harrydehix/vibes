import { unwrapApiResult } from '@shared/errors'

export function useDialog(): { openFolder(): Promise<string | null> } {
  return { openFolder: () => window.api.dialog.openFolder().then(unwrapApiResult) }
}
