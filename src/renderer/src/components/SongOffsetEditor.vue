<script setup lang="ts">
import { accessSongPlayer } from '@renderer/composables/useSongPlayer'
import { accessSongs } from '@renderer/composables/useSongs'
import { onKeyStroke } from '@vueuse/core'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'

const player = accessSongPlayer()
const songs = accessSongs()
const opened = ref(false)
const draft = ref('')
const saving = ref(false)
const error = ref<string | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)
let previousFocus: HTMLElement | null = null
let appliedOffsetMs: number | null = null
let refreshNeeded = false
let unmounted = false

const offsetMs = computed(() => {
  const text = draft.value.trim()
  const value = Number(text)
  return text && Number.isFinite(value) ? value : null
})

watch(offsetMs, (value) => {
  if (opened.value && value !== null) player.songOffsetPreviewMs.value = value
  error.value = null
})

function close(): void {
  if (saving.value) return
  opened.value = false
  player.songOffsetPreviewMs.value = appliedOffsetMs
  if (previousFocus?.isConnected) previousFocus.focus()
}

onKeyStroke(['f', 'F'], async (event) => {
  const target = event.target instanceof HTMLElement ? event.target : null
  if (
    event.repeat ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    target?.closest('input, textarea, select, [contenteditable]') ||
    player.pausedByUser.value ||
    !player.currentSong.value
  )
    return
  event.preventDefault()
  if (opened.value) {
    close()
    return
  }
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const currentOffsetMs = appliedOffsetMs ?? player.currentSong.value.fixOffsetMs ?? 0
  draft.value = String(currentOffsetMs)
  player.songOffsetPreviewMs.value = currentOffsetMs
  error.value = null
  opened.value = true
  await nextTick()
  inputRef.value?.focus()
  inputRef.value?.select()
})

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  }
}

async function apply(): Promise<void> {
  const song = player.currentSong.value
  const value = offsetMs.value
  if (!song || value === null || saving.value) return
  saving.value = true
  error.value = null
  try {
    await songs.fixOffset(song, value)
    refreshNeeded = true
    if (!unmounted && player.currentSong.value?.meta.id === song.meta.id) {
      appliedOffsetMs = value
      opened.value = false
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  } catch (cause) {
    console.error('Song offset save failed:', cause)
    if (!unmounted) error.value = 'Could not save the song offset. Try again.'
  } finally {
    saving.value = false
    if (unmounted) refreshSavedSongs()
  }
}

watch(
  () => player.currentSong.value?.meta.id,
  () => {
    opened.value = false
    appliedOffsetMs = null
    player.songOffsetPreviewMs.value = null
  }
)

function refreshSavedSongs(): void {
  if (!refreshNeeded) return
  refreshNeeded = false
  void songs.refresh().catch((cause) => {
    console.error('Could not reload saved song offsets:', cause)
  })
}

onUnmounted(() => {
  unmounted = true
  player.songOffsetPreviewMs.value = null
  if (!saving.value) refreshSavedSongs()
})
</script>

<template>
  <form
    v-if="opened"
    :class="$style.editor"
    aria-label="Song offset"
    @submit.prevent="apply"
    @keydown.stop="handleKeydown"
    @keyup.stop
  >
    <div :class="$style.header">
      <label for="song-offset-ms">Song Offset</label>
      <button
        type="button"
        :class="$style.close"
        :disabled="saving"
        title="Close"
        aria-label="Close song offset"
        @click="close"
      >
        <v-icon name="io-close-sharp" aria-hidden="true" />
      </button>
    </div>
    <div :class="$style.controls">
      <div :class="$style.input">
        <input
          id="song-offset-ms"
          ref="inputRef"
          :value="draft"
          type="number"
          step="any"
          inputmode="decimal"
          :disabled="saving"
          :aria-invalid="offsetMs === null"
          @input="draft = ($event.target as HTMLInputElement).value"
        />
        <span>ms</span>
      </div>
      <button
        type="submit"
        :class="$style.apply"
        :disabled="saving || offsetMs === null"
        :aria-busy="saving"
      >
        <v-icon name="md-downloaddone-outlined" aria-hidden="true" />
        Apply
      </button>
    </div>
    <p v-if="error" :class="$style.error" role="alert">{{ error }}</p>
  </form>
</template>

<style lang="less" module>
.editor {
  position: fixed;
  bottom: 1rem;
  right: 1rem;
  width: min(34rem, calc(100vw - 2rem));
  box-sizing: border-box;
  padding: 1rem;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.92);
  color: white;
  font-family: 'Outfit', sans-serif;
  z-index: 10000;
  cursor: auto;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
  font-size: 1.1rem;
}

.close {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: white;
  cursor: pointer;

  svg {
    width: 1.5rem;
    height: 1.5rem;
  }
}

.controls {
  display: flex;
  align-items: stretch;
  gap: 0.75rem;
}

.input {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.75rem;
  border-radius: 4px;
  background: white;
  color: black;

  input {
    width: 100%;
    min-width: 0;
    height: 4rem;
    padding: 0;
    border: none;
    outline: none;
    background: transparent;
    font: inherit;
    font-size: 2rem;
  }

  &:focus-within {
    outline: 2px solid #9c62ff;
    outline-offset: 2px;
  }
  span {
    font-size: 1.1rem;
  }
}

.apply {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0 1rem;
  border: none;
  border-radius: 4px;
  background: #500ec3;
  color: white;
  font: inherit;
  font-size: 1.25rem;
  cursor: pointer;

  svg {
    width: 1.5rem;
    height: 1.5rem;
  }
}

.editor button:disabled {
  opacity: 0.5;
  cursor: default;
}
.error {
  margin: 0.75rem 0 0;
  color: #ffb4b4;
  overflow-wrap: anywhere;
}
</style>
