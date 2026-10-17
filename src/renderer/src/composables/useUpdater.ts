import { inject, onMounted, onScopeDispose, provide, ref, type Ref } from 'vue'
import type { ProgressInfo, UpdateInfo } from 'electron-updater'
import { getApiErrorCode, unwrapApiResult, type ApiFailure } from '@shared/errors'

export type UpdaterState = {
  progress: Ref<ProgressInfo | null>
  isDownloaded: Ref<boolean>
  updateInfo: Ref<UpdateInfo | null>
  error: Ref<ApiFailure | null>
  checking: Ref<boolean>
  check(): Promise<UpdateInfo | null>
  install(): Promise<void>
}

export function useUpdater(): UpdaterState {
  const progress = ref<ProgressInfo | null>(null)
  const isDownloaded = ref(false)
  const updateInfo = ref<UpdateInfo | null>(null)
  const error = ref<ApiFailure | null>(null)
  const checking = ref(false)
  const unsubscribe: Array<() => void> = []

  async function check(): Promise<UpdateInfo | null> {
    checking.value = true
    error.value = null
    try {
      updateInfo.value = unwrapApiResult(await window.api.updater.check())
      return updateInfo.value
    } catch (cause) {
      error.value = { code: getApiErrorCode(cause, 'update_failed') }
      throw cause
    } finally {
      checking.value = false
    }
  }

  async function install(): Promise<void> {
    try {
      unwrapApiResult(await window.api.updater.install())
    } catch (cause) {
      error.value = { code: getApiErrorCode(cause, 'update_failed') }
      throw cause
    }
  }

  onMounted(() => {
    unsubscribe.push(
      window.api.updater.onAvailable((info) => {
        updateInfo.value = info
      }),
      window.api.updater.onProgress((info) => {
        progress.value = info
      }),
      window.api.updater.onDownloaded((info) => {
        isDownloaded.value = true
        updateInfo.value = info
      }),
      window.api.updater.onError((failure) => {
        error.value = failure
      })
    )
    void check().catch((cause) => console.error('Could not check for app updates:', cause))
  })
  onScopeDispose(() => unsubscribe.forEach((release) => release()))

  const updater = { progress, isDownloaded, updateInfo, error, checking, check, install }
  provide('updater', updater)
  return updater
}

export function accessUpdater(): ReturnType<typeof useUpdater> {
  const updater = inject<ReturnType<typeof useUpdater>>('updater')
  if (!updater) throw new Error('Updater has not been provided')
  return updater
}
