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

    console.log("[v0] Checking room availability before booking...")
    const statusCheckResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Beach Room Status!A2:G",
    })

    const statusRows = statusCheckResponse.data.values
    let roomStillAvailable = false
    let roomRowIndex = -1

    if (statusRows) {
      for (let i = 0; i < statusRows.length; i++) {
        if (statusRows[i][6] === roomCode) {
          roomRowIndex = i
          const currentStatus = (statusRows[i][4] || "").trim()
          if (currentStatus === "공실") {
            roomStillAvailable = true
          }
          break
        }
      }
    }

    if (!roomStillAvailable) {
      console.log("[v0] Room is no longer available:", roomCode)
      return NextResponse.json(
        { error: "이 객실은 방금 예약이 완료되었습니다. 다른 객실을 선택해주세요." },
        { status: 409 },
      )
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
      roomCode, // Use roomCode (G열) instead of roomNumber for consistency
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
    if (roomRowIndex >= 0) {
      console.log(`[v0] Found room at row ${roomRowIndex + 2}, updating status...`)
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Beach Room Status!E${roomRowIndex + 2}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [["사용 중"]],
        },
      })
      console.log(`[v0] Room status updated to '사용 중' for ${roomCode}`)
    }

    try {
      console.log("[v0] Adding to Firebase PMS Queue with roomCode:", roomCode)
      await addToPMSQueue({
        roomNumber: roomCode, // Use roomCode (G열) instead of roomNumber for consistency
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
        password,
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
