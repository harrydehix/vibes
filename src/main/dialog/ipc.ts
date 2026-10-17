import { IPC_CHANNELS } from '../../shared/ipc'
import { handleApi } from '../utils/ipcHandle'
import { openFolder } from './index'

export function defineDialogIpc(): void {
  handleApi(IPC_CHANNELS.DIALOG.OPEN_FOLDER, () => openFolder(), 'dialog_failed')
}
