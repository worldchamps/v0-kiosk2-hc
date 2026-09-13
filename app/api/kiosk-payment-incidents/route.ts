import { NextResponse, type NextRequest } from 'next/server'
import { getDB } from '@/lib/firebase-admin'
import { getKioskScope } from '@/lib/kiosk-scope'
import { verifyIncident } from '@/electron/cash-incidents'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    if (Number(request.headers.get('content-length')) > 10000) return NextResponse.json({ error: 'Request too large' }, { status: 413 })
    const incident = await request.json()
    if (!verifyIncident(incident, request.headers.get('x-kiosk-incident-signature'), process.env.FIREBASE_PRIVATE_KEY, getKioskScope())) {
      return NextResponse.json({ error: 'Invalid kiosk incident' }, { status: 403 })
    }
    // A lost response retries the same ID; never overwrite an existing review.
    await getDB().ref(`kiosk_payment_incidents/${incident.id}`).transaction(current => current || incident, undefined, false)
    return NextResponse.json({ success: true, id: incident.id })
  } catch {
    return NextResponse.json({ error: 'PMS record delivery failed' }, { status: 503 })
  }
}
