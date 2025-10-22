import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { headers } from "next/headers"
import { db, getPropertyFromRoomNumber } from "@/lib/firebase-admin"

// API Key for authentication
const API_KEY = process.env.API_KEY || ""
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || ""

async function authenticateRequest(request: NextRequest) {
  const headersList = await headers()
  const apiKey = headersList.get("x-api-key")

  if (!apiKey) {
    return false
  }

  return apiKey === API_KEY || apiKey === ADMIN_API_KEY
}

export async function POST(request: NextRequest) {
  try {
    // Authenticate the request
    if (!(await authenticateRequest(request))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { roomNumber, password } = body

    if (!roomNumber || !password) {
      return NextResponse.json({ error: "Room number and password are required" }, { status: 400 })
    }

    // Determine property from room number
    const property = getPropertyFromRoomNumber(roomNumber)

    // Add to print queue in Firebase
    const ref = db.ref(`print_queue/${property}`)
    const newRef = ref.push()

    await newRef.set({
      id: newRef.key,
      action: "remote-print",
      roomNumber: roomNumber,
      password: password,
      status: "pending",
      property: property,
      createdAt: new Date().toISOString(),
      completedAt: null,
    })

    console.log(`[RemotePrint] Added to ${property} print queue:`, roomNumber)

    return NextResponse.json({
      success: true,
      message: "Print job added to queue",
      printJobId: newRef.key,
    })
  } catch (error) {
    console.error("[RemotePrint] Error:", error)
    return NextResponse.json({ error: "Failed to add print job", details: (error as Error).message }, { status: 500 })
  }
}
