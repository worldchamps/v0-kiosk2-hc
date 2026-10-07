import type { TossFrontPaymentProof } from "@/lib/payment-types"

export interface TossFrontStatus {
  configured: boolean
  connected: boolean
  authenticated: boolean
  transport?: "websocket" | "serial" | "auto"
  transportPreference?: "websocket" | "serial" | "auto"
  url?: string
  serialPath?: string
  serialBaudRate?: number
  error?: string
}

export interface TossFrontResult {
  notApproved?: boolean
  success: boolean
  payment?: TossFrontPaymentProof
  cancel?: unknown
  error?: string
}

export interface TossFrontQrResult {
  success: boolean
  value?: string
  error?: string
}

export interface KioskDeviceSettingsValues {
  tossTransport: "auto" | "serial" | "websocket"
  tossSerialPath: string
  tossSerialBaudRate: string
  tossWsUrl: string
  tossPairingKey: string
  printerPort: string
  acceptorPort: string
  dispenserPort: string
  bac2400Port: string
  sam4sPrinterName: string
  woosimPrinterName: string
  cardDispenserPort: string
  cardDispenserAddress: string
  cardDispenserEnabled: "true" | "false"
}

export interface CardKeyResult {
  success: boolean
  reason?: string
  error?: string
  settled?: boolean
  state?: string
  failedSectors?: number[]
  bits?: number
  sensors?: number
  moving?: boolean
  empty?: boolean
  low?: boolean
  hopperFull?: boolean
  captureFull?: boolean
  uidChanged?: boolean
  uidMatchesSource?: boolean
  issueMode?: "full" | "uid_only"
  dispenseMs?: number
  recoveryRequired?: boolean
  port?: string
  baudRate?: number
  address?: string
  errorStage?: string
  receivedBytes?: number
  failedCommand?: string
  deviceCode?: number
  failedBlock?: number
  responseBytes?: number
  rooms?: { room: string; registeredAt: string }[]
  sectors?: number[]
}

export interface KioskDeviceSettingsRead {
  success: boolean
  error?: string
  property?: string
  building?: string
  pairingKeySet?: boolean
  values?: KioskDeviceSettingsValues
  serialPorts?: { path: string; manufacturer: string }[]
  printers?: { name: string; displayName: string }[]
}

export interface ElectronAPI {
  cardKey?: {
    checkInRequired: () => Promise<boolean>
    ready: (room: string, reservationId?: string) => Promise<CardKeyResult>
    issueCheckIn: (ticket: string) => Promise<CardKeyResult>
    issueRemote: (envelope: { request: Record<string, string | number>; signature: string }) => Promise<CardKeyResult>
    available: () => Promise<boolean>
    run: (command: "status" | "list" | "register" | "issue" | "capture" | "reset" | "return" | "profile", input: {
      password: string; room?: string; replaceRegisteredAt?: string; confirmed?: boolean; operationKey?: string;
      issueMode?: "full" | "uid_only";
      profile?: { sectors: { sector: number; keyA: string; keyB: string }[] }
    }) => Promise<CardKeyResult>
    onProgress: (callback: (progress: { state: string }) => void) => () => void
  }
  setUpdateSafe: (safe: boolean) => void
  getAppVersion?: () => string
  // 환경 설정
  getPropertyId: () => Promise<string>
  getOverlayMode: () => Promise<boolean>
  paymentRecovery: {
    reportCash: (input: { expectedRaw: string | null; memorySnapshot: string }) => Promise<{ success: boolean; archiveId?: string; error?: string }>
    authorize: (password: string) => Promise<{ success: boolean; error?: string }>
    archive: (input: { password: string; expectedRaw: string | null; memorySnapshot: string; confirmed: boolean; resolution: "zero_cash" | "operator_resolved"; note: string }) =>
      Promise<{ success: boolean; archiveId?: string; error?: string }>
  }

  tossFront: {
    getStatus: () => Promise<TossFrontStatus>
    reconnect: () => Promise<TossFrontStatus>
    scanReservationQr: () => Promise<TossFrontQrResult>
    requestPayment: (payload: { amount: number; paymentKey?: string }) => Promise<TossFrontResult>
    recoverPayment: (payload: { amount: number; paymentKey: string }) => Promise<TossFrontResult>
    cancelPayment: (payment: TossFrontPaymentProof) => Promise<TossFrontResult>
    onStatus: (callback: (status: TossFrontStatus) => void) => () => void
  }

  // 지폐 인식기
  getHardwareStatus: () => Promise<{ connected: boolean | null }>
  cashDiagnostics?: {
    read: (password: string) => Promise<{ success: boolean; path?: string; text?: string; error?: string }>
    run: (input: { password: string; command: "reset" | "stop"; confirmed: boolean }) => Promise<{
      success: boolean; result?: string; elapsedMs?: number; logSaved?: boolean; error?: string
    }>
    trace: (input: { event: "send" | "result"; bytes: number[]; sentAt: number; elapsedMs?: number; result?: string; response?: number[] }) => void
  }
  deviceSettings: {
    read: (password: string) => Promise<KioskDeviceSettingsRead>
    save: (input: { password: string; values: KioskDeviceSettingsValues }) => Promise<{ success: boolean; restartRequired?: boolean; error?: string }>
  }
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
  printToBixolon: (text: string, options?: { alignment?: number; attribute?: number; textSize?: number; codePage?: number }) => Promise<boolean>
  cutBixolonPaper: () => Promise<boolean>
  sendRawToBixolon: (data: number[]) => Promise<boolean>
  printToSam4s: (receipt: unknown) => Promise<{ success: boolean; printer?: string; error?: string }>
  getReceiptPrinterStatus: () => Promise<{ backend: "bixolon" | "sam4s" | "woosim"; connected?: boolean }>
  printToWoosim: (receipt: unknown) => Promise<{ success: boolean; printer?: string; error?: string }>

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
    __KIOSK_FIREBASE_CONFIG__?: Record<string, string>
  }
}
