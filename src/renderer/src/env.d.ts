/// <reference types="vite/client" />

// Importiere nur den Typ aus dem Preload-Skript, nicht den echten Code!
import type { AppAPI } from '../../preload/index'

// Erweitere das globale Window-Objekt des Browsers
declare global {
  interface Window {
    api: AppAPI
  }
  const __APP_VERSION__: string
}
