<script setup lang="ts">
import { accessSongs } from '@renderer/composables/useSongs'
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'

const model = defineModel<string[]>({
  default: []
})
const songs = accessSongs()

const route = useRoute()
const inPlayer = computed(() => route.name === 'Song Player')

function selectFolder(index?: number) {
  window.api.dialog.openFolder().then((folderPath) => {
    if (folderPath) {
      if (index !== undefined) {
        model.value[index] = folderPath
      } else {
        model.value.push(folderPath)
      }
    }
  })
}

watch(
  model,
  (newFolders) => {
    console.log('Folders updated:', newFolders)
    songs.refresh()
  },
  { deep: true }
)
</script>
<template>
  <div :class="$style.folders">
    <div v-for="(folder, index) in model" :key="index" :class="$style.folder">
      {{ folder }}
      <button @click="model.splice(index, 1)" :class="$style.remove" :disabled="inPlayer">
        <v-icon name="io-trash-bin-sharp"></v-icon>
      </button>
      <button @click="selectFolder(index)" :class="$style.edit" :disabled="inPlayer">
        <v-icon name="md-foldercopy"></v-icon>
      </button>
    </div>
    <button @click="selectFolder()" :class="$style.add" :disabled="inPlayer">
      <v-icon name="co-addthis"></v-icon> Add source
    </button>
  </div>
</template>
<style lang="less" module>
.folders {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  svg {
    width: 2rem;
    height: 2rem;
    fill: black;
    color: black;
  }
}

.folder,
.add {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background-color: rgba(255, 255, 255, 0.2);
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  outline: none;
  border: none;
  font-size: 1.3rem;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.664);
}

.add {
  background-color: #fff;
  padding: 0.75rem 1rem;
  color: black;
  font-weight: 600;
  cursor: pointer;
}

.remove {
  margin-left: auto;
}

.remove,
.edit {
  background-color: rgba(0, 0, 0, 0.5);
  padding: 0.5rem;
  border-radius: 0.25rem;
  border: none;
  outline: none;
  cursor: pointer;
  box-sizing: border-box;
  svg {
    fill: white;
    width: 1.5rem;
    height: 1.5rem;
  }
}

.add:disabled,
.remove:disabled,
.edit:disabled {
  opacity: 0.5;
  /* less contrast */
  cursor: not-allowed;
}
</style>
