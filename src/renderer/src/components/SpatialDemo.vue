<template>
  <div class="tv-layout">
    <aside class="sidebar lrud-container" data-block-exit="up down">
      <button
        v-for="(item, index) in menuItems"
        :key="item"
        :id="'menu-item-' + index"
        class="nav-item focusable"
      >
        {{ item }}
      </button>
    </aside>

    <main class="content-area lrud-container" id="main-grid" data-focus="memory">
      <div class="grid">
        <button
          v-for="i in 12"
          :key="'card-' + i"
          :class="['card', 'focusable', { 'is-wide': i === 1 || i === 8 || i === 10 }]"
          :id="'card-' + i"
        >
          Film-Karte {{ i }}
        </button>
      </div>
    </main>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { getNextFocus } from '@bbc/tv-lrud-spatial'

const menuItems = ref(['Home', 'Filme', 'Serien', 'Meine Liste'])

const handleKeyDown = (event) => {
  const nextFocus = getNextFocus(document.activeElement, event.keyCode)
  if (nextFocus) {
    nextFocus.focus()
    event.preventDefault()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)

  // Set initial focus
  setTimeout(() => {
    const firstFocusable = document.querySelector('.focusable')
    if (firstFocusable) {
      firstFocusable.focus()
    }
  }, 50)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
})
</script>

<style scoped>
/* WICHTIG: Da die Navigation geometrisch ist, MUSS das CSS exakt sein. 
  Wenn Elemente überlappen oder unsichtbar sind, funktioniert die Navigation nicht richtig.
*/

.tv-layout {
  display: flex;
  height: 100vh;
  background-color: #141414;
  color: white;
  font-family: sans-serif;
}

.sidebar {
  width: 250px;
  padding: 2rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  background-color: #000;
}

.content-area {
  flex: 1;
  padding: 2rem;
  overflow: hidden; /* Verhindert Scrollbars im TV-Interface */
}

.grid {
  display: grid;
  /* Responsives Grid: Bricht automatisch um, die Navigation passt sich magisch an! */
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 2rem;
}

/* --- FOCUS STYLING (Essenziell für die UX) --- */
.focusable {
  background: #333;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition:
    transform 0.2s,
    background-color 0.2s,
    outline 0.2s;
}

.nav-item {
  padding: 1rem;
  text-align: left;
  font-size: 1.2rem;
}

.card {
  aspect-ratio: 16 / 9;
  font-size: 1.5rem;
  font-weight: bold;
}

.is-wide {
  grid-column: span 2;
  aspect-ratio: auto;
}

/* Das ist der visuelle Indikator, wo der User gerade steht */
.focusable:focus {
  outline: 4px solid #fff;
  background-color: #e50914; /* Netflix Rot als Beispiel */
  transform: scale(1.08); /* Hebt das Element optisch hervor */
  z-index: 10;
}
</style>
