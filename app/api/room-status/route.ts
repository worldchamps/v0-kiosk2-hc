import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getBeachRoomStatusFromFirebase } from "@/lib/firebase-beach-rooms"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const building = searchParams.get("building")
    const roomNumber = searchParams.get("roomNumber")
    const floor = searchParams.get("floor")

    console.log("[v0] Fetching room status from Firebase...")
    const roomsData = await getBeachRoomStatusFromFirebase()

    if (!roomsData || roomsData.length === 0) {
      return NextResponse.json({
        rooms: [],
        message: "No room data found",
      })
    }

    const mappedRooms = roomsData.map((room) => ({
      building: room.category,
      roomNumber: room.roomNumber,
      roomType: room.roomType,
      status: room.status,
      price: "", // Price not stored in Firebase
      floor: room.floor,
      matchingRoomNumber: room.matchingRoomNumber,
    }))

    let filteredRooms = [...mappedRooms]

    if (building) {
      filteredRooms = filteredRooms.filter((room) => room.building === building)
    }

    if (roomNumber) {
      filteredRooms = filteredRooms.filter((room) => room.roomNumber.includes(roomNumber))
    }

    if (floor) {
      filteredRooms = filteredRooms.filter((room) => room.floor === floor)
    }

    console.log(`[v0] Returning ${filteredRooms.length} rooms after filtering`)

    return NextResponse.json({
      rooms: filteredRooms,
      total: filteredRooms.length,
      source: "firebase", // Indicate data source
    })
  } catch (error) {
    console.error("Error fetching room status data:", error)
    return NextResponse.json(
      { error: "Failed to fetch room status data", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
