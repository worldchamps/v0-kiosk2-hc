const { contextBridge, ipcRenderer } = require("electron")
contextBridge.exposeInMainWorld("kioskSetup", { register: (restart = false) => ipcRenderer.invoke("kiosk:setup", restart === true) })
