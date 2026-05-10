<script setup lang="ts">
import { useAutoUpdater } from '@renderer/composables/useAutoUpdater'
import { ref, useCssModule, watch } from 'vue'
import Popup from './Popup.vue'

const $style = useCssModule()
const autoUpdater = useAutoUpdater()
const isVisible = ref(false)

watch(
  () => autoUpdater.updateInfo.value,
  (newInfo) => {
    if (newInfo) {
      isVisible.value = true
    }
  },
  { immediate: true }
)

function closePopup() {
  isVisible.value = false
}

function installNow() {
  autoUpdater.installUpdate()
}
</script>
<template>
  <Popup
    title="New update available!"
    icon="md-keyboarddoublearrowup-round"
    :visible="isVisible"
    okText="Install now"
    cancelText="Later"
    @ok="installNow"
    @cancel="closePopup"
  >
    <p :class="$style.text">
      There is a new version of vibes (<span :class="$style.version"
        >v{{ autoUpdater.updateInfo.value?.version }}</span
      >) available. Read more
      <a
        :href="`https://github.com/harrydehix/vibes/releases/tag/v${autoUpdater.updateInfo.value?.version}`"
        target="_blank"
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
