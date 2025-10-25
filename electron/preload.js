const { contextBridge, ipcRenderer } = require("electron")

// Renderer 프로세스에서 사용할 수 있는 안전한 API 노출
contextBridge.exposeInMainWorld("electronAPI", {
  // 환경 설정
  getPropertyId: () => ipcRenderer.invoke("get-property-id"),
  getOverlayMode: () => ipcRenderer.invoke("get-overlay-mode"),

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

  // 오버레이 모드 관련
  send: (channel, data) => {
    // 허용된 채널만 전송 가능
    const validChannels = ["overlay-button-clicked", "checkin-complete", "close-popup"]
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data)
    }
  },

  // 프린터 관련 API 추가
  sendToPrinter: (data) => ipcRenderer.invoke("send-to-printer", data),
  onPrinterStatus: (callback) => ipcRenderer.on("printer-status", (event, status) => callback(status)),
  reconnectPrinter: () => ipcRenderer.invoke("reconnect-printer"),
  getPrinterStatus: () => ipcRenderer.invoke("get-printer-status"),

  // Electron 환경 확인
  isElectron: true,
})
