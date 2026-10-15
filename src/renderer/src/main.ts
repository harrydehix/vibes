import './assets/base.css'

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { addIcons, OhVueIcon } from 'oh-vue-icons'
import {
  MdMusicnote,
  MdRestartaltTwotone,
  MdQueuemusicOutlined,
  MdSettingssuggest,
  MdTransitenterexit,
  MdPausecircleSharp,
  IoCloseSharp,
  IoTrashBinSharp,
  MdFoldercopy,
  CoAddthis,
  RiArrowGoBackLine,
  FaSearch,
  FaYoutube,
  MdFiledownloadSharp,
  MdClouddownload,
  MdDownloaddoneOutlined,
  HiSolidEye,
  HiSolidEyeOff,
  SiStarship,
  MdShuffle,
  IoSadSharp,
  MdRefresh,
  MdKeyboarddoublearrowupRound,
  MdExittoappOutlined,
  FaPlay
} from 'oh-vue-icons/icons'

addIcons(
  MdMusicnote,
  FaPlay,
  MdRefresh,
  MdRestartaltTwotone,
  MdQueuemusicOutlined,
  MdSettingssuggest,
  MdPausecircleSharp,
  MdTransitenterexit,
  IoCloseSharp,
  IoTrashBinSharp,
  MdFoldercopy,
  CoAddthis,
  RiArrowGoBackLine,
  FaSearch,
  FaYoutube,
  MdFiledownloadSharp,
  MdClouddownload,
  MdDownloaddoneOutlined,
  HiSolidEye,
  HiSolidEyeOff,
  SiStarship,
  MdShuffle,
  IoSadSharp,
  MdKeyboarddoublearrowupRound,
  MdExittoappOutlined
)

createApp(App).use(router).component('v-icon', OhVueIcon).mount('#app')
