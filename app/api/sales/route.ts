import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createSheetsClient } from "@/lib/google-sheets"
import { normalizeDate } from "@/lib/date-utils"

export async function GET(request: NextRequest) {
  try {
    const sheets = createSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || ""

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Spreadsheet ID not configured" }, { status: 500 })
    }

    const { searchParams } = new URL(request.url)
    const month = searchParams.get("month")
    const year = searchParams.get("year")

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "CheckoutedReservation!A2:M",
    })

    const rows = response.data.values

    if (!rows || rows.length === 0) {
      return NextResponse.json({
        sales: [],
        message: "No sales data found",
      })
    }

    const salesData = rows.map((row) => {
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

    let filteredSales = [...salesData]
    if (month && year) {
      filteredSales = filteredSales.filter((sale) => {
        if (!sale.checkInDate) return false
        const date = new Date(sale.checkInDate)
        return date.getMonth() + 1 === Number.parseInt(month) && date.getFullYear() === Number.parseInt(year)
      })
    }

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
