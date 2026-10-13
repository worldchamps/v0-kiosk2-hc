import { NextResponse, type NextRequest } from 'next/server'
import { getDB } from '@/lib/firebase-admin'
import { getKioskScope } from '@/lib/kiosk-scope'
import { verifyOperations } from '@/electron/kiosk-operations'

export const dynamic = 'force-dynamic'
export async function POST(request: NextRequest) {
  try {
    const raw = await request.text()
    if (raw.length > 8000) return NextResponse.json({ error: 'Too large' }, { status: 413 })
    const body = JSON.parse(raw), scope = getKioskScope()
    if (!verifyOperations(body, request.headers.get('x-kiosk-operations-signature'), process.env.FIREBASE_PRIVATE_KEY,
      { deviceId: process.env.KIOSK_DEVICE_ID, property: scope.property, building: scope.building || '' }))
      return NextResponse.json({ error: 'Invalid device report' }, { status: 403 })
    const db = getDB(), ref = db.ref(`kiosk_operations/commands/${body.deviceId}`)
    const job = (await ref.once('value')).val()
    if (body.result && job?.request?.id === body.result.id && job.status === 'pending') {
      await ref.transaction(current => {
        if (current === null) return null
        return current.request?.id === body.result.id && current.status === 'pending'
          ? { ...current, ...body.result, completedAt: Date.now() } : current
      })
    }
    await db.ref(`kiosk_operations/devices/${body.deviceId}`).set({ property: body.property, building: body.building,
      version: body.version, lastSeen: Date.now(), recovery: body.recovery, printer: body.printer })
    return NextResponse.json({ command: job?.status === 'pending' && job.request.expiresAt > Date.now() && job.request.id !== body.result?.id ? job : null })
  } catch { return NextResponse.json({ error: 'Device report unavailable' }, { status: 503 }) }
}
