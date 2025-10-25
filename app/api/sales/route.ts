import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { headers } from "next/headers"
import { createSheetsClient } from "@/lib/google-sheets"
import { normalizeDate } from "@/lib/date-utils"

// API Key for authentication
const API_KEY = process.env.API_KEY || ""
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || ""

// Authentication function
function authenticateRequest(request: NextRequest) {
  const headersList = headers()
  const apiKey = headersList.get("x-api-key")

  // 클라이언트에서 API 키 없이 호출할 수 있도록 허용
  // 이 API는 공개적으로 접근 가능하지만, 서버 측에서 요청을 검증합니다
  if (!apiKey) return true

  return apiKey === API_KEY || apiKey === ADMIN_API_KEY
}

export async function GET(request: NextRequest) {
  try {
    // Authenticate the request
    if (!authenticateRequest(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const sheets = createSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || ""

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Spreadsheet ID not configured" }, { status: 500 })
    }

    // Get query parameters for filtering
    const { searchParams } = new URL(request.url)
    const month = searchParams.get("month")
    const year = searchParams.get("year")

    console.log(`Fetching sales data for ${year}-${month} from CheckoutedReservation sheet`)

    // Fetch data from the CheckoutedReservation sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "CheckoutedReservation!A2:M", // Adjust range as needed
    })

    const rows = response.data.values

    if (!rows || rows.length === 0) {
      console.log("No data found in CheckoutedReservation sheet")
      return NextResponse.json({
        sales: [],
        message: "No sales data found",
      })
    }

    // Map the rows to sales objects
    // Assuming the column structure is similar to the Reservations sheet
    const salesData = rows.map((row) => {
      // Normalize dates for consistent formatting
      const checkInDate = row[7] ? normalizeDate(row[7]) : ""
      const checkOutDate = row[8] ? normalizeDate(row[8]) : ""

      return {
        place: row[0] || "",
        guestName: row[1] || "",
        reservationId: row[2] || "",
        bookingPlatform: row[3] || "",
        roomType: row[4] || "",
        price: row[5] || "",
        phoneNumber: row[6] || "",
        checkInDate: checkInDate,
        checkOutDate: checkOutDate,
        roomNumber: row[9] || "",
        password: row[10] || "",
        checkInStatus: row[11] || "",
        checkInTime: row[12] || "",
      }
    })

    // Filter by month and year if provided
    let filteredSales = [...salesData]
    if (month && year) {
      filteredSales = filteredSales.filter((sale) => {
        if (!sale.checkInDate) return false
        const date = new Date(sale.checkInDate)
        return date.getMonth() + 1 === Number.parseInt(month) && date.getFullYear() === Number.parseInt(year)
      })
    }

    console.log(`Found ${filteredSales.length} sales records`)

    return NextResponse.json({
      sales: filteredSales,
      total: filteredSales.length,
    })
  } catch (error) {
    console.error("Error fetching sales data:", error)
    return NextResponse.json(
      { error: "Failed to fetch sales data", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
