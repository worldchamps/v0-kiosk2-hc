import { NextResponse } from "next/server"
import { getAvailableRooms } from "@/lib/firebase-beach-rooms"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const location = searchParams.get("location")?.toUpperCase()

    console.log("[v0] Filtering by location:", location || "ALL")

    const availableRooms = await getAvailableRooms(location || undefined)

    console.log("[v0] Available rooms from Firebase:", availableRooms.length)

    if (availableRooms.length > 0) {
      console.log("[v0] 🔍 First available room data:")
      console.log("[v0]   category:", availableRooms[0].category)
      console.log("[v0]   roomNumber:", availableRooms[0].roomNumber)
      console.log("[v0]   matchingRoomNumber:", availableRooms[0].matchingRoomNumber)
      console.log("[v0]   Will be sent as roomCode:", availableRooms[0].matchingRoomNumber)
    }

    if (availableRooms.length === 0) {
      return NextResponse.json({
        availableRooms: [],
        roomsByType: {},
        total: 0,
        location: location || "ALL",
        message: "No available rooms found",
        source: "firebase",
      })
    }

    const mappedRooms = availableRooms.map((room) => ({
      building: room.category,
      roomNumber: room.roomNumber,
      roomType: room.roomType,
      password: room.password,
      status: room.status,
      floor: room.floor,
      roomCode: room.matchingRoomNumber, // Use matchingRoomNumber as roomCode
    }))

    // Group by room type
    const roomsByType = mappedRooms.reduce(
      (acc, room) => {
        if (!acc[room.roomType]) {
          acc[room.roomType] = []
        }
        acc[room.roomType].push(room)
        return acc
      },
      {} as Record<string, typeof mappedRooms>,
    )

    return NextResponse.json({
      availableRooms: mappedRooms,
      roomsByType,
      total: mappedRooms.length,
      location: location || "ALL",
      source: "firebase", // Indicate data source
    })
  } catch (error) {
    console.error("Error fetching available rooms:", error)
    return NextResponse.json(
      { error: "Failed to fetch available rooms", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
