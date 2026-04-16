import { ipcMain, dialog } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc'

class DialogManager {
  defineIpcHandles() {
    ipcMain.handle(IPC_CHANNELS.DIALOG.OPEN_FOLDER, async () => {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory']
      })
      if (canceled) {
        return null
      } else {
        return filePaths[0]
      }
    })
  }
}

export const dialogManager = new DialogManager()
