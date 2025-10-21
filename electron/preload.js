const { contextBridge, ipcRenderer } = require("electron")

// Renderer 프로세스에서 사용할 수 있는 안전한 API 노출
contextBridge.exposeInMainWorld("electronAPI", {
  // 지폐 인식기
  sendToBillAcceptor: (command) => ipcRenderer.invoke("send-to-bill-acceptor", command),

  onBillAcceptorData: (callback) => ipcRenderer.on("bill-acceptor-data", (event, data) => callback(data)),

  onBillAcceptorStatus: (callback) => ipcRenderer.on("bill-acceptor-status", (event, status) => callback(status)),

  reconnectBillAcceptor: () => ipcRenderer.invoke("reconnect-bill-acceptor"),

  // 지폐 방출기
  sendToBillDispenser: (command) => ipcRenderer.invoke("send-to-bill-dispenser", command),

  onBillDispenserData: (callback) => ipcRenderer.on("bill-dispenser-data", (event, data) => callback(data)),

  onBillDispenserStatus: (callback) => ipcRenderer.on("bill-dispenser-status", (event, status) => callback(status)),

  reconnectBillDispenser: () => ipcRenderer.invoke("reconnect-bill-dispenser"),

  // 유틸리티
  listSerialPorts: () => ipcRenderer.invoke("list-serial-ports"),

  // Electron 환경 확인
  isElectron: true,
})
