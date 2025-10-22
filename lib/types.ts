// Firebase 데이터 타입 정의

export interface PMSAction {
  id: string
  property: "property1" | "property2" | "property3" | "property4"
  action: "checkin" | "checkout" | "payment-checkin" | "remote-print"
  roomNumber: string
  guestName?: string // remote-print에서는 선택사항
  checkInDate?: string
  checkOutDate?: string
  password?: string // remote-print에서 사용
  paymentAmount?: number
  paymentMethod?: string
  status: "pending" | "processing" | "completed" | "failed"
  createdAt: string
  completedAt?: string
  error?: string
}

export interface PrintJob {
  id: string
  action: "remote-print"
  roomNumber: string
  password: string
  status: "pending" | "completed"
  property: "property1" | "property2" | "property3" | "property4"
  createdAt: string
  completedAt: string | null
}

export interface RoomStatus {
  roomNumber: string
  status: "vacant" | "occupied" | "cleaning" | "maintenance"
  guestName?: string
  checkInDate?: string
  checkOutDate?: string
  lastUpdated: string
}
