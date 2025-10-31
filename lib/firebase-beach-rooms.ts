import { getDB } from "@/lib/firebase-admin"

/**
 * Firebase Beach Room Status 데이터 타입
 */
export interface BeachRoomData {
  category: string // Building (Beach A, Beach B, Camp)
  roomNumber: string // Room number (###호)
  roomType: string // Room type
  password: string // Door lock password
  status: string // Status (공실, 사용 중)
  floor: string // Floor number
  matchingRoomNumber: string // Room number for reservation sheet (G열)
  rowIndex?: number // Original sheet row index
}

/**
 * Firebase에서 Beach Room Status 데이터 가져오기
 */
export async function getBeachRoomStatusFromFirebase(): Promise<BeachRoomData[]> {
  try {
    const database = getDB()
    const ref = database.ref("beach_room_status/rooms")

    console.log("[Firebase] Fetching beach room status from Firebase...")

    const snapshot = await ref.once("value")
    const data = snapshot.val()

    if (!data) {
      console.warn("[Firebase] No beach room status data found in Firebase")
      return []
    }

    // Convert Firebase object to array
    const rooms: BeachRoomData[] = Object.values(data)

    console.log(`[Firebase] Successfully fetched ${rooms.length} rooms from Firebase`)
    console.log("[Firebase] 🔍 Sample room data (first 3 rooms):")
    rooms.slice(0, 3).forEach((room, index) => {
      console.log(`[Firebase]   Room ${index + 1}:`, {
        category: room.category,
        roomNumber: room.roomNumber,
        matchingRoomNumber: room.matchingRoomNumber,
        status: room.status,
      })
    })

    return rooms
  } catch (error) {
    console.error("[Firebase] Error fetching beach room status:", error)
    throw error
  }
}

/**
 * 특정 객실 정보 조회 (matchingRoomNumber 기준)
 */
export async function getRoomInfoByMatchingNumber(matchingRoomNumber: string): Promise<BeachRoomData | null> {
  try {
    const rooms = await getBeachRoomStatusFromFirebase()

    console.log(`[Firebase] 🔍 Searching for room with matchingRoomNumber: "${matchingRoomNumber}"`)
    console.log(`[Firebase] Total rooms in database: ${rooms.length}`)

    const room = rooms.find((r) => r.matchingRoomNumber === matchingRoomNumber)

    if (!room) {
      console.warn(`[Firebase] ❌ Room not found: ${matchingRoomNumber}`)
      console.log("[Firebase] Available matchingRoomNumbers:", rooms.map((r) => r.matchingRoomNumber).slice(0, 10))
      return null
    }

    console.log(`[Firebase] ✅ Found room:`, {
      category: room.category,
      roomNumber: room.roomNumber,
      matchingRoomNumber: room.matchingRoomNumber,
      status: room.status,
    })

    return room
  } catch (error) {
    console.error("[Firebase] Error getting room info:", error)
    return null
  }
}

/**
 * 객실 상태 업데이트 (Firebase)
 * @param matchingRoomNumber - G열 값 (예약 시트에 기록되는 객실번호)
 * @param newStatus - 새로운 상태 ("공실", "사용 중")
 */
export async function updateRoomStatusInFirebase(matchingRoomNumber: string, newStatus: string): Promise<boolean> {
  try {
    const database = getDB()
    const roomsRef = database.ref("beach_room_status/rooms")

    console.log(`[Firebase] Updating room status: ${matchingRoomNumber} -> ${newStatus}`)

    // Find the room by matchingRoomNumber
    const snapshot = await roomsRef.once("value")
    const data = snapshot.val()

    if (!data) {
      console.error("[Firebase] No rooms data found")
      return false
    }

    // Find the room key
    let roomKey: string | null = null
    for (const [key, room] of Object.entries(data)) {
      if ((room as BeachRoomData).matchingRoomNumber === matchingRoomNumber) {
        roomKey = key
        break
      }
    }

    if (!roomKey) {
      console.error(`[Firebase] Room not found: ${matchingRoomNumber}`)
      return false
    }

    // Update the status
    await roomsRef.child(roomKey).update({
      status: newStatus,
    })

    // Update lastUpdated timestamp
    await database.ref("beach_room_status/lastUpdated").set(new Date().toISOString())

    console.log(`[Firebase] ✅ Successfully updated room ${matchingRoomNumber} to ${newStatus}`)
    return true
  } catch (error) {
    console.error("[Firebase] Error updating room status:", error)
    return false
  }
}

/**
 * 공실 객실만 필터링
 */
export async function getAvailableRooms(location?: string): Promise<BeachRoomData[]> {
  try {
    const allRooms = await getBeachRoomStatusFromFirebase()

    let filteredRooms = allRooms.filter((room) => room.status === "공실")

    // Location 필터링
    if (location) {
      const upperLocation = location.toUpperCase()

      if (upperLocation === "CAMP") {
        filteredRooms = filteredRooms.filter((room) => room.category === "Camp")
      } else if (["A", "B", "D"].includes(upperLocation)) {
        // Property3: Beach A, Beach B
        filteredRooms = filteredRooms.filter((room) => room.category === "Beach A" || room.category === "Beach B")
      }
    }

    console.log(`[Firebase] Found ${filteredRooms.length} available rooms (location: ${location || "ALL"})`)

    return filteredRooms
  } catch (error) {
    console.error("[Firebase] Error getting available rooms:", error)
    return []
  }
}
