export interface RoomTypeOrder {
  [roomType: string]: number
}

const STORAGE_KEY = "room_type_order"

// Default room type order
export const DEFAULT_ROOM_TYPE_ORDER: RoomTypeOrder = {
  "디럭스 (오션뷰)": 1,
  디럭스: 2,
  "스위트 (오션뷰)": 3,
  스위트: 4,
  스탠다드: 5,
  "스탠다드 트윈": 6,
  "독채 펜션": 7,
  "독채 마당": 8,
}

export function getRoomTypeOrder(): RoomTypeOrder {
  if (typeof window === "undefined") return DEFAULT_ROOM_TYPE_ORDER

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (error) {
    console.error("Error loading room type order:", error)
  }

  return DEFAULT_ROOM_TYPE_ORDER
}

export function setRoomTypeOrder(order: RoomTypeOrder): void {
  if (typeof window === "undefined") return

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order))
  } catch (error) {
    console.error("Error saving room type order:", error)
  }
}

export function sortRoomTypes(roomTypes: string[]): string[] {
  const order = getRoomTypeOrder()

  return roomTypes.sort((a, b) => {
    const orderA = order[a] ?? 999
    const orderB = order[b] ?? 999
    return orderA - orderB
  })
}
