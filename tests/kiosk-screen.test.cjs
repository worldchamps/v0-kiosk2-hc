const test = require('node:test')
const assert = require('node:assert/strict')
const { createKioskScreenReporter, screenSignature, verifyScreen, MAX_IMAGE_LENGTH } = require('../electron/kiosk-screen')
const identity = { deviceId: 'property2-test-01', property: 'property2', building: '', version: 'test' }
const key = 'test-only-key'

test('screen report is signed, device scoped, bounded and expires', () => {
  const body = { ...identity, at: 100000, image: '/9j/AAAA' }
  const sign = input => screenSignature(input, key)
  const verify = (input, sig = sign(input), now = 100000) => verifyScreen(input, sig, key, identity, now)
  assert(verify(body))
  assert(!verify({ ...body, property: 'property1' }))
  assert(!verify({ ...body, deviceId: 'other-device' }))
  assert(!verify({ ...body, building: 'B' }))
  assert(!verify(body, sign(body), 160001))
  assert(!verify(body, sign({ ...body, at: 99999 })))
  assert(!verify({ ...body, image: '<svg></svg>' }))
  assert(!verify({ ...body, image: '/9j/' + 'A'.repeat(MAX_IMAGE_LENGTH) }))
})

test('screen reporter captures only during the lease and stops after expiry or network failure', async () => {
  let time = 100000, lease = 0, captures = 0, fail = false
  const bodies = []
  const reporter = createKioskScreenReporter({ identity, key, now: () => time,
    capture: async () => { captures++; return '/9j/AAAA' },
    fetcher: async (url, options) => {
      assert.equal(url, 'http://localhost:3000/api/kiosk-screen-agent')
      const body = JSON.parse(options.body); bodies.push(body)
      assert(verifyScreen(body, options.headers['x-kiosk-screen-signature'], key, identity, time))
      if (fail) throw Error('offline')
      return { ok: true, json: async () => ({ captureUntil: lease }) }
    },
  })
  await reporter.tick(); assert.equal(captures, 0)
  time += 15000; lease = time + 15000
  await reporter.tick(); assert.equal(captures, 0, 'first heartbeat obtains permission without a screenshot')
  time += 5000; await reporter.tick(); assert.equal(captures, 1)
  time += 10000; await reporter.tick(); assert.equal(captures, 1, 'expired request never captures')
  time += 15000; lease = time + 300000; await reporter.tick()
  time += 5000; fail = true; await reporter.tick(); assert.equal(captures, 2)
  time += 15000; await reporter.tick(); assert.equal(captures, 2, 'failure clears permission before the next heartbeat')
})

test('screen capture failure reports a diagnostic and overlapping ticks do not capture twice', async () => {
  let time = 100000, release, calls = 0
  const bodies = []
  const reporter = createKioskScreenReporter({ identity, key, now: () => time,
    capture: async () => { throw Error('display missing') },
    fetcher: async (_url, options) => {
      calls++; bodies.push(JSON.parse(options.body))
      if (calls === 2) await new Promise(resolve => { release = resolve })
      return { ok: true, json: async () => ({ captureUntil: 400000 }) }
    },
  })
  await reporter.tick(); time += 5000
  const pending = reporter.tick(); await new Promise(resolve => setImmediate(resolve))
  await reporter.tick(); assert.equal(calls, 2)
  release(); await pending
  assert.equal(bodies[1].captureError, true); assert.equal(bodies[1].image, undefined)
})

test('capture and upload time does not skip the next five-second tick', async () => {
  let time = 100000, captures = 0
  const reporter = createKioskScreenReporter({ identity, key, now: () => time,
    capture: async () => { captures++; time += 100; return '/9j/AAAA' },
    fetcher: async () => { time += 100; return { ok: true, json: async () => ({ captureUntil: 400000 }) } },
  })
  await reporter.tick()
  time = 105000; await reporter.tick(); assert.equal(captures, 1)
  time = 110000; await reporter.tick(); assert.equal(captures, 2)
})

test('local screen API rejects unsigned reports and only stores frames for active requests', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
  let lease = null, reads = 0
  const updates = [], exports = {}
  const dependencies = { 'next/server': { NextResponse: Response },
    '@/electron/kiosk-screen': require('../electron/kiosk-screen'),
    '@/lib/kiosk-scope': { getKioskScope: () => ({ property: identity.property, building: null }) },
    '@/lib/firebase-admin': { getDB: () => ({ ref: () => ({ once: async () => { reads++; return { val: () => lease } }, update: async value => updates.push(value) }) }) },
  }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../app/api/kiosk-screen-agent/route.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: name => { assert(name in dependencies, name); return dependencies[name] },
      process: { env: { FIREBASE_PRIVATE_KEY: key, KIOSK_DEVICE_ID: identity.deviceId } }, Date })
  const call = (body, signature) => exports.POST(new Request('http://localhost:3000/api/kiosk-screen-agent', {
    method: 'POST', body: JSON.stringify(body), headers: { 'x-kiosk-screen-signature': signature || '' },
  }))
  const body = { ...identity, at: Date.now(), image: '/9j/AAAA' }
  assert.equal((await call(body)).status, 403); assert.equal(reads, 0); assert.equal(updates.length, 0)
  const signature = screenSignature(body, key)
  assert.equal((await call(body, signature)).status, 200)
  assert.equal(updates.at(-1)[`kiosk_screens/frames/${identity.deviceId}`], null)
  lease = { expiresAt: Date.now() + 300000 }
  const result = await call(body, signature)
  assert.equal((await result.json()).captureUntil, lease.expiresAt)
  assert.equal(updates.at(-1)[`kiosk_screens/frames/${identity.deviceId}`].image, '/9j/AAAA')
  assert.equal(updates.at(-1)[`kiosk_screens/devices/${identity.deviceId}`].property, 'property2')
  lease = { expiresAt: Date.now() - 1 }
  await call(body, signature)
  assert.equal(updates.at(-1)[`kiosk_screens/frames/${identity.deviceId}`], null)
})

test('native screen capture selects Kariv primary display without a fullscreen kiosk window', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8')
  const start = source.indexOf('    capture: async () => {', source.indexOf('const screenReporter'))
  const end = source.indexOf('\n    },', start)
  assert(start > 0 && end > start)
  const body = source.slice(start + '    capture: async () => {'.length, end)
  const capture = (overlay, mainWindow, empty = false) => vm.runInNewContext(`(async () => {${body}})()`, {
    OVERLAY_MODE: overlay, mainWindow,
    screen: { getPrimaryDisplay: () => ({ id: 7 }), getDisplayMatching: bounds => ({ id: bounds.id }) },
    desktopCapturer: { getSources: async () => [7, 8].map(id => ({ display_id: String(id),
      thumbnail: { isEmpty: () => empty, toJPEG: () => Buffer.from(String(id)) } })) },
  })
  assert.equal(await capture(true, undefined), Buffer.from('7').toString('base64'))
  assert.equal(await capture(false, { isDestroyed: () => false, getBounds: () => ({ id: 8 }) }), Buffer.from('8').toString('base64'))
  await assert.rejects(capture(false, undefined), /window unavailable/)
  await assert.rejects(capture(true, undefined, true), /screen unavailable/)
})
