<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { accessSettings } from '@renderer/composables/useSettings'
import type { YoutubeAuthStatus } from '@shared/types'
import Popup from './Popup.vue'
import LoadingSpinner from './LoadingSpinner.vue'

const props = withDefaults(defineProps<{ manual?: boolean }>(), { manual: false })
const emit = defineEmits<{ (event: 'close'): void }>()
const { settings } = accessSettings()
const visible = ref(props.manual)
const dismissed = ref(false)
const busy = ref(false)
const message = ref<string | null>(null)
let unsubscribe: (() => void) | undefined
let active = true
let changes = 0
let ready = false

watch(
  () => settings.value?.youtubeSignInDismissed,
  (value) => {
    if (value && !props.manual) visible.value = false
  }
)

function updateStatus(status: YoutubeAuthStatus): void {
  visible.value =
    props.manual ||
    (ready && !status.authenticated && !dismissed.value && !settings.value?.youtubeSignInDismissed)
  message.value = status.message
}

async function closePopup(): Promise<void> {
  dismissed.value = true
  visible.value = false
  if (settings.value) settings.value.youtubeSignInDismissed = true
  emit('close')
  try {
    await window.api.settings.update({ youtubeSignInDismissed: true })
  } catch {
    console.error('Could not save the YouTube sign-in popup preference.')
  }
}

async function perform(operation: () => Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await operation()
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'Could not connect to YouTube.'
  } finally {
    busy.value = false
  }
}

function openBrowser(): void {
  void perform(() => window.api.youtubeAuth.openBrowser())
}

function openHelp(): void {
  void perform(() => window.api.youtubeAuth.openHelp())
}

function importCookies(): void {
  void perform(async () => {
    const status = await window.api.youtubeAuth.importCookies()
    if (!active) return
    if (status.authenticated) await closePopup()
    else updateStatus(status)
  })
}

onMounted(async () => {
  unsubscribe = window.api.youtubeAuth.onChanged((status) => {
    changes++
    updateStatus(status)
  })
  const version = changes
  try {
    const saved = await window.api.settings.get()
    if (!active) return
    dismissed.value = saved.youtubeSignInDismissed === true
    if (settings.value) settings.value.youtubeSignInDismissed = dismissed.value
    ready = true
    if (dismissed.value && !props.manual) return
    const status = await window.api.youtubeAuth.status()
    if (active && changes === version) updateStatus(status)
  } catch {
    ready = true
    if (active)
      updateStatus({ authenticated: false, message: 'Could not check your YouTube session.' })
  }
})

onUnmounted(() => {
  active = false
  unsubscribe?.()
})
</script>

<template>
  <Popup
    title="Sign in to YouTube"
    icon="fa-youtube"
    :visible="visible"
    okText="Open YouTube"
    :cancelText="props.manual ? 'Done' : 'No thanks'"
    @ok="openBrowser"
    @cancel="closePopup"
  >
    <div :class="$style.body">
      <p>Sign-in is optional. You can continue without a YouTube account.</p>
      <p>
        Sign in in your browser, then import your exported youtube.com cookies (Netscape format).
      </p>
      <p v-if="message" :class="$style.error" role="alert">{{ message }}</p>
      <button :class="$style.importButton" :disabled="busy" @click="importCookies">
        <LoadingSpinner v-if="busy" compact />
        <v-icon v-else name="md-filedownload-sharp" />
        {{ busy ? 'Checking session...' : 'Import cookies' }}
      </button>
      <button :class="$style.helpButton" :disabled="busy" @click="openHelp">
        Cookie export instructions
      </button>
      <p :class="$style.notice">
        Cookies grant access to your account. vibes stores them encrypted on this device. YouTube
        may restrict accounts used for downloading; HTTP 429 may still require waiting.
      </p>
    </div>
  </Popup>
</template>

<style lang="less" module>
.body {
  width: 28rem;
  max-width: calc(100vw - 6rem);
  display: flex;
  flex-direction: column;
  gap: 1rem;
  overflow-wrap: anywhere;

  p {
    margin: 0;
    font-size: 1.1rem;
    line-height: 1.5;
  }
}

.importButton {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  min-height: 3rem;
  padding: 0.75rem 1rem;
  border: none;
  border-radius: 0.5rem;
  font-size: 1.1rem;
  font-weight: 500;
  background: white;
  color: black;
  cursor: pointer;

  svg {
    width: 1.5rem;
    height: 1.5rem;
  }

  &:disabled {
    background: rgba(0, 0, 0, 0.3);
    color: white;
    cursor: wait;
  }
}

.helpButton {
  border: none;
  padding: 0;
  background: transparent;
  color: white;
  text-align: left;
  text-decoration: underline;
  font-size: 1rem;
  cursor: pointer;
}

.error {
  padding: 0.75rem;
  border-radius: 0.5rem;
  background: rgba(0, 0, 0, 0.25);
}

.body .notice {
  font-size: 0.9rem;
  opacity: 0.85;
}
</style>
