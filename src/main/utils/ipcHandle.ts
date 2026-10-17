import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { Cause, Runtime } from 'effect'
import { getApiErrorCode, type ApiErrorCode, type ApiResult } from '../../shared/errors'

export function handleApi<Args extends unknown[], Value>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => Value | Promise<Value>,
  fallback: ApiErrorCode = 'unknown'
): void {
  ipcMain.handle(channel, async (event, ...args: Args): Promise<ApiResult<Value>> => {
    try {
      return { ok: true, value: await handler(event, ...args) }
    } catch (error) {
      console.error(`IPC ${channel} failed:`, error)
      const reason = Runtime.isFiberFailure(error)
        ? Cause.squash(error[Runtime.FiberFailureCauseId])
        : error
      return { ok: false, error: { code: getApiErrorCode(reason, fallback) } }
    }
  })
}
