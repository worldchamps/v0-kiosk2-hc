const { randomUUID, createHash } = require('node:crypto')
const { verifyTicket, operationId, supported } = require('./card-issue-proof')
const { verifyRequest } = require('./pms-card-request')

const supportsCardKey = (property, building) => property === 'property1' || property === 'property3' && building === 'A'
const enabled = env => supportsCardKey(env.KIOSK_PROPERTY_ID || 'property3', env.KIOSK_BUILDING) && env.CARD_DISPENSER_ENABLED === 'true'
const roomKey = value => typeof value === 'string' ? value.replace(/[\s-]+/g, '').toUpperCase() : ''
function scopedRoom(value, env) {
  const room = roomKey(value)
  if (!(env.KIOSK_PROPERTY_ID === 'property1' ? /^[CD]\d{3}$/ : /^A\d{3}$/).test(room) || !enabled(env)) throw new Error('room_out_of_scope')
  return room
}
const defaultProfile = () => ({ sectors: Array.from({ length: 16 }, (_, sector) => ({ sector, keyA: 'FFFFFFFFFFFF', keyB: 'FFFFFFFFFFFF' })) })
function validateProfile(value) {
  if (!value || Object.keys(value).join() !== 'sectors' || !Array.isArray(value.sectors) || !value.sectors.length || value.sectors.length > 16) throw new Error('invalid_profile')
  const seen = new Set()
  for (const item of value.sectors) {
    if (!item || Object.keys(item).sort().join() !== 'keyA,keyB,sector' || !Number.isInteger(item.sector) || item.sector < 0 || item.sector > 15 || seen.has(item.sector) ||
      !['keyA', 'keyB'].every(key => typeof item[key] === 'string' && /^[a-fA-F0-9]{12}$/.test(item[key]))) throw new Error('invalid_profile')
    seen.add(item.sector)
  }
  return value
}
const publicResult = result => Object.fromEntries(['success', 'reason', 'settled', 'state', 'failedSectors', 'bits', 'sensors', 'moving', 'empty', 'low', 'hopperFull', 'captureFull', 'uidChanged', 'uidMatchesSource', 'issueMode', 'dispenseMs', 'port', 'baudRate', 'address', 'errorStage', 'receivedBytes', 'failedCommand', 'deviceCode', 'failedBlock', 'responseBytes']
  .filter(key => Object.hasOwn(result, key)).map(key => [key, result[key]]))

function createCardKeyService({ env, store, bridge, authorize, isIdle, setBusy, token, timeoutMs = 105000 }) {
  let busy = false, unresolved = false
  function local(event) {
    return event?.senderFrame === event?.sender?.mainFrame && (() => { try { return new URL(event.senderFrame.url).origin === 'http://localhost:3000' } catch { return false } })()
  }
  function check(event, input, customer = false) {
    if (!local(event)) throw new Error('local_frame_required')
    if (!enabled(env)) throw new Error('disabled')
    if (customer) return null
    const auth = authorize(event, input?.password)
    if (!auth.success) return auth
    return null
  }
  function hardware(type, payload, event) {
    if (type !== 'status') unresolved = true
    return new Promise(resolve => {
      const requestId = randomUUID()
      let timer, unsubscribe = () => {}, finished = false
      const finish = result => { if (finished) return; finished = true; clearTimeout(timer); unsubscribe(); resolve(result) }
      unsubscribe = bridge.subscribeMessage(message => {
        if (message.requestId !== requestId) return
        if (message.type === 'card_result') finish(message)
        else if (message.type === 'card_progress' && ['insert_original', 'reading', 'issuing', 'presented', 'insert_return'].includes(message.state)) {
          if (!event.sender.isDestroyed()) event.sender.send('card-key:progress', { state: message.state })
        }
      })
      timer = setTimeout(() => finish({ success: false, reason: 'timeout', settled: false }), timeoutMs)
      try {
        if (!bridge.send({ type: 'card_' + type, requestId, token, ...payload })) finish({ success: false, reason: 'disconnected', settled: false })
      } catch { finish({ success: false, reason: 'disconnected', settled: false }) }
    })
  }
  return {
    available(event) { return local(event) && enabled(env) },
    checkInRequired(event) { return local(event) && supported(env) },
    async run(event, command, input = {}) {
      let acquired = false
      try {
        const auth = check(event, input, ['ready', 'checkin_issue', 'remote_issue'].includes(command))
        if (auth) return auth
        const active = store.read('active-check-in')
        if (active?.id) {
          const pending = store.read(active.id)
          if (pending?.result?.settled === true) store.write('active-check-in', null)
          else { unresolved = true; setBusy(true) }
        }
        // Return durable results before idle/preflight checks: a retry must never
        // take another card, even after restart or a newly signed server response.
        let claim
        const delivery = command === 'checkin_issue' || command === 'remote_issue'
        const kind = command === 'remote_issue' ? 'remote' : 'checkin'
        if (delivery) {
          claim = command === 'remote_issue' ? verifyRequest(input.envelope, env) : verifyTicket(input.ticket, env)
          const previous = store.read('operation-' + claim.operationId)
          if (previous) {
            if (previous.room !== claim.room || previous.kind !== kind) throw new Error('invalid_checkin_ticket')
            return previous.result || { success: false, reason: 'inspection_required', settled: false }
          }
        }
        if (command === 'list') return { success: true, rooms: store.list(), sectors: (store.read('profile') || defaultProfile()).sectors.map(item => item.sector) }
        if (busy || !isIdle()) return { success: false, reason: 'busy', settled: false }
        if (unresolved && !['status', 'capture'].includes(command)) return { success: false, reason: 'inspection_required', settled: false }
        busy = acquired = true; setBusy(true)
        if (command === 'profile') {
          store.write('profile', validateProfile(input.profile))
          return { success: true }
        }
        if (!bridge.isConnected) return { success: false, reason: 'disconnected', settled: !unresolved }
        let result
        if (command === 'ready') {
          const room = scopedRoom(input.room, env)
          if (typeof input.reservationId === 'string' && input.reservationId.length <= 200) {
            const previous = store.read('operation-' + operationId(env.KIOSK_PROPERTY_ID || 'property3', input.reservationId))
            if (previous?.kind === 'checkin' && previous.room === room) return { success: true, settled: true }
          }
          if (!store.read('room-' + room)) return { success: false, reason: 'room_not_registered', settled: true }
          result = await hardware('status', {}, event)
          if (result.success && (result.reason || result.empty || result.sensors || result.moving))
            result = { ...result, success: false, reason: result.reason || (result.empty ? 'empty' : 'card_present') }
        } else if (delivery) {
          const room = scopedRoom(claim.room, env), id = 'operation-' + claim.operationId
          const record = store.read('room-' + room)
          if (!record) return { success: false, reason: 'room_not_registered', settled: true }
          unresolved = true
          store.write('active-check-in', { id })
          store.write(id, { room, kind, state: 'started', occurredAt: new Date().toISOString() })
          result = await hardware('issue', { record, issueMode: 'uid_only' }, event)
          store.write(id, { room, kind, state: 'complete', result: publicResult(result) })
          if (result.settled === true) store.write('active-check-in', null)
        } else if (command === 'register') {
          if (input.confirmed !== true) return { success: false, reason: 'confirmation_required' }
          const room = scopedRoom(input.room, env), id = 'room-' + room, previous = store.read(id)
          if (previous && input.replaceRegisteredAt !== previous.registeredAt) return { success: false, reason: 'replacement_confirmation_required' }
          const profile = validateProfile(store.read('profile') || defaultProfile())
          result = await hardware('register', { profile }, event)
          if (result.success) {
            if (!result.blocks || !/^(?:[a-f0-9]{8}|[a-f0-9]{14})$/.test(result.uid || '')) throw new Error('invalid_record')
            store.write(id, { room, registeredAt: new Date().toISOString(), profile, uid: result.uid, blocks: result.blocks })
          }
        } else if (command === 'issue') {
          const room = scopedRoom(input.room, env)
          const issueMode = input.issueMode ?? 'full'
          if (!['full', 'uid_only'].includes(issueMode)) return { success: false, reason: 'invalid_issue_mode' }
          if (input.confirmed !== true || typeof input.operationKey !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(input.operationKey)) return { success: false, reason: 'confirmation_required' }
          const id = 'operation-' + createHash('sha256').update(room + ':' + input.operationKey).digest('hex')
          const previous = store.read(id)
          if (previous) {
            if ((previous.issueMode || 'full') !== issueMode) return { success: false, reason: 'issue_mode_mismatch' }
            unresolved = !previous.result || previous.result.settled === false
            return previous.result || { success: false, reason: 'inspection_required', settled: false }
          }
          const record = store.read('room-' + room)
          if (!record) return { success: false, reason: 'room_not_registered', settled: true }
          store.write(id, { room, issueMode, state: 'started', occurredAt: new Date().toISOString() })
          result = await hardware('issue', { record, issueMode }, event)
          store.write(id, { room, issueMode, state: 'complete', result: publicResult(result) })
        } else if (['status', 'capture', 'return', 'reset'].includes(command)) {
          if (command !== 'status' && input.confirmed !== true) return { success: false, reason: 'confirmation_required' }
          result = await hardware(command, {}, event)
        } else return { success: false, reason: 'invalid_command' }
        if (['status', 'ready'].includes(command)) {
          if (result.success) unresolved = Boolean(result.sensors || result.moving)
          // A failed read-only poll must not create a pending card movement.
          // Preserve a lock that was already set by an unresolved operation.
        } else if (Object.hasOwn(result, 'settled')) unresolved = !result.settled
        if (active?.id && !unresolved && ['status', 'capture'].includes(command) && result.success) {
          const previous = store.read(active.id)
          store.write(active.id, { ...previous, state: 'complete', result: {
            success: false, reason: 'operator_recovered', settled: true,
          } })
          store.write('active-check-in', null)
        }
        return { ...publicResult(result), recoveryRequired: unresolved }
      } catch (error) {
        return { success: false, reason: ['disabled', 'invalid_checkin_ticket'].includes(error.message) ? error.message : 'card_operation_failed', settled: !unresolved, recoveryRequired: unresolved }
      } finally { if (acquired) { busy = false; setBusy(unresolved) } }
    },
  }
}
module.exports = { createCardKeyService, supportsCardKey, enabled, roomKey, scopedRoom, defaultProfile, validateProfile, publicResult }
