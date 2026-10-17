<script setup lang="ts">
import { accessSongManagement } from '@renderer/composables/useSongManagement'
import { useSound } from '@renderer/composables/useSound'
import router from '@renderer/router'
import { accessLocalFile } from '@renderer/utils/accessLocalFile'
import type { Song, ImportCandidate } from '@shared/types'
import { computed, ref, watch, onUnmounted, useCssModule, onMounted } from 'vue'
import gsap from 'gsap'
import { accessBackgroundMusic } from '@renderer/composables/useBackgroundMusic'
import LoadingSpinner from '@renderer/components/LoadingSpinner.vue'
import { useRoute } from 'vue-router'
import { getApiErrorMessage } from '@shared/errors'
import { onKeyStroke } from '@vueuse/core'
import defaultCover from '@renderer/assets/cover-fallback.png'
import YoutubeImport from '@renderer/components/YoutubeImport.vue'

const management = accessSongManagement()
const {
  songs,
  query: search,
  selectedYoutube,
  searching: onlineLoading,
  searchingLocal: locallyLoading,
  localResults: locallySearchedSongs,
  availableResults: availableForDownloadSongs
} = management
search.value = ''
const $style = useCssModule()
const sound = useSound()
const backgroundMusic = accessBackgroundMusic()

const emptyState = computed(() => {
  return songs.value.length === 0 && search.value === ''
})

const gsapScope = ref<null | HTMLElement>(null)
let ctx: gsap.Context

watch(gsapScope, (container) => {
  if (container) {
    ctx?.revert()
    ctx = gsap.context(() => {
      gsap.to(container, {
        opacity: 1,
        duration: 0.4,
        ease: 'power2.out'
      })
      gsap.to(`.${$style.results}`, {
        opacity: 1,
        y: 0,
        duration: 0.4,
        ease: 'power2.out'
      })
    }, container)
  }
})

onMounted(() => {
  backgroundMusic.enable()
})

onUnmounted(() => {
  ctx?.revert()
  management.cancelSearch()
  search.value = ''
  selectedYoutube.value = null
})

onKeyStroke('Escape', () => {
  if (selectedYoutube.value) {
    selectedYoutube.value = null
    return
  }
  navigateToList(false)
})

const route = useRoute()
const previousSongIndex = computed(() => {
  const index = route.query.songIndex ? parseInt(route.query.songIndex as string) : null
  return index !== null && !isNaN(index) ? index : null
})

const searchErrors = computed(() =>
  management.searchErrors.value.map(
    (error) => `${error.provider ? `${error.provider}: ` : ''}${getApiErrorMessage(error.code)}`
  )
)
const availableResults = computed(() =>
  availableForDownloadSongs.value.map((candidate) => ({
    candidate,
    downloadState: management.downloads.value.find(
      (entry) => entry.candidate.source === candidate.source && entry.candidate.id === candidate.id
    ),
    localSong: songs.value.find(
      (song) => song.source?.provider === candidate.source && song.source.id === candidate.id
    )
  }))
)
async function playLocalSong(song: Song): Promise<void> {
  if (song) {
    sound.play('click')
    console.log('Selected local song:', song.title, 'by', song.artist)
    fadeOut(() => {
      router.push({
        path: '/song-player',
        query: { songIndex: song.index }
      })
    })
  }
}

function navigateToList(withSound = true): void {
  if (withSound) {
    sound.play('click')
  }
  fadeOut(() => {
    router.push({ path: '/song-list', query: { songIndex: previousSongIndex.value } })
  })
}

function fadeOut(callback: () => void): void {
  if (gsapScope.value) {
    gsap.to(gsapScope.value, {
      opacity: 0,
      duration: 0.3,
      ease: 'power2.in',
      onComplete: callback
    })
  } else {
    callback()
  }
}

async function downloadSong(candidate: ImportCandidate): Promise<void> {
  if (candidate.source === 'youtube') {
    selectedYoutube.value = candidate
    return
  }
  try {
    await management.downloadSong({ candidate })
    sound.play('downloadSuccess')
  } catch (error) {
    console.error('Song download failed:', error)
  }
}

function displayText(value: string): string {
  return value.replace(/&amp;/g, '&')
}

const input = ref<HTMLInputElement | null>(null)

watch(
  input,
  (el) => {
    if (el) {
      el.focus()
    }
  },
  { immediate: true }
)
</script>

<template>
  <div :class="$style.search" ref="gsapScope">
    <div :class="$style.header">
      <div :class="$style.searchBar">
        <v-icon name="fa-search"></v-icon>
        <input
          ref="input"
          v-model="search"
          type="text"
          placeholder="Search for a song, artist or YouTube link..."
        />
      </div>
      <div :class="$style.goToSongList" v-if="songs?.length > 0" @click="navigateToList()">
        <v-icon name="ri-arrow-go-back-line"></v-icon>
      </div>
    </div>
    <div :class="$style.resultsBox">
      <div :class="$style.results">
        <Transition
          :enter-active-class="$style.fadeEnterActive"
          :leave-active-class="$style.fadeLeaveActive"
          :enter-from-class="$style.fadeEnterFrom"
          :leave-to-class="$style.fadeLeaveTo"
          mode="out-in"
        >
          <div v-if="emptyState" :class="$style.emptyState">
            <v-icon name="si-starship"></v-icon>
            Search for any song!
          </div>
          <div v-else :class="$style.resultsContainer">
            <div :class="$style.locallyDownloaded" v-if="locallySearchedSongs.length > 0">
              <div :class="$style.localBar">
                <div :class="$style.banner">
                  <v-icon name="md-filedownload-sharp"></v-icon>
                  Downloaded Songs ({{ locallySearchedSongs.length }})
                </div>
              </div>

              <Transition
                :enter-active-class="$style.fadeEnterActive"
                :leave-active-class="$style.fadeLeaveActive"
                :enter-from-class="$style.fadeEnterFrom"
                :leave-to-class="$style.fadeLeaveTo"
                mode="out-in"
              >
                <div v-if="locallyLoading" :class="$style.loadingContainer">
                  <LoadingSpinner />
                </div>
                <div v-else :class="$style.resultList">
                  <div
                    v-for="song in locallySearchedSongs"
                    :key="song.index"
                    :class="$style.localSongResult"
                    @click="playLocalSong(song)"
                  >
                    <img
                      :src="song.cover ? accessLocalFile(song.cover) : defaultCover"
                      alt="thumbnail"
                    />
                    <div :class="$style.songInfo">
                      <div :class="$style.songTitle">{{ song.title }}</div>
                      <div :class="$style.songArtist">{{ song.artist }}</div>
                    </div>
                  </div>
                </div>
              </Transition>
            </div>
            <div :class="$style.availableForDownload" v-if="search !== ''">
              <div :class="$style.onlineBar">
                <div :class="$style.banner">
                  <v-icon name="md-clouddownload"></v-icon>
                  Available for download
                </div>
                <span
                  v-if="onlineLoading && availableResults.length > 0"
                  :class="$style.searchActivity"
                  role="status"
                  aria-label="Searching remaining sources"
                >
                  <LoadingSpinner compact />
                </span>
              </div>
              <div
                v-if="onlineLoading && availableResults.length === 0"
                :class="$style.loadingContainer"
                role="status"
                aria-label="Searching songs"
              >
                <LoadingSpinner />
              </div>
              <p
                v-for="error in searchErrors"
                :key="error"
                :class="$style.sourceError"
                role="status"
              >
                {{ error }}
              </p>
              <div v-if="!onlineLoading && availableResults.length === 0" :class="$style.noResults">
                <v-icon name="io-sad-sharp"></v-icon>
                Oupps... we don't know this song yet!
              </div>
              <div
                v-for="{ candidate, downloadState, localSong } in availableResults"
                :key="`${candidate.source}:${candidate.id}`"
                :id="`cloud-${candidate.source}-${candidate.id}`"
                :class="$style.resultEntry"
              >
                <div :class="`${$style.availableSongResult} ${localSong ? $style.downloaded : ''}`">
                  <div :class="$style.remoteSongInfo">
                    <div>
                      {{ displayText(candidate.title) }} - {{ displayText(candidate.artist) }}
                    </div>
                  </div>
                  <div :class="$style.resultActions">
                    <span :class="$style.sourceBadge"
                      ><v-icon
                        :name="candidate.source === 'youtube' ? 'fa-youtube' : 'md-musicnote'"
                      />{{ candidate.source === 'youtube' ? 'YouTube' : 'USDB' }}</span
                    >
                    <div
                      :class="$style.progress"
                      v-if="downloadState?.status === 'downloading'"
                      role="status"
                    >
                      <div
                        :class="$style.progressBar"
                        :style="{
                          width: `${(downloadState?.progress ?? 0) * 100}%`
                        }"
                      ></div>

                      <span> Downloading... </span>
                    </div>
                    <button
                      :class="$style.downloadButton"
                      @click="localSong ? playLocalSong(localSong) : downloadSong(candidate)"
                      v-else
                    >
                      <v-icon :name="localSong ? 'fa-play' : 'md-clouddownload'" />
                      {{
                        localSong
                          ? 'Play'
                          : downloadState?.status === 'error'
                            ? 'Retry'
                            : 'Download'
                      }}
                    </button>
                  </div>
                </div>
                <p
                  v-if="downloadState?.status === 'error' && candidate.source === 'usdb'"
                  :class="$style.sourceError"
                  role="alert"
                >
                  {{ downloadState.error ? getApiErrorMessage(downloadState.error.code) : '' }}
                </p>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </div>
  <YoutubeImport
    v-if="selectedYoutube"
    :key="selectedYoutube.id"
    :video="selectedYoutube"
    @play="playLocalSong"
    @close="selectedYoutube = null"
  />
</template>
<style lang="less" module>
.search {
  display: grid;
  width: 100%;
  height: 100%;
  color: white;
  justify-content: center;
  align-content: center;
  grid-template-rows: auto 1fr;
  grid-template-columns: 1fr;
  box-sizing: border-box;
  user-select: none;
  opacity: 0;
}

.emptyState {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  font-size: 2.5rem;
  gap: 1rem;
  color: rgba(255, 255, 255, 0.2);
  svg {
    width: 13rem;
    height: 13rem;
    fill: rgba(255, 255, 255, 0.2);
  }
}

.loadingContainer {
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 2rem;
}

.noResults {
  font-size: 1.4rem;
  opacity: 0.3;
  font-weight: 600;
  padding: 2rem;
  margin-bottom: 1.5rem;
  background-color: rgba(255, 255, 255, 0.2);
  border-radius: 1rem;
  display: flex;
  gap: 1rem;
  flex-direction: row;
  align-items: center;
  svg {
    width: 2.5rem;
    height: 2.5rem;
  }
}

.resultList {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.resultsContainer {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.fadeEnterActive,
.fadeLeaveActive {
  transition: opacity 0.3s ease;
}

.fadeEnterFrom,
.fadeLeaveTo {
  opacity: 0;
}

.header {
  display: flex;
  flex-wrap: wrap;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  gap: 1rem;
  margin-top: 3rem;
  height: fit-content;

  .goToSongList {
    width: fit-content;
    display: flex;
    align-items: center;
    gap: 1rem;
    cursor: pointer;
    background-color: rgba(255, 255, 255, 0.1);
    padding: 1rem;
    border-radius: 1.5rem;
    height: fit-content;

    svg {
      width: 2rem;
      height: 2rem;
      fill: rgba(255, 255, 255, 0.8);
    }
  }

  .searchBar {
    display: flex;
    align-items: center;
    gap: 1rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.8);
    background-color: rgba(255, 255, 255, 0.1);
    padding: 1rem;
    width: min(30rem, calc(100vw - 4rem));
    box-sizing: border-box;
    border-radius: 1.5rem;
    height: fit-content;

    input {
      background: none;
      border: none;
      outline: none;
      color: white;
      width: 100%;
      font-size: 1.4rem;
      font-weight: 500;
      font-family: 'Outfit', sans-serif;
    }

    svg {
      width: 2rem;
      height: 2rem;
      fill: rgba(255, 255, 255, 0.8);
    }
  }
}

.sourceBadge {
  color: #505050;
  background: rgba(0, 0, 0, 0.06);
}
.remoteSongInfo {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.resultActions {
  display: grid;
  grid-template-columns: repeat(2, 8.5rem);
  gap: 0.75rem;
  margin-left: auto;
  flex-shrink: 0;
  svg {
    width: 1.2rem;
    height: 1.2rem;
    flex-shrink: 0;
  }
}
.onlineBar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.searchActivity {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3rem;
  height: 3rem;
  flex-shrink: 0;
  border-radius: 1rem;
  color: white;
  background: rgba(0, 0, 0, 0.75);
}
.sourceError {
  color: #ffc2b8;
  overflow-wrap: anywhere;
  font-size: 1rem;
}
.resultEntry {
  display: flex;
  flex-direction: column;
}

.resultsBox {
  width: 100%;
  display: flex;
  justify-content: center;
  margin-top: 2rem;
  overflow: hidden;
  min-height: 0;
}

.results {
  width: 80%;
  height: 100%;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 2rem 2rem 0 0;
  overflow-y: auto;
  padding: 2rem;
  box-sizing: border-box;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
    margin-top: 2rem; /* Keep track away from top rounded corners */
  }

  &::-webkit-scrollbar-thumb {
    background-color: rgba(255, 255, 255, 0.2);
    border-radius: 10px;

    &:hover {
      background-color: rgba(255, 255, 255, 0.4);
    }
  }
}

@media (max-width: 760px) {
  .header {
    margin-top: 1rem;
    gap: 0.6rem;
    padding: 0 0.75rem;
  }
  .resultsBox {
    margin-top: 1rem;
  }
  .results {
    width: 100%;
    padding: 1rem;
  }
  .availableSongResult {
    flex-wrap: wrap;
    overflow-wrap: anywhere;
  }
  .resultActions {
    width: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
  }
  .localSongResult .songTitle {
    font-size: 1.3rem;
    overflow-wrap: anywhere;
  }
}

.banner {
  font-size: 1.25em;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.8);
  background-color: black;
  width: fit-content;
  padding: 0.75rem 1rem;
  border-radius: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  svg {
    width: 1.5rem;
    height: 1.5rem;
    fill: rgba(255, 255, 255, 0.8);
  }
}

.localBar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.hideLocalResults {
  color: rgba(255, 255, 255, 0.8);
  background-color: black;
  width: fit-content;
  padding: 0.75rem 1rem;
  border-radius: 1rem;
  display: flex;
  align-items: center;
  cursor: pointer;
}

.locallyDownloaded {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.availableForDownload {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.availableSongResult {
  display: flex;
  flex-direction: row;
  gap: 1rem;
  background-color: rgb(212, 212, 212);
  border-radius: 1rem;
  padding: 0.75rem 1.25rem;
  align-items: center;
  font-size: 1.2rem;
  color: black;
  font-weight: 600;
  overflow: hidden;

  &.downloaded {
    opacity: 0.8;
    cursor: pointer;
    .progress {
      cursor: pointer;
      .progressBar {
        background-color: #0b661a;
      }
    }
  }
}

.localSongResult {
  display: flex;
  flex-direction: row;
  gap: 1rem;
  background-color: rgb(255, 255, 255);
  border-radius: 1rem;
  padding: 1rem;
  cursor: pointer;
  color: black;
  font-weight: 600;
  align-items: center;

  &:last-child {
    margin-bottom: 2rem;
  }

  img {
    width: 4rem;
    height: 4rem;
    border-radius: 0.5rem;
    object-fit: cover;
  }

  .songTitle {
    font-size: 1.7rem;
    font-weight: 600;
  }

  .songArtist {
    font-size: 1rem;
    font-weight: 600;
    color: rgba(0, 0, 0, 0.7);
  }

  .songInfo {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
}

.sourceBadge,
.downloadButton,
.progress {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  width: 100%;
  min-width: 0;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  height: 2.75rem;
  box-sizing: border-box;
  font-size: 1rem;
  font-weight: 500;
  outline: none;
  border: none;
  white-space: nowrap;
}

.downloadButton,
.progress {
  color: white;
  background-color: #5826ad;
}

.downloadButton {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.progress {
  background-color: #240f49;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  transition: all 0.05s ease;
  cursor: wait;

  span {
    z-index: 9999;
    overflow: hidden;
    text-overflow: ellipsis;

    svg {
      margin-right: 0.75rem;
    }
  }

  .progressBar {
    height: 100%;
    background-color: #5826ad;
    border-radius: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    color: black;
    font-weight: 500;
    position: absolute;
    top: 0;
    left: 0;
    transition: all 0.05s;
  }
}
</style>
