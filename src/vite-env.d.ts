/// <reference types="vite/client" />

export type ModelInfo = {
  id: string
  name: string
  path: string
  relative: string
  ext: string
  size: number
  mtime: number
}

export type ScanResult = {
  ok: boolean
  error?: string
  models: ModelInfo[]
  root: string
  count?: number
}

export type PrintShelfAPI = {
  defaultPath: () => Promise<string>
  pickFolder: () => Promise<string | null>
  scan: (root?: string) => Promise<ScanResult>
  readFile: (filePath: string) => Promise<ArrayBuffer>
  fileUrl: (filePath: string) => Promise<string>
  getThumbPath: (modelId: string) => Promise<string | null>
  saveThumb: (modelId: string, dataUrl: string) => Promise<string>
  cacheDir: () => Promise<string>
  showInFolder: (filePath: string) => Promise<void>
  openPath: (filePath: string) => Promise<string>
}

declare global {
  interface Window {
    printshelf: PrintShelfAPI
  }
}

export {}
