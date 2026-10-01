const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('printshelf', {
  defaultPath: () => ipcRenderer.invoke('library:defaultPath'),
  pickFolder: () => ipcRenderer.invoke('library:pickFolder'),
  scan: (root) => ipcRenderer.invoke('library:scan', root),
  readFile: (filePath) => ipcRenderer.invoke('library:readFile', filePath),
  fileUrl: (filePath) => ipcRenderer.invoke('library:fileUrl', filePath),
  getThumbPath: (modelId) => ipcRenderer.invoke('thumbs:getPath', modelId),
  saveThumb: (modelId, dataUrl) => ipcRenderer.invoke('thumbs:save', modelId, dataUrl),
  cacheDir: () => ipcRenderer.invoke('thumbs:cacheDir'),
  showInFolder: (filePath) => ipcRenderer.invoke('shell:showItem', filePath),
  openPath: (filePath) => ipcRenderer.invoke('shell:openPath', filePath),
})
