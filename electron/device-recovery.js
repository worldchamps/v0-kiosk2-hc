const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const { createHash, randomUUID } = require('node:crypto')
const { usesIntegratedCash } = require('./cash-device-profile')
const clean = value => String(value || 'reset_failed').replace(/[^a-z0-9_:-]/gi, '_').slice(0, 80)

function createDeviceRecovery({ configured, bridgeDevices = configured.filter(key => key !== 'cardTerminal'), property, building, bridge, cardKey, terminal, printer, restartServer, isIdle, canRestartServer = isIdle, onRecovered = () => {}, onBusy = () => {}, now = Date.now, sleep = wait, setTimeout: scheduleTimeout = setTimeout, clearTimeout: cancelTimeout = clearTimeout, commandTimeoutMs = 3000 }) {
  const hardware = Object.fromEntries(configured.map(key => [key, { state: 'recovering', reason: 'startup', lastResetAt: null, lastResetResult: null }]))
  let busy = false, serverFailures = 0, nextServerAttempt = 0, lastPing = 0, unresponsiveSince = 0
  let yieldRequested = false, integratedRequest = null, wakeYield = null
  const checkIdle = () => { if (yieldRequested || !isIdle()) throw Error('recovery_yielded') }
  const pause = async ms => {
    if (yieldRequested) return
    try { await Promise.race([sleep(ms), new Promise(resolve => { wakeYield = resolve })]) }
    finally { wakeYield = null }
  }
  const lastAttempt = Object.fromEntries(configured.map(key => [key, 0]))
  const update = (key, state, reason, result) => {
    hardware[key] = { ...hardware[key], state, reason, lastResetAt: now(), lastResetResult: result }
  }
  const packet = (a, b, c) => [36, a, b, c, (a + b + c) & 255]
  const validPacket = p => Array.isArray(p) && p.length === 5 && p[0] === 36 && p[4] === ((p[1] + p[2] + p[3]) & 255)
  const dispenserReply = (command1, command2) => {
    let buffer = []
    return message => {
      if (message.type !== 'dispenser_data' || !Array.isArray(message.data)) return
      buffer.push(...message.data)
      while (buffer.length >= 5) {
        if (buffer[0] !== 36) { buffer.shift(); continue }
        const p = buffer.slice(0, 5)
        if (!validPacket(p)) { buffer.shift(); continue }
        buffer = buffer.slice(5)
        if (p[1] === command1 && p[2] === command2) return p[3]
      }
    }
  }
  async function exchange(type, data, matches, timeout = commandTimeoutMs, fields = {}) {
    if (yieldRequested) throw Error('recovery_yielded')
    if (!bridge.isConnected) throw Error('bridge_disconnected')
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {}, done = false
      const finish = (error, value) => {
        if (done) return
        done = true; cancelTimeout(timer); unsubscribe()
        if (error) reject(Error(error)); else resolve(value)
      }
      const timer = scheduleTimeout(() => finish('timeout'), timeout)
      unsubscribe = bridge.subscribeMessage(message => {
        const result = matches(message)
        if (result instanceof Error) finish(result.message)
        else if (result === false) finish(message.source && message.reason ? clean(message.source + ':' + message.reason) : 'device_ng')
        else if (result !== undefined) finish(null, result)
      })
      try { if (!bridge.send({ type, ...(data ? { data } : {}), ...fields })) finish('bridge_disconnected') }
      catch { finish('bridge_disconnected') }
    })
  }
  async function integratedRecovery(target) {
    const requestId = randomUUID()
    integratedRequest = requestId
    try {
      await exchange('cash_board_recover', null, message => {
        if (message.type !== 'cash_board_result' || message.requestId !== requestId || message.target !== target) return
        if (message.reason === 'recovery_yielded') return Error('recovery_yielded')
        return message.success === true && message.verified === true ? true : false
      }, commandTimeoutMs * 3, { requestId, target })
    } finally { integratedRequest = null }
  }
  async function acceptor() {
    const before = await exchange('raw_acceptor', packet(71, 65, 63), message => {
      const p = message.packet
      return message.type === 'acceptor_raw' && validPacket(p) && p[1] === 103 && p[2] === 97 ? p[3] : undefined
    })
    if (before !== 1 && before !== 2) throw Error('acceptor_not_idle')
    checkIdle()
    await exchange('raw_acceptor', packet(82, 83, 84), message =>
      message.type === 'acceptor_ok' ? true : message.type === 'acceptor_ng' ? false : undefined)
    await pause(3500)
    let ready = false
    for (let attempt = 0; attempt < 3; attempt++) {
      checkIdle()
      const status = await exchange('raw_acceptor', packet(71, 65, 63), message => {
        const p = message.packet
        return message.type === 'acceptor_raw' && validPacket(p) && p[1] === 103 && p[2] === 97
          ? p[3] : undefined
      })
      if (status === 1 || status === 2) { ready = true; break }
      if (status === 12) throw Error('acceptor_error')
      if (attempt < 2) await pause(500)
    }
    if (!ready) throw Error('acceptor_not_ready')
    checkIdle()
    await exchange('raw_acceptor', packet(83, 67, 28), message =>
      message.type === 'acceptor_ok' ? true : message.type === 'acceptor_ng' ? false : undefined)
  }
  async function dispenser() {
    const before = await exchange('raw_dispenser', packet(83, 116, 63), dispenserReply(115, 116))
    if (before !== 98) throw Error('dispenser_not_idle')
    checkIdle()
    await exchange('raw_dispenser', packet(73, 0, 0), dispenserReply(105, 0))
    checkIdle()
    const status = await exchange('raw_dispenser', packet(83, 116, 63), dispenserReply(115, 116))
    if (status !== 98) throw Error('dispenser_not_ready')
  }
  async function ping() { await exchange('ping', null, message => message.type === 'pong' ? true : undefined) }
  async function resetOne(key) {
    if (!Object.hasOwn(hardware, key)) throw Error('device_unconfigured')
    if (!isIdle()) throw Error('busy')
    lastAttempt[key] = now()
    const previous = hardware[key]
    hardware[key] = { ...hardware[key], state: 'recovering', reason: null }
    try {
      if ((key === 'acceptor' || key === 'dispenser') && usesIntegratedCash(property, building)) await integratedRecovery(key)
      else if (key === 'acceptor') await acceptor()
      else if (key === 'dispenser') await dispenser()
      else if (key === 'cardTerminal') {
        terminal.reconnect()
        const until = now() + 10000
        while (!terminal.status.authenticated && now() < until) { checkIdle(); await pause(250) }
        if (!terminal.status.authenticated) throw Error('terminal_unavailable')
      } else if (key === 'printer') await printer()
      else if (key === 'cardDispenser') {
        const result = await cardKey.autoRecover(() => !yieldRequested)
        if (!result.success) throw Error(result.reason || 'card_recovery_failed')
      }
      update(key, 'ok', null, 'ok')
      onRecovered(key)
    } catch (error) {
      const reason = clean(error.message)
      if (reason === 'recovery_yielded') {
        hardware[key] = previous
        throw Error('recovery_yielded')
      }
      update(key, 'needs_attention', reason, reason)
      throw Error(reason)
    }
  }
  async function reset(target) {
    if (busy || !(target === 'hardwareServer' ? canRestartServer() : isIdle())) throw Error('busy')
    busy = true
    yieldRequested = false
    onBusy(true)
    try {
      if (target === 'hardwareServer') {
        await restartServer()
        await ping()
        serverFailures = 0; nextServerAttempt = 0; unresponsiveSince = 0
        return
      }
      if (target === 'all') {
        let failed = false
        for (const key of Object.keys(hardware)) {
          if (yieldRequested || !isIdle()) throw Error('recovery_yielded')
          try { await resetOne(key) } catch (error) {
            if (error.message === 'recovery_yielded') throw error
            failed = true
          }
        }
        if (failed) throw Error('device_reset_failed')
      } else await resetOne(target)
    } finally { busy = false; onBusy(false) }
  }
  async function tick() {
    if (busy || (!isIdle() && !canRestartServer())) return
    busy = true
    yieldRequested = false
    onBusy(true)
    try {
      if (bridgeDevices.length && now() - lastPing >= 15000) {
        lastPing = now()
        try { await ping(); unresponsiveSince = 0 } catch { unresponsiveSince ||= now() }
      }
      if (unresponsiveSince) for (const key of bridgeDevices) {
        if (hardware[key]) hardware[key] = { ...hardware[key], state: 'needs_attention', reason: 'bridge_unresponsive' }
      }
      if (yieldRequested) return
      if (unresponsiveSince && now() - unresponsiveSince >= 30000 && now() >= nextServerAttempt && canRestartServer()) {
        try {
          await restartServer()
          await ping()
          serverFailures = 0; nextServerAttempt = 0; unresponsiveSince = 0
        } catch {
          nextServerAttempt = now() + [60000, 120000, 300000, 600000][Math.min(serverFailures++, 3)]
        }
      }
      if (unresponsiveSince || !isIdle()) return
      for (const [key, state] of Object.entries(hardware)) {
        if (yieldRequested || !isIdle()) break
        if (state.state !== 'ok' && now() - lastAttempt[key] >= 60000) {
          try { await resetOne(key) } catch { /* Keep the failed device scoped and retry at the next idle interval. */ }
        }
      }
    } finally { busy = false; onBusy(false) }
  }
  return { hardware, reset, tick, isBusy: () => busy,
    requestYield() {
      yieldRequested = true
      wakeYield?.()
      if (integratedRequest && bridge.isConnected) bridge.send({ type: 'cash_board_yield', requestId: integratedRequest })
    },
    ready(key) { if (hardware[key]) update(key, 'ok', null, 'ok') },
    fault(key, reason = 'device_error') {
      if (hardware[key]) hardware[key] = { ...hardware[key], state: 'needs_attention', reason: clean(reason) }
    },
  }
}

async function runRemoteReset(command, store, recovery, isIdle, now = Date.now) {
  if (command.expiresAt <= now() || !isIdle() || recovery.isBusy()) throw Error('busy')
  const id = 'operation-' + createHash('sha256').update('reset-device:' + command.id).digest('hex')
  const previous = store.read(id)
  if (previous?.status === 'completed') return
  if (previous) throw Error(previous.error || 'interrupted')
  store.write(id, { status: 'started' })
  try {
    await recovery.reset(command.device)
    store.write(id, { status: 'completed' })
  } catch (error) {
    store.write(id, { status: 'failed', error: error.message })
    throw error
  }
}

module.exports = { createDeviceRecovery, runRemoteReset }
