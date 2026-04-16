export function accessLocalFile(path: string) {
  return 'local://video?path=' + encodeURIComponent(path)
}
