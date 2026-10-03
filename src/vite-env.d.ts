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
  notes?: Record<string, NoteEntry>
}

export type DeleteResult = {
  ok: boolean
  error?: string
}

export type PrintStatus = '' | 'to-print' | 'printed' | 'reprint' | 'failed'

export type NoteEntry = {
  status: PrintStatus
  note: string
  updatedAt?: number
}

export type RenameResult = {
  ok: boolean
  error?: string
  path?: string
  name?: string
  relative?: string
  id?: string
}

export type NotesSetResult = {
  ok: boolean
  error?: string
  status?: PrintStatus
  note?: string
}

export type UpdateCheckResult = {
  ok: boolean
  current: string
  latest?: string
  newer?: boolean
  notes?: string
  downloadUrl?: string | null
  htmlUrl?: string
  error?: string
}

export type PrintShelfAPI = {
  defaultPath: () => Promise<string>
  pickFolder: () => Promise<string | null>
  scan: (root?: string) => Promise<ScanResult>
  readFile: (filePath: string) => Promise<ArrayBuffer>
  fileUrl: (filePath: string) => Promise<string>
  deleteFile: (filePath: string) => Promise<DeleteResult>
  renameFile: (oldPath: string, newName: string) => Promise<RenameResult>
  notesGet: (filePath: string) => Promise<NoteEntry>
  notesSet: (filePath: string, entry: { status: PrintStatus; note: string }) => Promise<NotesSetResult>
  notesMap: () => Promise<Record<string, NoteEntry>>
  getThumbPath: (modelId: string) => Promise<string | null>
  saveThumb: (modelId: string, dataUrl: string) => Promise<string>
  cacheDir: () => Promise<string>
  showInFolder: (filePath: string) => Promise<void>
  openPath: (filePath: string) => Promise<string>
  getVersion: () => Promise<string>
  checkForUpdates: () => Promise<UpdateCheckResult>
  openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>
}

declare global {
  interface Window {
    printshelf: PrintShelfAPI
  }
}

export {}
