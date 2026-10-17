/// <reference types="vite/client" />

import type { AppAPI } from '../../shared/api'

// Erweitere das globale Window-Objekt des Browsers
declare global {
  interface Window {
    api: AppAPI
  }
  const __APP_VERSION__: string
}
