import type { ProgressInfo, UpdateInfo } from 'electron-updater'
import { inject, onMounted, onUnmounted, provide, ref } from 'vue'

export function useAutoUpdater() {
  const progress = ref<ProgressInfo | null>(null)
  const isDownloaded = ref(false)
  const updateInfo = ref<UpdateInfo | null>(null)

  const removeDownloadListener = ref<(() => void) | null>(null)
  const removeProgressListener = ref<(() => void) | null>(null)

  onMounted(() => {
    removeDownloadListener.value = window.api.updater.onDownloaded((update) => {
      isDownloaded.value = true
      updateInfo.value = update
    })
    removeProgressListener.value = window.api.updater.onProgress((updateProgress) => {
      progress.value = updateProgress
    })
  })

  onUnmounted(() => {
    if (removeDownloadListener.value) {
      removeDownloadListener.value()
    }
    if (removeProgressListener.value) {
      removeProgressListener.value()
    }
  })

  const autoUpdaterApi = {
    progress,
    isDownloaded,
    updateInfo,
    installUpdate: () => window.api.updater.install()
  }

  provide('autoUpdater', autoUpdaterApi)

  return autoUpdaterApi
}

export function accessAutoUpdater() {
  const autoUpdater = inject<ReturnType<typeof useAutoUpdater>>('autoUpdater')
  return autoUpdater!
}
