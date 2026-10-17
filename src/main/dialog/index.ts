import { dialog } from 'electron'

export async function openFolder(): Promise<string | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  return canceled ? null : (filePaths[0] ?? null)
}
