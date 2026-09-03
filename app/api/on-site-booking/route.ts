import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createSheetsClient } from "@/lib/google-sheets"
import { addToPMSQueue, claimPayment, releasePaymentClaim } from "@/lib/firebase-admin"
import { sendAligoSMS, formatBookingMessage } from "@/lib/aligo-sms"
import { getRoomInfoByMatchingNumber, updateRoomStatusInFirebase } from "@/lib/firebase-beach-rooms"
import { getPropertyFromRoomNumber } from "@/lib/property-utils"
import { isShortStayAvailable, isShortStayRestrictedProperty } from "@/lib/short-stay-policy"
import { getPmsRateAmount } from "@/lib/pms-rates"
import { verifyCompletedCardPayment } from "@/lib/toss-pay"
import { verifyTossFrontPaymentProof } from "@/lib/toss-front"

export async function POST(request: NextRequest) {
  let claimedPayment: { provider: "toss_pay" | "toss_front"; id: string } | null = null
  let reservationSaved = false

  try {
    const body = await request.json()
    const {
      guestName,
      phoneNumber,
      roomNumber,
      roomCode,
      roomType,
      building,
      price: requestedPrice,
      checkInDate,
      checkOutDate,
      password,
      stayType,
      stayTypeLabel,
      payment,
    } = body
    const rateStayType = stayType === "overnight" || stayType === "shortStay" ? stayType : undefined
    const normalizedStayTypeLabel = stayType === "overnight" ? "숙박" : stayType === "shortStay" ? "대실" : ""
    const propertyId = getPropertyFromRoomNumber(roomCode || roomNumber || "")

    if (payment?.method !== "CARD" && payment?.method !== "CASH") {
      return NextResponse.json({ error: "올바른 결제수단 정보가 필요합니다." }, { status: 400 })
    }

    const price = rateStayType
      ? await getPmsRateAmount({
          roomCode: roomCode || roomNumber || "",
          stayType: rateStayType,
          paymentMethod: payment.method,
        })
      : null

    if (stayType === "shortStay" && isShortStayRestrictedProperty(propertyId) && !isShortStayAvailable()) {
      return NextResponse.json({ error: "대실 예약은 오후 9시 이전에만 가능합니다." }, { status: 403 })
    }

    console.log("[v0] On-site booking request:", { guestName, phoneNumber, roomNumber, roomCode, roomType })
    console.log("[v0] roomCode received from frontend:", roomCode)

    // Validate required fields
    if (
      !guestName ||
      !phoneNumber ||
      !roomNumber ||
      !roomCode ||
      !roomType ||
      !checkInDate ||
      !checkOutDate ||
      !stayType ||
      !price
    ) {
      return NextResponse.json(
        { error: "필수 정보가 누락되었거나 Firebase PMS에 유효한 요금이 없습니다." },
        { status: 400 },
      )
    }

    if (Number(requestedPrice) !== price) {
      console.warn("[v0] Correcting mismatched on-site price:", { requestedPrice, price, roomType, stayType })
    }

    if (payment?.method === "CARD") {
      try {
        if (payment.provider === "TOSS_FRONT") {
          verifyTossFrontPaymentProof(payment.front, price)
        } else {
          if (!payment.payToken || !payment.orderNo) {
            return NextResponse.json({ error: "카드 결제 정보가 누락되었습니다." }, { status: 400 })
          }
          await verifyCompletedCardPayment({
            payToken: payment.payToken,
            orderNo: payment.orderNo,
            expectedAmount: price,
          })
        }
      } catch (paymentError) {
        console.error("[v0] Card payment verification failed:", paymentError)
        return NextResponse.json(
          { error: paymentError instanceof Error ? paymentError.message : "카드 결제를 확인하지 못했습니다." },
          { status: 402 },
        )
      }
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

    // Generate the reservation ID before claiming the payment so the payment
    // record can always be traced back to its reservation.
    const reservationId = `ONSITE-${Date.now()}`

    if (payment.method === "CARD") {
      const isFront = payment.provider === "TOSS_FRONT"
      const provider = isFront ? "toss_front" : "toss_pay"
      const paymentId = isFront ? payment.front.paymentKey : payment.payToken
      const details: Record<string, string | number> = isFront
        ? {
            reservationId,
            roomCode,
            stayType,
            paymentKey: payment.front.paymentKey,
            paymentMethod: payment.front.paymentMethod,
            approvalNumber: payment.front.approvalNumber,
            amount: payment.front.amount,
            tax: payment.front.tax,
            supplyValue: payment.front.supplyValue,
            timestamp: payment.front.timestamp,
            installment: payment.front.installment,
            tid: payment.front.tid || "",
            issuerName: payment.front.issuerName || "",
            maskedCardNumber: payment.front.maskedCardNumber || "",
            van: payment.front.van || "",
            vanTransactionManagementId: payment.front.vanTransactionManagementId || "",
            signature: payment.front.signature,
          }
        : { reservationId, roomCode, stayType, orderNo: payment.orderNo, amount: price }
      const claimed = await claimPayment(provider, paymentId, details)
      if (!claimed) {
        return NextResponse.json({ error: "이미 예약에 사용된 카드 결제입니다." }, { status: 409 })
      }
      claimedPayment = { provider, id: paymentId }
    }

    console.log("[v0] Room info from Firebase:", {
      matchingRoomNumber: roomInfo.matchingRoomNumber,
      roomNumber: roomInfo.roomNumber,
      roomCodeToUse: roomCode,
    })

    // Prepare reservation data
    const reservationData = [
      "경주 더 비치스테이", // Place
      guestName, // Guest Name
      reservationId, // Reservation ID
      "키오스크", // Booking Platform
      roomType, // Room Type
      price, // Price
      phoneNumber, // Phone Number
      checkInDate, // Check-in Date
      checkOutDate, // Check-out Date
      roomCode, // Use roomCode (matchingRoomNumber)
      password || roomInfo.password, // Use password from Firebase if not provided
      "Checked In", // Check-in Status - 현장예약은 즉시 체크인
      new Date().toISOString(), // Check-in Time - 현재 시간
      roomInfo.floor, // Floor from Firebase
    ]
    reservationData[3] = "키오스크"

    console.log("[v0] Writing to Reservations sheet - Room Number (column J):", roomCode)

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
    reservationSaved = true
    console.log("[v0] Reservation added to Google Sheets")

    /* SMS 발송 비활성화 (사용자 요청)
    if (phoneNumber) {
      console.log("[v0] 📱 Sending SMS notification to:", phoneNumber)
      try {
        const smsMessage = formatBookingMessage({
          guestName,
          roomNumber: roomCode,
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
    */

    console.log("[v0] Updating room status to '사용 중' in Firebase...")
    const updateSuccess = await updateRoomStatusInFirebase(roomCode, "사용 중")

    if (updateSuccess) {
      console.log(`[v0] ✅ Room status updated to '사용 중' for ${roomCode}`)
    } else {
      console.error(`[v0] ❌ Failed to update room status for ${roomCode}`)
      // Continue even if Firebase update fails - reservation is already saved
    }

    try {
      console.log("[v0] Adding to Firebase PMS Queue with roomCode:", roomCode)
      await addToPMSQueue({
        roomNumber: roomCode,
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
        password: password || roomInfo.password,
        roomType,
        price,
        stayType,
        stayTypeLabel: normalizedStayTypeLabel || stayTypeLabel,
        paymentReceipt:
          payment.method === "CARD" && payment.provider === "TOSS_FRONT"
            ? {
                provider: "TOSS_FRONT",
                amount: payment.front.amount,
                tax: payment.front.tax,
                supplyValue: payment.front.supplyValue,
                approvalNumber: payment.front.approvalNumber,
                timestamp: payment.front.timestamp,
                installment: payment.front.installment,
                issuerName: payment.front.issuerName || "",
                maskedCardNumber: payment.front.maskedCardNumber || "",
                tid: payment.front.tid || "",
              }
            : null,
      },
    })
  } catch (error) {
    if (claimedPayment && !reservationSaved) {
      try {
        await releasePaymentClaim(claimedPayment.provider, claimedPayment.id)
      } catch (releaseError) {
        console.error("[v0] Failed to release payment claim:", releaseError)
      }
    }
    console.error("[v0] Error creating on-site booking:", error)
    return NextResponse.json(
      { error: "Failed to create booking", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
