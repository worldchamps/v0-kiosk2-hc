// API utility functions with proper key management

/**
 * Fetch reservations by guest name (public operation)
 */
export async function fetchReservationByName(name: string) {
  // API 키를 클라이언트 코드에서 제거
  const response = await fetch(`/api/reservations?name=${encodeURIComponent(name)}`, {
    method: "GET",
  })

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`)
  }

  return response.json()
}

/**
 * Check in a guest by reservation ID (public operation)
 */
export async function checkInGuest(reservationId: string) {
  // API 키를 클라이언트 코드에서 제거
  const response = await fetch("/api/check-in", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ reservationId }),
  })

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`)
  }

  return response.json()
}

/**
 * Admin operations - these would be used in an admin panel, not in the public kiosk
 */

/**
 * Create a new reservation (admin operation)
 */
export async function createReservation(reservationData: any, adminKey: string) {
  const response = await fetch("/api/reservations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": adminKey, // Admin key passed from admin interface
    },
    body: JSON.stringify(reservationData),
  })

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`)
  }

  return response.json()
}

/**
 * Update an existing reservation (admin operation)
 */
export async function updateReservation(reservationId: string, updateData: any, adminKey: string) {
  const response = await fetch("/api/reservations", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": adminKey, // Admin key passed from admin interface
    },
    body: JSON.stringify({
      reservationId,
      ...updateData,
    }),
  })

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`)
  }

  return response.json()
}

/**
 * Delete a reservation (admin operation)
 */
export async function deleteReservation(reservationId: string, adminKey: string) {
  const response = await fetch(`/api/reservations?id=${encodeURIComponent(reservationId)}`, {
    method: "DELETE",
    headers: {
      "x-api-key": adminKey, // Admin key passed from admin interface
    },
  })

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`)
  }

  return response.json()
}
