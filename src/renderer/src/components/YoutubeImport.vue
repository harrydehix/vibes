<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ImportCandidate, Song } from '@shared/types'
import { defaultCaptionTrackId } from '@shared/captionTracks'
import { useDownloader } from '@renderer/composables/useDownloader'
import { accessSongs } from '@renderer/composables/useSongs'
import { useSound } from '@renderer/composables/useSound'
import defaultCover from '@renderer/assets/cover-fallback.png'
import Popup from './Popup.vue'

const props = defineProps<{ video: Extract<ImportCandidate, { source: 'youtube' }> }>()
const emit = defineEmits<{ play: [song: Song]; close: [] }>()
const downloader = useDownloader()
const { songs } = accessSongs()
const sound = useSound()
const candidate = ref<Extract<ImportCandidate, { source: 'youtube' }> | null>(null)
const title = ref('')
const artist = ref('')
const captionTrackId = ref('')
const thumbnailFailed = ref(false)
const state = computed(() =>
  downloader.downloads.value.find(
    (entry) => entry.candidate.source === 'youtube' && entry.candidate.id === candidate.value?.id
  )
)
const downloading = computed(() => state.value?.status === 'downloading')
const localSong = computed(() =>
  songs.value.find(
    (song) => song.source?.provider === 'youtube' && song.source.id === candidate.value?.id
  )
)
const canDownload = computed(
  () =>
    candidate.value &&
    (candidate.value.lyricsInVideo === true || captionTrackId.value) &&
    title.value.trim() &&
    artist.value.trim() &&
    !downloading.value
)

watch(
  () => props.video,
  (video) => {
    thumbnailFailed.value = false
    candidate.value = video
    const cleanTitle = video.title
      .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    const metadata = cleanTitle.match(/^(.+?)\s+[-\u2013\u2014]\s+(.+)$/)
    title.value = metadata?.[2]?.trim() || cleanTitle || video.title
    artist.value = metadata?.[1]?.trim() || video.artist
    captionTrackId.value = video.lyricsInVideo ? '' : defaultCaptionTrackId(video.tracks)
  },
  { immediate: true }
)

async function confirm(): Promise<void> {
  if (localSong.value) emit('play', localSong.value)
  else await download()
}

async function download(): Promise<void> {
  if (!candidate.value || !canDownload.value) return
  const request = {
    candidate: { ...candidate.value, title: title.value.trim(), artist: artist.value.trim() },
    title: title.value,
    artist: artist.value
  }
  const result = await downloader.importSong(
    candidate.value.lyricsInVideo
      ? { ...request, lyricsInVideo: true }
      : { ...request, captionTrackId: captionTrackId.value }
  )
  if (result) sound.play('downloadSuccess')
}
</script>

<template>
  <Teleport to="body">
    <Popup
      title="Download YouTube song"
      icon="fa-youtube"
      :visible="true"
      :okText="
        localSong
          ? 'Play'
          : downloading
            ? `Downloading ${Math.floor((state?.progress ?? 0) * 100)}%`
            : state?.status === 'error'
              ? 'Retry download'
              : 'Download'
      "
      :okIcon="
        localSong ? 'fa-play' : state?.status === 'error' ? 'md-refresh' : 'md-clouddownload'
      "
      :okProgress="downloading ? (state?.progress ?? 0) : undefined"
      :okDisabled="!localSong && !canDownload"
      cancelText="Close"
      cancelIcon="io-close-sharp"
      @ok="confirm"
      @cancel="emit('close')"
    >
      <section :class="$style.importer" aria-label="YouTube song import">
        <div v-if="candidate" :class="$style.preview">
          <img
            :class="$style.thumbnail"
            :src="thumbnailFailed ? defaultCover : candidate.thumbnail || defaultCover"
            :alt="candidate.title"
            @error="thumbnailFailed = true"
          />
          <div :class="$style.fields">
            <label
              >Title<input v-model="title" :disabled="downloading || !!localSong" maxlength="200"
            /></label>
            <label
              >Artist<input v-model="artist" :disabled="downloading || !!localSong" maxlength="200"
            /></label>
            <label v-if="candidate.tracks.length"
              >Caption track
              <select v-model="captionTrackId" :disabled="downloading || !!localSong">
                <option v-for="track in candidate.tracks" :key="track.id" :value="track.id">
                  {{ track.name }} ({{ track.language }}) -
                  {{ track.automatic ? 'Automatic' : 'Creator-provided' }}
                </option>
              </select>
            </label>
            <p v-if="state?.status === 'error'" :class="$style.error" role="alert">
              {{ state.error }}
            </p>
          </div>
        </div>
      </section>
    </Popup>
  </Teleport>
</template>

<style lang="less" module>
.importer {
  width: 34rem;
  max-width: calc(100vw - 6rem);
  color: white;
  font-family: 'Outfit', sans-serif;
  input,
  select {
    font: inherit;
    font-size: 1.1rem;
    border-radius: 8px;
    box-sizing: border-box;
    min-width: 0;
  }
  input,
  select {
    padding: 0.8rem;
    border: 1px solid rgba(255, 255, 255, 0.3);
    color: white;
    background: rgba(0, 0, 0, 0.45);
    width: 100%;
    &:focus-visible {
      outline: 2px solid #eacb69;
      outline-offset: 2px;
    }
  }
  select option {
    background: #222;
  }
}
.preview {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr);
  gap: 2rem;
}
.thumbnail {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: contain;
  border-radius: 8px;
  background: black;
}
.fields {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
  label {
    display: grid;
    gap: 0.4rem;
  }
}
.error {
  color: #ffc2b8;
  overflow-wrap: anywhere;
  margin: 0.75rem 0;
}
@media (max-width: 760px) {
  .preview {
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
  }
  .thumbnail {
    max-height: 230px;
  }
}
</style>
