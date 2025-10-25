export interface ElectronAPI {
  // 환경 설정
  getPropertyId: () => Promise<string>
  getOverlayMode: () => Promise<boolean>

  // 지폐 인식기
  sendToBillAcceptor: (command: number[]) => Promise<{ success: boolean; error?: string }>
  onBillAcceptorData: (callback: (data: { data: number[] }) => void) => void
  onBillAcceptorStatus: (callback: (status: { connected: boolean; error?: string }) => void) => void
  reconnectBillAcceptor: () => Promise<{ success: boolean }>

  // 지폐 방출기
  sendToBillDispenser: (command: number[]) => Promise<{ success: boolean; error?: string }>
  onBillDispenserData: (callback: (data: { data: number[] }) => void) => void
  onBillDispenserStatus: (callback: (status: { connected: boolean; error?: string }) => void) => void
  reconnectBillDispenser: () => Promise<{ success: boolean }>

  sendToPrinter: (data: number[]) => Promise<{ success: boolean; error?: string }>
  onPrinterStatus: (callback: (status: { connected: boolean; port?: string; error?: string }) => void) => void
  reconnectPrinter: () => Promise<{ success: boolean }>
  getPrinterStatus: () => Promise<{ connected: boolean; port?: string }>

  // 유틸리티
  listSerialPorts: () => Promise<{ success: boolean; ports?: any[]; error?: string }>
  send: (channel: string, data?: any) => void
  isElectron: boolean
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
    __KIOSK_PROPERTY_ID__?: string
    __OVERLAY_MODE__?: boolean
  }
}
