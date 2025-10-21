export interface ElectronAPI {
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

  // 유틸리티
  listSerialPorts: () => Promise<{ success: boolean; ports?: any[]; error?: string }>
  isElectron: boolean
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
