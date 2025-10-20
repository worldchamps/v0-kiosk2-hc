import { google } from "googleapis"

/**
 * 구글 시트 열 인덱스 정의
 * 주의: 실제 스프레드시트의 열 순서와 일치해야 합니다
 */
export const SHEET_COLUMNS = {
  PLACE: 0,
  GUEST_NAME: 1,
  RESERVATION_ID: 2,
  BOOKING_PLATFORM: 3,
  ROOM_TYPE: 4,
  PRICE: 5,
  PHONE_NUMBER: 6,
  CHECK_IN_DATE: 7,
  CHECK_OUT_DATE: 8,
  ROOM_NUMBER: 9,
  PASSWORD: 10,
  CHECK_IN_STATUS: 11,
  CHECK_IN_TIME: 12,
  FLOOR: 13, // 14번째 열에 층수 정보 추가
}

/**
 * Beach Room Status 시트 열 인덱스 정의
 */
export const BEACH_ROOM_STATUS_COLUMNS = {
  ROOM_NUMBER: 6, // G열: 객실 호수
  PASSWORD: 3, // D열: 객실 비밀번호
  FLOOR: 5, // F열: 객실 층수
}

/**
 * 개인 키를 올바른 형식으로 변환하는 함수
 */
export function formatPrivateKey(key: string): string {
  // 이미 실제 줄바꿈이 포함된 경우 그대로 반환
  if (key.includes("\n") && !key.includes("\\n")) return key

  // 스케이프된 줄바꿈을 실제 줄바꿈으로 변환
  const formattedKey = key.replace(/\\n/g, "\n")

  return formattedKey
}

/**
 * Google Sheets API 클라이언트 생성
 */
export function createSheetsClient() {
  const privateKey = formatPrivateKey(process.env.GOOGLE_SHEETS_PRIVATE_KEY || "")

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL || "",
      private_key: privateKey,
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  })

  return google.sheets({ version: "v4", auth })
}

/**
 * 디버깅용: 구글 시트 열 인덱스 검증
 */
export async function validateSheetColumns(spreadsheetId: string) {
  try {
    const sheets = createSheetsClient()

    // 헤더 행 가져오기
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Reservations!A1:M1",
    })

    const headers = response.data.values?.[0] || []

    // 예상되는 헤더 이름 (실제 스프레드시트에 맞게 수정 필요)
    const expectedHeaders = [
      "Place",
      "guestName",
      "reservationId",
      "bookingPlatform",
      "roomType",
      "price",
      "Phone number",
      "checkInDate",
      "checkOutDate",
      "roomNumber",
      "password",
      "Check-in Status",
      "Check-in Time",
    ]

    // 헤더 비교
    const validation = {
      actualHeaders: headers,
      expectedHeaders,
      matches: headers.length === expectedHeaders.length,
      mismatches: [],
    }

    // 불일치 항목 찾기
    if (headers.length === expectedHeaders.length) {
      for (let i = 0; i < headers.length; i++) {
        if (headers[i] !== expectedHeaders[i]) {
          validation.mismatches.push({
            index: i,
            expected: expectedHeaders[i],
            actual: headers[i],
          })
          validation.matches = false
        }
      }
    }

    return validation
  } catch (error) {
    console.error("Error validating sheet columns:", error)
    return {
      error: error instanceof Error ? error.message : String(error),
      success: false,
    }
  }
}

/**
 * Beach Room Status 시트에서 객실 정보 조회
 */
export async function getRoomInfoFromStatus(spreadsheetId: string, roomNumber: string) {
  try {
    const sheets = createSheetsClient()

    // Beach Room Status 시트에서 모든 데이터 가져오기
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Beach Room Status!A:G", // A열부터 G열까지
    })

    const rows = response.data.values
    if (!rows || rows.length <= 1) {
      console.warn("No data found in Beach Room Status sheet")
      return null
    }

    // 객실 호수와 매칭되는 행 찾기
    for (let i = 1; i < rows.length; i++) {
      // 헤더 행 제외
      const row = rows[i]
      if (row && row[BEACH_ROOM_STATUS_COLUMNS.ROOM_NUMBER] === roomNumber) {
        return {
          roomNumber: row[BEACH_ROOM_STATUS_COLUMNS.ROOM_NUMBER] || "",
          password: row[BEACH_ROOM_STATUS_COLUMNS.PASSWORD] || "",
          floor: row[BEACH_ROOM_STATUS_COLUMNS.FLOOR] || "",
        }
      }
    }

    console.warn(`Room ${roomNumber} not found in Beach Room Status sheet`)
    return null
  } catch (error) {
    console.error("Error getting room info from Beach Room Status:", error)
    return null
  }
}

/**
 * Beach Room Status 시트의 객실 상태 업데이트
 */
export async function updateRoomStatus(spreadsheetId: string, roomNumber: string, status: string) {
  try {
    const sheets = createSheetsClient()

    // Beach Room Status 시트에서 모든 데이터 가져오기
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Beach Room Status!A2:G",
    })

    const rows = response.data.values
    if (!rows || rows.length === 0) {
      throw new Error("No data found in Beach Room Status sheet")
    }

    // 객실 호수와 매칭되는 행 찾기 (B열, index 1)
    let rowIndex = -1
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][1] === roomNumber) {
        rowIndex = i + 2 // +2 because we start at A2 (1-indexed)
        break
      }
    }

    if (rowIndex === -1) {
      throw new Error(`Room ${roomNumber} not found in Beach Room Status sheet`)
    }

    // 상태 열(D열) 업데이트
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Beach Room Status!D${rowIndex}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[status]],
      },
    })

    console.log(`[Google Sheets] Updated room ${roomNumber} status to ${status}`)
    return { success: true, roomNumber, status, rowIndex }
  } catch (error) {
    console.error("Error updating room status in Beach Room Status:", error)
    throw error
  }
}
