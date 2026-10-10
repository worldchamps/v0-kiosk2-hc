// Actual route, booking store, Firebase helpers and date rules, with memory-only
// DB/Sheets/payment transports. This suite cannot access live services/devices.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const copy = value => value == null ? value : structuredClone(value);
function harness(options = {}) {
  const roomCode = options.roomCode || 'B901';
  const env = { GOOGLE_SHEETS_SPREADSHEET_ID: 'qa-sheet', KIOSK_PROPERTY_ID: 'property3', KIOSK_BUILDING: 'B',
    FIREBASE_PROJECT_ID: 'qa-fake', FIREBASE_CLIENT_EMAIL: 'qa-invalid', FIREBASE_PRIVATE_KEY: 'qa-fake', FIREBASE_DATABASE_URL: 'https://qa.invalid', ...options.env };
  let state = { beach_room_status: { rooms: { room901: { matchingRoomNumber: roomCode, roomNumber: '901',
    status: '공실', floor: 'TEST', password: 'NOT-A-REAL-CODE', category: 'Beach ' + roomCode[0], roomType: 'QA' } } } };
  let price = 30000, appendCount = 0, queueCount = 0, now = '2026-09-10T01:00:00Z';
  const rows = copy(options.rows || []), effects = [];
  const listeners = new Map();
  const get = key => key.split('/').filter(Boolean).reduce((value, name) => value?.[name], state) ?? null;
  const set = (target, key, value) => {
    const names = key.split('/').filter(Boolean); const last = names.pop();
    const parent = names.reduce((object, name) => object[name] ||= {}, target);
    if (value === null) delete parent[last]; else parent[last] = copy(value);
  };
  const snapshot = value => ({ val: () => copy(value), exists: () => value != null });
  const db = { ref(key = '') {
    return {
      on: (_event, listener) => {
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key).add(listener);
      },
      off: (_event, listener) => { listeners.get(key)?.delete(listener); },
      once: async () => snapshot(get(key)),
      child: name => db.ref([key, name].filter(Boolean).join('/')),
      transaction: async callback => {
        let current = listeners.get(key)?.size ? copy(get(key)) : null;
        let value = callback(current);
        if (value !== undefined && !listeners.get(key)?.size && get(key) !== null) {
          current = copy(get(key)); value = callback(current);
        }
        if (value === undefined) return { committed: false, snapshot: snapshot(current) };
        set(state, key, value); return { committed: true, snapshot: snapshot(value) };
      },
      set: async value => { set(state, key, value); },
      remove: async () => set(state, key, null),
      update: async values => {
        const isFinalize = key === '' && Object.keys(values).some(name => name.startsWith('pms_queue/'));
        if (isFinalize && options.finalizeFailure === 'before') throw new Error('QA atomic write rejected');
        const next = copy(state);
        for (const [name, value] of Object.entries(values)) set(next, [key, name].filter(Boolean).join('/'), value);
        state = next;
        if (isFinalize) { queueCount++; effects.push('queue'); }
        if (isFinalize && options.finalizeFailure === 'after') throw new Error('QA atomic write ACK lost');
      },
    };
  } };
  const dependencies = { crypto, 'next/server': { NextResponse: Response },
    '@/electron/card-issue-proof': { issueTicket: data => require('../electron/card-issue-proof').issueTicket(data, env, new Date(now).getTime()) },
    'firebase-admin/app': { getApps: () => [{}] }, 'firebase-admin/database': { getDatabase: () => db },
    '@/lib/google-sheets': { createSheetsClient: () => ({ spreadsheets: { values: {
      get: async request => {
        assert.equal(request.dateTimeRenderOption, 'FORMATTED_STRING');
        if (options.preflightReadFailure || options.readFailure && appendCount) throw new Error('QA readback unavailable');
        const values = copy(rows);
        if (options.formattedCurrency && request.valueRenderOption !== 'UNFORMATTED_VALUE') {
          for (const row of values) if (typeof row[5] === 'number') row[5] = row[5].toLocaleString('en-US');
        }
        return { data: { values } };
      },
      append: async request => {
        appendCount++; effects.push('append');
        assert.equal(request.valueInputOption, 'RAW');
        assert.equal(request.insertDataOption, 'INSERT_ROWS');
        if (options.beforeAppend) await options.beforeAppend();
        if (options.appendFailure !== 'before') {
          const row = copy(request.requestBody.values[0]);
          // Reproduce a detached N-column table selected by the old A:N append.
          const shifted = options.shiftedWrite || (options.detachedFloor && request.range === 'Reservations!A:N');
          rows.push(shifted ? [...Array(13).fill(''), ...row] : row);
        }
        if (options.afterAppend) await options.afterAppend();
        if (options.appendFailure) throw new Error('QA sheet outcome unknown');
      },
    } } }) },
    '@/lib/pms-rates': { getPmsRateAmount: async () => price },
    '@/lib/kiosk-sales-config': { getKioskSalesConfig: async () => null, findKioskRoomSalesConfig: () => null },
    '@/lib/short-stay-policy': { isShortStayRestrictedProperty: () => false },
    '@/lib/toss-pay': { verifyCompletedCardPayment: async () => { if (options.badProof) throw new Error('QA invalid proof'); } },
    '@/lib/toss-front': { verifyTossFrontPaymentProof: () => { if (options.badProof) throw new Error('QA invalid proof'); } },
  };
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return new FixedDate().getTime(); } }
  const load = file => {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    vm.runInNewContext(code, { exports, process: { env }, Date: FixedDate, URL, Intl,
      console: { log() {}, warn() {}, error() {} }, require(name) {
        assert.ok(name in dependencies, 'Unexpected dependency: ' + name); return dependencies[name];
      } });
    return exports;
  };
  for (const name of ['property-utils', 'kiosk-scope', 'date-utils', 'firebase-admin', 'firebase-transaction', 'on-site-bookings', 'firebase-beach-rooms']) {
    dependencies['@/lib/' + name] = load('lib/' + name + '.ts');
  }
  const post = load('app/api/on-site-booking/route.ts').POST;
  const preflight = load('app/api/on-site-preflight/route.ts').GET;
  const base = { requestId: 'qa-cash-request-00000001', roomCode, roomNumber: roomCode, roomType: 'QA',
    guestName: 'QA GUEST', phoneNumber: '00000000000', checkInDate: '2026-09-10', checkOutDate: '2026-09-11',
    stayType: 'overnight', price: 30000, payment: { method: 'CASH' } };
  return { rows, effects, get, set: (key, value) => set(state, key, value), modules: dependencies,
    preflight: async (room = roomCode, stayType = 'overnight') => {
      const response = await preflight(new Request(`http://qa.invalid/api/on-site-preflight?roomCode=${room}&stayType=${stayType}`));
      return { status: response.status, body: await response.json() };
    },
    counts: () => ({ append: appendCount, queue: queueCount }), price: value => { price = value; }, now: value => { now = value; },
    post: async (body = {}) => {
      const response = await post(new Request('http://qa.invalid/api/on-site-booking', { method: 'POST', body: JSON.stringify({ ...base, ...body }) }));
      return { status: response.status, body: await response.json() };
    },
  };
}
const card = id => ({ method: 'CARD', provider: 'TOSS_PAY', payToken: id, orderNo: 'QA-' + id });

test('pre-payment check rejects overlap, cleaning buffer, wrong building and unreadable schedules without any write', async () => {
  for (const start of ['2026-09-10/16:00', '2026-09-11/12:00']) {
    const row = Array(14).fill(''); row[7] = start; row[8] = '2026-09-12/11:00'; row[9] = 'B901';
    const h = harness({ rows: [row] });
    assert.equal((await h.preflight()).status, 409);
    assert.deepEqual(h.effects, []);
  }
  const h = harness();
  assert.equal((await h.preflight('A901')).status, 403);
  assert.equal((await h.preflight('B901', 'invalid')).status, 400);
  assert.deepEqual((await h.preflight()).body, { ready: true, rates: { cash: 30000, card: 30000 } });
  assert.deepEqual(h.effects, []);
  const failed = harness({ preflightReadFailure: true });
  assert.equal((await failed.preflight()).status, 503);
  assert.deepEqual(failed.effects, []);
});

for (const [property, building, roomCode] of [['property1', '', 'C901'], ['property1', '', 'D901'], ['property3', 'A', 'A901']]) {
  test(`committed ${roomCode} on-site sale authorizes one room card and recovery keeps the same operation`, async () => {
    const proof = require('../electron/card-issue-proof');
    const env = { KIOSK_PROPERTY_ID: property, KIOSK_BUILDING: building, CARD_DISPENSER_ENABLED: 'true', CARD_BRIDGE_TOKEN: 'a'.repeat(64) };
    const h = harness({ env, roomCode });
    const first = await h.post(); assert.equal(first.body.success, true);
    const claim = proof.verifyTicket(first.body.cardIssue.ticket, env, Date.parse('2026-09-10T01:00:00Z'));
    assert.equal(claim.room, roomCode); assert.equal(claim.reservationId, first.body.data.reservationId);
    h.now('2026-09-10T01:01:00Z'); const again = await h.post();
    assert.equal(proof.verifyTicket(again.body.cardIssue.ticket, env, Date.parse('2026-09-10T01:01:00Z')).operationId, claim.operationId);
    assert.deepEqual(h.counts(), { append: 1, queue: 1 });
    const failed = harness({ env, roomCode, appendFailure: 'before' });
    const response = await failed.post(); assert.equal(response.body.cardIssue, undefined); assert.equal(response.body.success, false);
  });
}
test('normal sale atomically reflects room/queue and replays without writing again', async () => {
  const h = harness(); const first = await h.post();
  assert.equal(first.status, 200); assert.equal(first.body.success, true);
  assert.match(first.body.data.reservationId, /^ONSITE-[a-f0-9-]{36}$/);
  assert.equal(first.body.data.password, 'NOT-A-REAL-CODE');
  assert.equal(h.get('beach_room_status/rooms/room901/status'), '사용 중');
  assert.ok(Object.keys(h.get('pms_queue/property3'))[0].startsWith('-'));
  h.set('pms_queue/property3', null); h.price(90000);
  assert.deepEqual((await h.post()).body, first.body);
  assert.deepEqual(h.counts(), { append: 1, queue: 1 });
});
test('on-site write stays in A:N when the preceding floor column is detached', async () => {
  const previous = ['QA', 'Previous guest', 'existing', 'OTA', 'QA', 50000, '', '26.11.07/15:00', '26.11.08/11:00', 'D901', '', '', '', '3'];
  const h = harness({ rows: [previous], detachedFloor: true });
  const result = await h.post();
  assert.equal(result.status, 200);
  assert.deepEqual(h.rows[0], previous);
  assert.equal(h.rows[1][2], result.body.data.reservationId);
  assert.equal(h.rows[1][9], 'B901');
  assert.equal(h.rows[1].length, 14);
});

for (const failure of ['shifted', 'missing', 'changed', 'duplicate', 'unreadable']) {
  test('acknowledged ' + failure + ' sheet row stays pending without room commands or another append', async () => {
    const h = harness({ shiftedWrite: failure === 'shifted', readFailure: failure === 'unreadable', afterAppend: () => {
      if (failure === 'missing') h.rows.pop();
      if (failure === 'changed') h.rows[0][5] = 1;
      if (failure === 'duplicate') h.rows.push(copy(h.rows[0]));
    } });
    const payment = card('qa-payment-readback-' + failure);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await h.post({ payment });
      assert.equal(result.status, 202);
      assert.equal(result.body.canCancelPayment, false);
      assert.equal(result.body.data, undefined);
      assert.equal(result.body.cardIssue, undefined);
    }
    assert.equal(h.get('beach_room_status/rooms/room901/status'), '공실');
    assert.equal(h.get('kiosk_room_claims/property3/B901/state'), 'pending');
    assert.equal(Object.values(h.get('kiosk_bookings'))[0].state, 'saving');
    assert.equal(Object.values(h.get('payment_claims/toss_pay'))[0].status, 'claimed');
    assert.deepEqual(h.counts(), { append: 1, queue: 0 });
  });
}

test('room lock wins even while first append is delayed; second payment is not consumed', async () => {
  let resume, entered; const atAppend = new Promise(resolve => { entered = resolve; });
  const hold = new Promise(resolve => { resume = resolve; });
  const h = harness({ beforeAppend: async () => { entered(); await hold; } });
  const first = h.post({ payment: card('qa-payment-first') }); await atAppend;
  const second = await h.post({ payment: card('qa-payment-second') });
  assert.equal(second.status, 409); assert.equal(second.body.canCancelPayment, true);
  resume(); assert.equal((await first).status, 200);
  assert.equal(h.rows.length, 1); assert.deepEqual(h.counts(), { append: 1, queue: 1 });
});
test('concurrent same request is pending, then recovers the original result', async () => {
  let resume, entered; const atAppend = new Promise(resolve => { entered = resolve; });
  const hold = new Promise(resolve => { resume = resolve; });
  const h = harness({ beforeAppend: async () => { entered(); await hold; } });
  const first = h.post(); await atAppend;
  const retry = await h.post(); assert.equal(retry.status, 202); assert.equal(retry.body.canCancelPayment, false);
  resume(); const success = await first;
  assert.deepEqual((await h.post()).body, success.body); assert.equal(h.rows.length, 1);
});
test('lost Sheets acknowledgement reconciles the exact row without a second append', async () => {
  const h = harness({ appendFailure: 'after' }); const first = await h.post();
  assert.equal(first.status, 202); assert.equal(first.body.canCancelPayment, false);
  assert.equal((await h.post()).status, 200); assert.deepEqual(h.counts(), { append: 1, queue: 1 });
});
test('formatted currency columns do not prevent exact-row recovery after a lost append response', async () => {
  const h = harness({ appendFailure: 'after', formattedCurrency: true });
  assert.equal((await h.post()).status, 202);
  assert.equal((await h.post()).status, 200);
  assert.deepEqual(h.counts(), { append: 1, queue: 1 });
});
test('late append acknowledgement cannot rewind a recovered complete booking or replay its consumed queue', async () => {
  let resume, entered; const atAppend = new Promise(resolve => { entered = resolve; });
  const hold = new Promise(resolve => { resume = resolve; });
  const h = harness({ afterAppend: async () => { entered(); await hold; } });
  const first = h.post(); await atAppend;
  const recovered = await h.post(); assert.equal(recovered.status, 200);
  h.set('pms_queue/property3', null);
  resume();
  assert.deepEqual((await first).body, recovered.body);
  assert.equal(h.get('pms_queue/property3'), null);
  assert.deepEqual(h.counts(), { append: 1, queue: 1 });
});
test('unknown Sheets failure with no visible row keeps funds and room claim; never appends again', async () => {
  const h = harness({ appendFailure: 'before' });
  assert.equal((await h.post()).status, 202); assert.equal((await h.post()).status, 202);
  assert.equal((await h.post({ requestId: 'qa-cash-another-00002' })).status, 409);
  assert.deepEqual(h.counts(), { append: 1, queue: 0 });
});
for (const failure of ['before', 'after']) test('atomic Firebase ' + failure + ' failure is pending, never partial success/duplicate queue', async () => {
  const h = harness({ finalizeFailure: failure }); assert.equal((await h.post()).status, 202);
  const retry = await h.post(); assert.equal(retry.status, failure === 'after' ? 200 : 202);
  assert.deepEqual(h.counts(), { append: 1, queue: failure === 'after' ? 1 : 0 });
  assert.equal(h.get('beach_room_status/rooms/room901/status'), failure === 'after' ? '사용 중' : '공실');
});
test('room claim survives stale PMS room replacement and hides a paid room', async () => {
  const h = harness(); await h.post(); h.set('beach_room_status/rooms/room901/status', '공실');
  assert.equal((await h.modules['@/lib/firebase-beach-rooms'].getAvailableRooms('B')).length, 0);
  assert.equal((await h.post({ requestId: 'qa-cash-another-00002' })).status, 409);
});
test('same request cannot be changed to another price or guest', async () => {
  const h = harness(); await h.post();
  for (const body of [{ price: 1 }, { guestName: 'Another guest' }]) {
    const result = await h.post(body); assert.equal(result.status, 409); assert.equal(result.body.canCancelPayment, false);
  }
  assert.equal(h.rows.length, 1);
});
test('expired completed booking cannot reveal room credentials or replay room commands', async () => {
  const h = harness(); assert.equal((await h.post()).status, 200);
  h.set('pms_queue/property3', null);
  h.now('2026-09-11T02:00:00Z'); // exact 11:00 KST checkout
  const result = await h.post();
  assert.equal(result.status, 409); assert.equal(result.body.canCancelPayment, false);
  assert.equal(result.body.data, undefined); assert.equal(h.get('pms_queue/property3'), null);
  assert.deepEqual(h.counts(), { append: 1, queue: 1 });
});
test('canceled card cannot replay a cached successful booking', async () => {
  const h = harness(); const payment = card('qa-payment-original'); await h.post({ payment });
  const key = crypto.createHash('sha256').update(payment.payToken).digest('hex');
  h.set('payment_claims/toss_pay/' + key + '/status', 'canceled');
  const result = await h.post({ payment }); assert.equal(result.status, 409); assert.equal(result.body.canCancelPayment, false);
});
test('legacy consumed payment cannot be canceled by a fresh request', async () => {
  const h = harness(); const payment = card('qa-payment-legacy');
  const key = crypto.createHash('sha256').update(payment.payToken).digest('hex');
  h.set('payment_claims/toss_pay/' + key, { status: 'claimed', reservationId: 'ONSITE-123' });
  const result = await h.post({ payment }); assert.equal(result.status, 409); assert.equal(result.body.canCancelPayment, false);
  assert.equal(h.rows.length, 0);
});
test('cancellation while the sheet write is in flight cannot finalize or send a room command', async () => {
  const payment = card('qa-payment-racing-cancel');
  const key = crypto.createHash('sha256').update(payment.payToken).digest('hex');
  const h = harness({ beforeAppend: async () => h.set('payment_claims/toss_pay/' + key + '/status', 'canceled') });
  const result = await h.post({ payment }); assert.equal(result.status, 202); assert.equal(result.body.canCancelPayment, false);
  assert.deepEqual(h.counts(), { append: 1, queue: 0 });
  assert.equal((await h.post({ payment })).status, 409);
});
test('malformed, foreign and underpaid requests cannot write a booking', async () => {
  const h = harness();
  for (const input of [{ roomCode: 'A901' }, { roomCode: 'Camp101' }, { guestName: ' ' },
    { payment: { method: 'FREE' } }, { requestId: '' }, { price: 1 }]) assert.ok((await h.post(input)).status >= 400);
  assert.deepEqual(h.counts(), { append: 0, queue: 0 });
});
test('invalid card proof cannot write or claim a room', async () => {
  const h = harness({ badProof: true }); assert.equal((await h.post({ payment: card('qa-payment-invalid') })).status, 402);
  assert.equal(h.get('kiosk_room_claims'), null); assert.equal(h.rows.length, 0);
});
test('existing reservation overlap and two-hour cleaning buffer block a sale', async () => {
  const row = ['', 'QA', 'existing', '', '', 30000, '', '26.09.10/15:00', '26.09.11/11:00', 'B901', '', ''];
  const h = harness({ rows: [row] }); assert.equal((await h.post()).status, 409); assert.equal(h.rows.length, 1);
  assert.equal(h.get('kiosk_room_claims/property3/B901/state'), 'released');
  const conflicts = h.modules['@/lib/on-site-bookings'].roomScheduleConflicts;
  assert.equal(conflicts([row], 'B901', '26.09.11/12:59', '26.09.11/16:00'), true);
  assert.equal(conflicts([row], 'B901', '26.09.11/13:00', '26.09.11/16:00'), false);
  row[11] = 'Canceled'; assert.equal(conflicts([row], 'B901', '26.09.10/15:00', '26.09.11/11:00'), false);
});
test('client date/password cannot override server KST dates or room credentials', async () => {
  const h = harness(); const result = await h.post({ checkInDate: '1999-01-01', password: 'FORGED' });
  assert.equal(result.status, 200); assert.equal(result.body.data.checkInDate, '26.09.10/10:00');
  assert.equal(result.body.data.checkOutDate, '26.09.11/11:00'); assert.equal(h.rows[0][10], 'NOT-A-REAL-CODE');
});
