// Aligo SMS API integration
// API Documentation: https://smartsms.aligo.in/admin/api/spec.html

interface AligoSMSParams {
  phoneNumber: string
  message: string
}

interface AligoSMSResponse {
  result_code: string
  message: string
  msg_id?: string
  success_cnt?: number
  error_cnt?: number
  msg_type?: string
}

/**
 * Send SMS using Aligo API
 * @param phoneNumber - Recipient phone number (format: 01012345678)
 * @param message - SMS message content
 * @returns Promise with success status and details
 */
export async function sendAligoSMS({ phoneNumber, message }: AligoSMSParams): Promise<{
  success: boolean
  message: string
  details?: any
}> {
  try {
    // Get Aligo credentials from environment variables
    const apiKey = process.env.ALIGO_API_KEY
    const userId = process.env.ALIGO_USER_ID
    const senderPhone = process.env.ALIGO_SENDER_PHONE

    if (!apiKey || !userId || !senderPhone) {
      console.error("[Aligo SMS] Missing required environment variables")
      return {
        success: false,
        message: "SMS configuration is incomplete",
      }
    }

    // Clean phone number (remove hyphens and spaces)
    const cleanPhoneNumber = phoneNumber.replace(/[-\s]/g, "")

    // Validate phone number format
    if (!/^01[0-9]{8,9}$/.test(cleanPhoneNumber)) {
      console.error("[Aligo SMS] Invalid phone number format:", phoneNumber)
      return {
        success: false,
        message: "Invalid phone number format",
      }
    }

    console.log("[Aligo SMS] Sending SMS to:", cleanPhoneNumber)

    // Prepare form data for Aligo API
    const formData = new URLSearchParams()
    formData.append("key", apiKey)
    formData.append("user_id", userId)
    formData.append("sender", senderPhone)
    formData.append("receiver", cleanPhoneNumber)
    formData.append("msg", message)
    formData.append("msg_type", "SMS") // SMS or LMS (long message)
    formData.append("title", "더 비치스테이") // Title for LMS

    // Send request to Aligo API
    const response = await fetch("https://apis.aligo.in/send/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    })

    const data: AligoSMSResponse = await response.json()

    console.log("[Aligo SMS] Response:", data)

    // Check if SMS was sent successfully
    if (data.result_code === "1") {
      return {
        success: true,
        message: "SMS sent successfully",
        details: data,
      }
    } else {
      return {
        success: false,
        message: data.message || "Failed to send SMS",
        details: data,
      }
    }
  } catch (error) {
    console.error("[Aligo SMS] Error sending SMS:", error)
    return {
      success: false,
      message: "Failed to send SMS due to network error",
      details: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Format check-in completion message
 */
export function formatCheckInMessage({
  guestName,
  roomNumber,
  password,
  floor,
}: {
  guestName: string
  roomNumber: string
  password: string
  floor?: string
}): string {
  return `[더 비치스테이 체크인 완료]

${guestName}님, 체크인이 완료되었습니다.

객실 번호: ${roomNumber}
비밀번호: ${password}
${floor ? `층수: ${floor}` : ""}

즐거운 시간 되세요!`
}

/**
 * Format on-site booking confirmation message
 */
export function formatBookingMessage({
  guestName,
  roomNumber,
  checkInDate,
  checkOutDate,
  password,
}: {
  guestName: string
  roomNumber: string
  checkInDate: string
  checkOutDate: string
  password: string
}): string {
  return `[더 비치스테이 예약 확인]

${guestName}님, 예약이 완료되었습니다.

객실 번호: ${roomNumber}
체크인: ${checkInDate}
체크아웃: ${checkOutDate}
비밀번호: ${password}

감사합니다!`
}
