import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createSheetsClient } from "@/lib/google-sheets"
import { addToPMSQueue } from "@/lib/firebase-admin"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { guestName, phoneNumber, roomNumber, roomCode, roomType, price, checkInDate, checkOutDate, password } = body

    console.log("[v0] On-site booking request:", { guestName, phoneNumber, roomNumber, roomCode, roomType })

    // Validate required fields
    if (!guestName || !phoneNumber || !roomNumber || !roomCode || !checkInDate || !checkOutDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const sheets = createSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Spreadsheet ID not configured" }, { status: 500 })
    }

    // Generate reservation ID
    const reservationId = `ONSITE-${Date.now()}`

    // Prepare reservation data
    const reservationData = [
      "더 비치스테이", // Place
      guestName, // Guest Name
      reservationId, // Reservation ID
      "현장예약", // Booking Platform
      roomType, // Room Type
      price, // Price
      phoneNumber, // Phone Number
      checkInDate, // Check-in Date
      checkOutDate, // Check-out Date
      roomNumber, // Room Number
      password || "", // Password
      "Checked In", // Check-in Status - 현장예약은 즉시 체크인
      new Date().toISOString(), // Check-in Time - 현재 시간
      "", // Floor (will be filled from Beach Room Status)
    ]

    console.log("[v0] Adding reservation to Google Sheets...")
    // Append to Reservations sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Reservations!A:N",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [reservationData],
      },
    })
    console.log("[v0] Reservation added to Google Sheets")

    console.log("[v0] Updating room status to '사용 중'...")
    const statusResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Beach Room Status!A2:G",
    })

    const statusRows = statusResponse.data.values
    if (statusRows) {
      for (let i = 0; i < statusRows.length; i++) {
        // Match by roomCode (G열, index 6) for accurate identification
        if (statusRows[i][6] === roomCode) {
          console.log(`[v0] Found room at row ${i + 2}, updating status...`)
          // Update status column E (index 4 in 0-based, row i+2 in sheet)
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `Beach Room Status!E${i + 2}`,
            valueInputOption: "USER_ENTERED",
            requestBody: {
              values: [["사용 중"]],
            },
          })
          console.log(`[v0] Room status updated to '사용 중' for ${roomCode}`)
          break
        }
      }
    }

    try {
      console.log("[v0] Adding to Firebase PMS Queue with roomCode:", roomCode)
      await addToPMSQueue({
        roomNumber: roomCode, // G열의 roomCode 사용 (A###, B### 등)
        guestName,
        checkInDate,
      })
      console.log("[v0] Successfully added to Firebase PMS Queue:", { roomCode, guestName })
    } catch (firebaseError) {
      console.error("[v0] Failed to add to Firebase PMS Queue:", firebaseError)
      // Continue even if Firebase fails - Google Sheets update is primary
    }

    return NextResponse.json({
      success: true,
      message: "On-site booking completed successfully",
      data: {
        reservationId,
        guestName,
        roomNumber,
        roomCode,
        checkInDate,
        checkOutDate,
      },
    })
  } catch (error) {
    console.error("[v0] Error creating on-site booking:", error)
    return NextResponse.json(
      { error: "Failed to create booking", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
