import { app, shell, BrowserWindow, protocol, screen, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.png?asset'
import { settingsManager } from './ipc/settings'
import { songManager } from './ipc/songs'
import { dialogManager } from './ipc/dialogs'
import { downloaderManager } from './ipc/downloaderManager'
import { createReadStream, statSync, existsSync } from 'fs'
import { ytDlpManager } from './ipc/ytdlp'

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess')
app.commandLine.appendSwitch('audio-process-high-priority')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-frame-rate-limit')
app.commandLine.appendSwitch('disable-gpu-vsync')

function createWindow(): void {
  // Create the browser window.

  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.workAreaSize

  const mainWindow = new BrowserWindow({
    width,
    height,
    show: false,
    fullscreen: true,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
      // webSecurity: false // Disable CORS for local files
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools()
      event.preventDefault()
    }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function init() {
  await ytDlpManager.init()
  await settingsManager.defineIpcHandles()
  await songManager.defineIpcHandles()
  dialogManager.defineIpcHandles()
  await downloaderManager.defineIpcHandles()
  createWindow()

  // Erlaubt das Testen des Updaters aus der Entwicklungsumgebung heraus
  if (is.dev) {
    autoUpdater.forceDevUpdateConfig = true
  }

  // Deaktiviere Web-Installer & Blockmaps (für Voll-Downloads statt Delta-Updates)
  autoUpdater.disableWebInstaller = true

  autoUpdater.on('download-progress', (progress) => {
    // Sende Fortschrittsinformationen an den Renderer
    BrowserWindow.getAllWindows().forEach((_) => {
      console.log(`Download progress: ${progress.percent}%`)
    })
  })

  autoUpdater.checkForUpdatesAndNotify()
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  }
])

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Streams local files to renderer
  protocol.handle('local', (request) => {
    const actualPath = new URL(request.url).searchParams.get('path')

    if (!actualPath || !existsSync(actualPath)) {
      return new Response('File not found', { status: 404 })
    }

    const stat = statSync(actualPath)
    const total = stat.size
    const rangeHeader = request.headers.get('Range') || request.headers.get('range')

    let contentType = 'video/mp4' // default
    if (actualPath.endsWith('.webm')) contentType = 'video/webm'
    else if (actualPath.endsWith('.mp3')) contentType = 'audio/mpeg'

    const { Readable } = require('stream')

    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-')
      const partialstart = parts[0]
      const partialend = parts[1]

      const start = parseInt(partialstart, 10)
      const end = partialend ? parseInt(partialend, 10) : total - 1
      const chunksize = end - start + 1

      const stream = createReadStream(actualPath, { start, end })

      return new Response(Readable.toWeb(stream) as any, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize.toString(),
          'Content-Type': contentType
        }
      })
    } else {
      const stream = createReadStream(actualPath)
      return new Response(Readable.toWeb(stream) as any, {
        status: 200,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': total.toString(),
          'Content-Type': contentType
        }
      })
    }
  })

  init()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
