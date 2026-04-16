export function useYtdlp() {
  async function ensureInstalled() {
    return await window.api.ytdlp.ensureInstalled()
  }

  return {
    ensureInstalled
  }
}
