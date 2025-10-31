import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createSheetsClient } from "@/lib/google-sheets"
import { addToPMSQueue } from "@/lib/firebase-admin"
import { sendAligoSMS, formatBookingMessage } from "@/lib/aligo-sms"
import { getRoomInfoByMatchingNumber, updateRoomStatusInFirebase } from "@/lib/firebase-beach-rooms"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { guestName, phoneNumber, roomNumber, roomCode, roomType, price, checkInDate, checkOutDate, password } = body

    console.log("[v0] On-site booking request:", { guestName, phoneNumber, roomNumber, roomCode, roomType })

    // Validate required fields
    if (!guestName || !phoneNumber || !roomNumber || !roomCode || !checkInDate || !checkOutDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    console.log("[v0] Checking room availability from Firebase...")
    const roomInfo = await getRoomInfoByMatchingNumber(roomCode)

    if (!roomInfo) {
      console.log("[v0] Room not found in Firebase:", roomCode)
      return NextResponse.json({ error: "객실을 찾을 수 없습니다." }, { status: 404 })
    }

    if (roomInfo.status !== "공실") {
      console.log("[v0] Room is no longer available:", roomCode, "Status:", roomInfo.status)
      return NextResponse.json(
        { error: "이 객실은 방금 예약이 완료되었습니다. 다른 객실을 선택해주세요." },
        { status: 409 },
      )
    }

    const sheets = createSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Spreadsheet ID not configured" }, { status: 500 })
    }

    // Generate reservation ID
    const reservationId = `ONSITE-${Date.now()}`

    const formattedRoomNumber = roomInfo.matchingRoomNumber
    console.log("[v0] Using matchingRoomNumber from Firebase:", formattedRoomNumber)

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
      formattedRoomNumber, // Use matchingRoomNumber directly (B321, A101, etc.)
      password || roomInfo.password, // Use password from Firebase if not provided
      "Checked In", // Check-in Status - 현장예약은 즉시 체크인
      new Date().toISOString(), // Check-in Time - 현재 시간
      roomInfo.floor, // Floor from Firebase
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

    if (phoneNumber) {
      console.log("[v0] 📱 Sending SMS notification to:", phoneNumber)
      try {
        const smsMessage = formatBookingMessage({
          guestName,
          roomNumber: formattedRoomNumber,
          checkInDate,
          checkOutDate,
          password: password || roomInfo.password,
        })

        const smsResult = await sendAligoSMS({
          phoneNumber,
          message: smsMessage,
        })

        if (smsResult.success) {
          console.log("[v0] ✅ SMS sent successfully")
        } else {
          console.error("[v0] ❌ SMS failed:", smsResult.message)
        }
      } catch (smsError) {
        console.error("[v0] ❌ SMS error:", smsError)
        // Continue even if SMS fails - booking is already complete
      }
    }

    console.log("[v0] Updating room status to '사용 중' in Firebase...")
    const updateSuccess = await updateRoomStatusInFirebase(roomCode, "사용 중")

    if (updateSuccess) {
      console.log(`[v0] ✅ Room status updated to '사용 중' for ${roomCode}`)
    } else {
      console.error(`[v0] ❌ Failed to update room status for ${roomCode}`)
      // Continue even if Firebase update fails - reservation is already saved
    }

    try {
      console.log("[v0] Adding to Firebase PMS Queue with roomCode:", formattedRoomNumber)
      await addToPMSQueue({
        roomNumber: formattedRoomNumber,
        guestName,
        checkInDate,
      })
      console.log("[v0] Successfully added to Firebase PMS Queue:", { roomCode: formattedRoomNumber, guestName })
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
        roomNumber: formattedRoomNumber,
        roomCode,
        checkInDate,
        checkOutDate,
        password: password || roomInfo.password,
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
