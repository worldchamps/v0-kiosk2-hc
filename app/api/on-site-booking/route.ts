import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createSheetsClient } from "@/lib/google-sheets"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { guestName, phoneNumber, roomNumber, roomCode, roomType, price, checkInDate, checkOutDate, password } = body

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
      "Pending", // Check-in Status
      "", // Check-in Time
      "", // Floor (will be filled from Beach Room Status)
    ]

    // Append to Reservations sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Reservations!A:N",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [reservationData],
      },
    })

    const statusResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Beach Room Status!A2:G",
    })

    const statusRows = statusResponse.data.values
    if (statusRows) {
      for (let i = 0; i < statusRows.length; i++) {
        // Match by roomCode (G열, index 6) for accurate identification
        if (statusRows[i][6] === roomCode) {
          // Update status column E (index 4 in 0-based, row i+2 in sheet)
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `Beach Room Status!E${i + 2}`,
            valueInputOption: "USER_ENTERED",
            requestBody: {
              values: [["사용 중"]],
            },
          })
          break
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: "On-site booking completed successfully",
      data: {
        reservationId,
        guestName,
        roomNumber,
        checkInDate,
        checkOutDate,
      },
    })
  } catch (error) {
    console.error("Error creating on-site booking:", error)
    return NextResponse.json(
      { error: "Failed to create booking", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
