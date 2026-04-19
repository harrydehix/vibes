<script setup lang="ts">
import { accessSongs } from '@renderer/composables/useSongs'
import { useSound } from '@renderer/composables/useSound'
import router from '@renderer/router'
import { accessLocalFile } from '@renderer/utils/accessLocalFile'
import { Song, UsdbSong } from '@shared/types'
import Fuse from 'fuse.js'
import { computed, ref, watch, onUnmounted, useCssModule, onMounted, nextTick } from 'vue'
import gsap from 'gsap'
import { accessBackgroundMusic } from '@renderer/composables/useBackgroundMusic'
import LoadingSpinner from '@renderer/components/LoadingSpinner.vue'
import { useRoute } from 'vue-router'
import { DownloadState, useDownloader } from '@renderer/composables/useDownloader'
import { onKeyStroke } from '@vueuse/core'

const { songs, refresh } = accessSongs()
const $style = useCssModule()
const search = ref<string>('')
const locallySearchedSongs = ref<Song[]>([])
const availableForDownloadSongs = ref<
  {
    song: UsdbSong
    downloadState: DownloadState | null
  }[]
>([])
const sound = useSound()
const backgroundMusic = accessBackgroundMusic()

const localFuseSearch = computed(() => {
  return new Fuse(songs.value, {
    keys: ['title', 'artist', 'genre'],
    threshold: 0.3
  })
})
const locallyLoading = ref(true)
const onlineLoading = ref(true)
const emptyState = computed(() => {
  return songs.value.length === 0 && search.value === ''
})

const gsapScope = ref<null | HTMLElement>(null)
let ctx: gsap.Context

// rerun search if songs list changes (e.g. new song downloaded)
watch(songs, async () => {
  if (search.value) {
    locallyLoading.value = true
    await nextTick()
    const results = localFuseSearch.value.search(search.value).map((result) => result.item)
    locallySearchedSongs.value = results
    await nextTick()
    locallyLoading.value = false
  }
})

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
})

onKeyStroke('Escape', () => {
  navigateToList(false)
})

const searchTimeout = ref<number | null>(null)

const route = useRoute()
const previousSongIndex = computed(() => {
  const index = route.query.songIndex ? parseInt(route.query.songIndex as string) : null
  return index !== null && !isNaN(index) ? index : null
})

const downloader = useDownloader()

watch(
  search,
  async (newSearch) => {
    if (searchTimeout.value) {
      clearTimeout(searchTimeout.value)
    }
    searchTimeout.value = window.setTimeout(async () => {
      const results = await searchForSongs(newSearch)
      console.log('Search results:', results)
      locallySearchedSongs.value = results.downloaded
      await nextTick()
      locallyLoading.value = false
      availableForDownloadSongs.value = (await results.available).map((s) => ({
        song: s,
        downloadState: downloader.downloads.value.find((d) => d.song.apiId === s.apiId) ?? null
      }))
      onlineLoading.value = false
    }, 300)
  },
  {
    immediate: true
  }
)

function searchForSongs(search: string): {
  downloaded: Song[]
  available: Promise<UsdbSong[]>
} {
  locallyLoading.value = true
  onlineLoading.value = true
  const downloaded = localFuseSearch.value.search(search).map((result) => result.item)
  return {
    downloaded,
    available: (async () => {
      if (!search) return []
      console.log('Searching online for:', search)

      return await downloader.search({ search })
    })()
  }
}

async function playLocalSong(song: Song) {
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

function navigateToList(withSound = true) {
  if (withSound) {
    sound.play('click')
  }
  fadeOut(() => {
    router.push({ path: '/song-list', query: { songIndex: previousSongIndex.value } })
  })
}

function fadeOut(callback: () => void) {
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

async function downloadSong(song: UsdbSong) {
  await downloader.download(JSON.parse(JSON.stringify(song)))
  sound.play('downloadSuccess')
}

function alreadyDownloaded(song: UsdbSong): boolean {
  const sanitizedTitle = song.title.replace(/\&amp;/g, '&')
  const sanitizedArtist = song.artist.replace(/\&amp;/g, '&')
  return songs.value.some(
    (s) =>
      s.title.toLowerCase() === sanitizedTitle.toLowerCase() &&
      s.artist.toLowerCase() === sanitizedArtist.toLowerCase()
  )
}

const refreshTimeout = ref<number | null>(null)

watch(
  downloader.downloads,
  async (downloads) => {
    for (const downloadState of downloads) {
      const entry = availableForDownloadSongs.value.find(
        (s) => s.song.apiId === downloadState.song.apiId
      )
      if (entry) {
        entry.downloadState = downloadState
      }
      if (downloadState.status === 'completed') {
        // Wait a tick to ensure the new song is added to the songs list and UI has updated
        await nextTick()
        if (!alreadyDownloaded(downloadState.song)) {
          if (refreshTimeout.value) {
            clearTimeout(refreshTimeout.value)
          }
          refreshTimeout.value = window.setTimeout(() => {
            refresh()
          }, 1000)
          console.log(
            `Song successfully downloaded: ${downloadState.song.title} by ${downloadState.song.artist}`
          )
        }
      }
    }
  },
  { immediate: true, deep: true }
)

function playIfDownloaded(isDownloaded: boolean, song: UsdbSong) {
  if (isDownloaded) {
    // fix that they are not equal if there are special chars like & in the title/artist, probably due to html encoding somewhere
    const sanitizedTitle = song.title.replace(/\&amp;/g, '&')
    const sanitizedArtist = song.artist.replace(/\&amp;/g, '&')

    const localSong = songs.value.find(
      (s) =>
        s.title.toLowerCase() === sanitizedTitle.toLowerCase() &&
        s.artist.toLowerCase() === sanitizedArtist.toLowerCase()
    )
    if (localSong) {
      playLocalSong(localSong)
    } else {
      console.error('Downloaded song not found in local songs list:', song)
    }
  }
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
          placeholder="Search for a song or artist..."
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
                    <img :src="accessLocalFile(song.cover!)" alt="thumbnail" />
                    <div :class="$style.songInfo">
                      <div :class="$style.songTitle">{{ song.title }}</div>
                      <div :class="$style.songArtist">{{ song.artist }}</div>
                    </div>
                  </div>
                </div>
              </Transition>
            </div>
            <div :class="$style.availableForDownload" v-if="search !== ''">
              <div :class="$style.banner">
                <v-icon name="md-clouddownload"></v-icon>
                Available for download
              </div>
              <div v-if="onlineLoading" :class="$style.loadingContainer">
                <LoadingSpinner />
              </div>
              <div v-else-if="availableForDownloadSongs.length === 0" :class="$style.noResults">
                <v-icon name="io-sad-sharp"></v-icon>
                Oupps... we don't know this song yet!
              </div>
              <div
                v-else
                v-for="{ song, downloadState } in availableForDownloadSongs"
                :key="song.apiId"
                :id="`cloud-${song.apiId}`"
                :class="`${$style.availableSongResult} ${downloadState?.status === 'completed' ? $style.downloaded : ''}`"
                @click="playIfDownloaded(downloadState?.status === 'completed', song)"
              >
                <div><span v-html="song.title"></span> - <span v-html="song.artist"></span></div>
                <div :class="$style.progress" v-if="downloadState">
                  <div
                    :class="$style.progressBar"
                    :style="{
                      width: `${(downloadState?.progress ?? 0) * 100}%`
                    }"
                  ></div>

                  <span>
                    <template v-if="downloadState?.status === 'completed'">
                      <v-icon name="md-downloaddone-outlined"></v-icon>
                      Downloaded</template
                    >
                    <template v-else-if="downloadState?.status === 'downloading'"
                      >Downloading...</template
                    >
                    <template v-else>Download unavailable</template>
                  </span>
                </div>
                <button
                  :class="$style.downloadButton"
                  @click.prevent.stop="() => downloadSong(song)"
                  v-else
                >
                  Download
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </div>
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
    width: 30rem;
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

  &:last-child {
    margin-bottom: 2rem;
  }

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

.downloadButton,
.progress {
  margin-left: auto;
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  height: 1.75rem;
  box-sizing: content-box;
  font-size: 1rem;
  font-weight: 500;
  outline: none;
  border: none;
  color: white;
  background-color: #5826ad;
}

.downloadButton {
  cursor: pointer;
}

.progress {
  width: 13rem;
  background-color: #240f49;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  transition: all 0.05s ease;
  cursor: wait;

  span {
    z-index: 9999;

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
