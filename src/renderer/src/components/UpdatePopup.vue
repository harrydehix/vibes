<script setup lang="ts">
import { accessUpdater } from '@renderer/composables/useUpdater'
import { getApiErrorMessage } from '@shared/errors'
import { ref, useCssModule, watch } from 'vue'
import Popup from './Popup.vue'

const $style = useCssModule()
const autoUpdater = accessUpdater()
const isVisible = ref(false)

watch(
  () => autoUpdater.isDownloaded.value,
  (downloaded) => {
    if (downloaded) {
      isVisible.value = true
    }
  },
  { immediate: true }
)

function closePopup() {
  isVisible.value = false
}

function installNow() {
  void autoUpdater.install().catch((error) => console.error('Could not install app update:', error))
}
</script>
<template>
  <Popup
    title="New update available!"
    icon="md-keyboarddoublearrowup-round"
    :visible="isVisible"
    okText="Install now"
    :okDisabled="!autoUpdater.isDownloaded.value"
    cancelText="Later"
    @ok="installNow"
    @cancel="closePopup"
  >
    <p v-if="autoUpdater.error.value" role="alert">
      {{ getApiErrorMessage(autoUpdater.error.value.code) }}
    </p>
    <p :class="$style.text">
      There is a new version of vibes (<span :class="$style.version"
        >v{{ autoUpdater.updateInfo.value?.version }}</span
      >) available. Read more
      <a
        :href="`https://github.com/harrydehix/vibes/releases/tag/v${autoUpdater.updateInfo.value?.version}`"
        target="_blank"
        rel="noopener noreferrer"
        >here</a
      >.
    </p>
  </Popup>
</template>
<style lang="less" module>
.text {
  margin: 0;
  font-size: 1.1rem;

  .version {
    font-weight: 500;
  }

  a {
    color: white;
    text-decoration: none;
    font-weight: 500;
    text-decoration: underline;

    &:hover {
      text-decoration: underline;
    }

    &:visited {
      color: white;
    }
  }
}
</style>
