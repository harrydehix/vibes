import { createRouter, createWebHashHistory } from 'vue-router'
import SongPlayer from './pages/SongPlayer.vue'
import HomeScreen from './pages/HomeScreen.vue'
import SongList from './pages/SongList.vue'
import SongSearch from './pages/SongSearch.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/song-player',
      name: 'Song Player',
      component: SongPlayer
    },
    {
      path: '/',
      name: 'Home Screen',
      component: HomeScreen
    },
    {
      path: '/song-list',
      name: 'Song List',
      component: SongList
    },
    {
      path: '/search',
      name: 'Search',
      component: SongSearch
    }
  ]
})

export default router
