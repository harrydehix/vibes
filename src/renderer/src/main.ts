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
  IoTrashBinSharp,
  MdFoldercopy,
  CoAddthis,
  RiArrowGoBackLine,
  FaSearch,
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
  MdExittoappOutlined
} from 'oh-vue-icons/icons'

addIcons(
  MdMusicnote,
  MdRefresh,
  MdRestartaltTwotone,
  MdQueuemusicOutlined,
  MdSettingssuggest,
  MdPausecircleSharp,
  MdTransitenterexit,
  IoTrashBinSharp,
  MdFoldercopy,
  CoAddthis,
  RiArrowGoBackLine,
  FaSearch,
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
