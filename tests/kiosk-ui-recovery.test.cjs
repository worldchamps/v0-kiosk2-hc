// Actual TSX callbacks with fake hooks/storage/devices. No production APIs or hardware.
// Browser journeys are tested separately; this harness is not a React lifecycle simulator.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const text = n => n == null || typeof n === 'boolean' ? '' : Array.isArray(n) ? n.map(text).join(' ') : typeof n !== 'object' ? String(n) : text(n.props?.children);
const nodes = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(nodes) : [n, ...nodes(n.props?.children)];
function load(file, extra = {}, globals = {}) {
  const values = [], effects = [], renderEffects = [], callbacks = []; let index = 0, first = true;
  const element = (type, props) => ({ type, props });
  const react = {
    useState(initial) { const i = index++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial;
      return [values[i], v => values[i] = typeof v === 'function' ? v(values[i]) : v]; },
    useRef(initial) { const i = index++; if (!(i in values)) values[i] = { current: initial }; return values[i]; },
    useEffect(fn) { renderEffects.push(fn); if (first) effects.push(fn); }, useCallback: fn => { callbacks.push(fn); return fn; },
    createContext: () => ({ Provider: 'Provider' }), useContext: () => undefined,
  };
  const deps = { react, 'react/jsx-runtime': { jsx: element, jsxs: element }, 'lucide-react': {},
    '@/components/payment-recovery-panel': { default: 'PaymentRecoveryPanel' }, ...extra };
  for (const name of ['button', 'card', 'input', 'label', 'alert']) deps['@/components/ui/' + name] ||= {
    Button: 'button', Card: 'div', CardContent: 'div', CardHeader: 'div', CardTitle: 'h2', Input: 'input', Label: 'label', Alert: 'div', AlertDescription: 'p',
  };
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(compiled, { exports, require(name) { assert(name in deps, `Unexpected dependency ${name}`); return deps[name]; },
    console: { log() {}, warn() {}, error() {} }, Date, URL, URLSearchParams, AbortSignal, ...globals });
  let tree;
  return { exports, effects, renderEffects, callbacks,
    render(props = {}, name = 'default') { index = 0; callbacks.length = 0; renderEffects.length = 0; tree = exports[name](props); first = false; return tree; },
    button(label) { const matches = nodes(tree).filter(n => n.type === 'button' && (n.props['aria-label'] || text(n).trim()) === label); assert.equal(matches.length, 1, `Button ${label}; actual ${text(tree)}`); return matches[0].props; },
    component(type) { return nodes(tree).find(n => n.type === type); },
    visible(value) { return text(tree).includes(value); },
  };
}
function storage(seed) {
  const map = new Map(Object.entries(seed || {})); let broken = false;
  return { map, break() { broken = true; }, getItem: k => map.get(k) || null,
    setItem(k, v) { if (broken) throw new Error('disk full'); map.set(k, v); }, removeItem(k) { if (broken) throw new Error('disk full'); map.delete(k); } };
}
async function paymentContext(saved, electronAPI) {
  const localStorage = storage(saved ? { 'kiosk-payment-recovery-v1': saved } : {});
  const h = load('contexts/payment-context.tsx', {}, { window: { localStorage, electronAPI } });
  const render = () => h.render({ children: null }, 'PaymentProvider').props.value;
  render(); for (const effect of h.effects) await effect();
  return { localStorage, render, get value() { return render(); } };
}
test('payment session persists cash and refuses navigation cancellation or another sale before full refund', async () => {
  const h = await paymentContext(); assert(h.value.startPayment(30000, {}, 'cash'));
  h.value.addBill(10000); assert.equal(await h.value.cancelPayment(), false);
  assert.equal(h.value.startPayment(30000), false); assert.equal(h.value.paymentSession.acceptedAmount, 10000);
  h.value.recordCashReturned(10000); assert.equal(await h.value.cancelPayment(), true);
  assert.equal(h.localStorage.map.size, 0);
});
test('restart preserves cash and pending body, requires recovery, and malformed storage blocks payment', async () => {
  const h = await paymentContext(); h.value.startPayment(30000, {}, 'card'); h.value.setCardInFlight(true);
  const requestId = randomUUID(), booking = { requestId, body: JSON.stringify({ requestId, payment: { method: 'CARD' } }) };
  h.value.savePendingBooking(booking);
  const restored = await paymentContext(h.localStorage.map.get('kiosk-payment-recovery-v1'));
  assert.equal(restored.value.paymentSession.pendingBooking.body, booking.body); assert(restored.value.paymentSession.recoveryRequired);
  assert.equal(restored.value.startPayment(30000), false);
  const malformed = await paymentContext('{bad'); assert(malformed.value.storageError); assert.equal(malformed.value.startPayment(30000), false);
});
test('storage failure when clearing a session preserves its cash evidence and prevents completion', async () => {
  const h = await paymentContext(); h.value.startPayment(30000, {}, 'cash'); h.value.addBill(10000); h.localStorage.break();
  assert.equal(h.value.completePayment(), false); assert.equal(h.value.paymentSession.acceptedAmount, 10000); assert(h.value.storageError);
});

test('admin recovery archives the exact raw snapshot before clearing only its journal', async () => {
  const raw = JSON.stringify({ isActive: true, method: 'cash', acceptedAmount: 0, acceptedBills: [], requiredAmount: 30000,
    sessionStartTime: 123, recoveryRequired: 'Synthetic stop failure' });
  let seen;
  const h = await paymentContext(raw, { paymentRecovery: { archive: async input => {
    seen = input; assert.equal(h.localStorage.getItem('kiosk-payment-recovery-v1'), raw);
    return { success: true, archiveId: 'synthetic-archive' };
  } } });
  h.localStorage.setItem('unrelated-setting', 'keep');
  assert.equal((await h.value.resolveRecovery('operator-test', 'zero_cash', '현금 미투입 취소')).success, true);
  assert.equal(seen.expectedRaw, raw); assert.equal(h.value.paymentSession.isActive, false);
  assert.equal(h.localStorage.getItem('kiosk-payment-recovery-v1'), null);
  assert.equal(h.localStorage.getItem('unrelated-setting'), 'keep');
});

for (const scenario of ['archive-failure', 'lost-response', 'changed-record', 'remove-failure']) {
  test(`admin recovery ${scenario} never clears unresolved evidence`, async () => {
    const raw = JSON.stringify({ isActive: true, acceptedAmount: 10000, acceptedBills: [10000], requiredAmount: 30000 });
    const h = await paymentContext(raw, { paymentRecovery: { archive: async () => {
      if (scenario === 'archive-failure') return { success: false, error: 'Storage failed' };
      if (scenario === 'lost-response') throw Error('IPC lost');
      if (scenario === 'changed-record') h.localStorage.setItem('kiosk-payment-recovery-v1', raw + ' ');
      if (scenario === 'remove-failure') h.localStorage.break();
      return { success: true, archiveId: 'synthetic-archive' };
    } } });
    assert.equal((await h.value.resolveRecovery('operator-test', 'operator_resolved', '관리자 정산 완료')).success, false);
    assert.equal(h.localStorage.getItem('kiosk-payment-recovery-v1'), scenario === 'changed-record' ? raw + ' ' : raw);
    assert.equal(h.value.paymentSession.acceptedAmount, 10000);
  });
}

test('admin recovery duplicate clicks share one archive and corrupted evidence remains verbatim until success', async () => {
  let release, calls = 0;
  const raw = '{malformed-evidence';
  const h = await paymentContext(raw, { paymentRecovery: { archive: () => { calls++; return new Promise(resolve => { release = resolve; }); } } });
  const first = h.value.resolveRecovery('operator-test', 'operator_resolved', '관리자 정산 완료');
  assert.equal((await h.value.resolveRecovery('operator-test', 'operator_resolved', '관리자 정산 완료')).success, false);
  assert.equal(calls, 1); assert.equal(h.localStorage.getItem('kiosk-payment-recovery-v1'), raw);
  release({ success: true, archiveId: 'synthetic-archive' });
  assert.equal((await first).success, true); assert.equal(h.value.storageError, '');
  assert.equal(h.value.paymentSession.isActive, false);
});
test('mismatched approval evidence survives restart and cannot be cleared by navigation cancellation', async () => {
  const h = await paymentContext(); h.value.startPayment(30000, {}, 'card'); h.value.setCardInFlight(true);
  const evidence = { expectedAmount: 30000, payment: { method: 'CARD', provider: 'TOSS_FRONT', front: { amount: 40000, paymentKey: 'test', signature: 'signed-test' } } };
  h.value.requireRecovery('Approval amount mismatch', evidence);
  const restored = await paymentContext(h.localStorage.map.get('kiosk-payment-recovery-v1'));
  assert.equal(JSON.stringify(restored.value.paymentSession.recoveryEvidence), JSON.stringify(evidence));
  assert.equal(await restored.value.cancelPayment(), false); assert.equal(restored.value.startPayment(30000), false);
});
function cashScreen(amount, dispenseResult, acceptor = {}) {
  const calls = { dispense: [], cancelled: 0, complete: 0, recovery: '', returned: 0, polling: 0 };
  const paymentSession = { isActive: true, acceptedAmount: amount, acceptedBills: amount ? [amount] : [], requiredAmount: 30000, overpaymentAmount: Math.max(0, amount - 30000) };
  const payment = { paymentSession, startPayment: () => true, addBill() {}, isPaymentComplete: () => amount >= 30000,
    cancelPayment: async () => { calls.cancelled++; return true; }, requireRecovery: message => calls.recovery = message,
    recordCashReturned: value => { calls.returned += value; paymentSession.acceptedAmount -= value; } };
  const h = load('components/payment-screen.tsx', {
    '@/contexts/payment-context': { usePayment: () => payment }, '@/components/toss-front-card-payment': { default: 'Front' },
    '@/lib/bill-acceptor-utils': { initializeDevice: async () => true, setEventCallback() {}, setConfig: async () => true, isBillAcceptorConnected: () => true,
      connectBillAcceptor: async () => true, enableAcceptance: async () => true, getBillData: async () => 0x32, getStatus: async () => 0x0b, ...acceptor },
    '@/lib/bill-dispenser-utils': { dispenseBills: async n => { calls.dispense.push(n); return dispenseResult; }, connectBillDispenser: async () => true, isBillDispenserConnected: () => true },
    '@/lib/printer-utils': { printReceipt() {} },
  }, { window: {}, setTimeout: fn => { fn(); return 1; }, clearInterval() {}, setInterval() { calls.polling++; return 1; } });
  const props = { cardAmount: 30000, cashAmount: 30000, onCancel: () => calls.cancelled++, onPaymentComplete: () => calls.complete++ };
  const render = () => h.render(props);
  render(); h.button('현금 결제 30,000원').onClick(); render();
  return { ...h, calls, paymentSession, render };
}
for (const [amount, result] of [[10000, false], [15000, true], [5000, true]]) {
  test(`cash cancellation ${amount}/${result} preserves unresolved funds`, async () => {
    const h = cashScreen(amount, result); await h.button('취소').onClick();
    assert(h.calls.recovery); assert.equal(h.calls.cancelled, 0); assert.equal(h.calls.returned, 0);
    if (amount % 10000) assert.deepEqual(h.calls.dispense, []);
  });
}
test('exact cash refund is verified before cancellation and records the returned amount', async () => {
  const h = cashScreen(10000, true); await h.button('취소').onClick();
  assert.deepEqual(h.calls.dispense, [1]); assert.equal(h.calls.returned, 10000); assert.equal(h.calls.cancelled, 2);
});
test('zero cash before any acceptor enable attempt can cancel without a hardware refund', async () => {
  const h = cashScreen(0, false); await h.button('취소').onClick();
  assert.deepEqual(h.calls.dispense, []); assert.equal(h.calls.cancelled, 2); assert.equal(h.calls.recovery, '');
});

for (const action of ['취소', '결제수단 변경']) {
  test(`zero-cash ${action} waits for the in-flight enable acknowledgement before stopping`, async () => {
    let releaseEnable, enabling = false, stops = 0;
    const h = cashScreen(0, false, {
      enableAcceptance: () => { enabling = true; return new Promise(resolve => { releaseEnable = () => { enabling = false; resolve(true); }; }); },
      // The real acceptor has one outstanding OK response slot. A stop sent
      // while enable is pending is rejected locally, not a physical refund failure.
      initializeDevice: async () => { stops++; return !enabling; },
      setConfig: async () => { stops++; return !enabling; },
    });
    h.renderEffects.at(-1)(); // Start the actual cash initialization effect.
    assert.equal(enabling, true);
    const cancelling = h.button(action).onClick();
    await Promise.resolve();
    assert.equal(stops, 0, 'must drain enable before sending another OK-returning command');
    releaseEnable(); await cancelling;
    assert.equal(h.calls.recovery, ''); assert.deepEqual(h.calls.dispense, []);
    assert.equal(h.calls.polling, 0, 'late enable must not restart cash polling during cancellation');
    if (action === '취소') assert.equal(h.calls.cancelled, 2);
    else { h.render(); assert(h.visible('결제 방법') || h.visible('현금 결제')); }
  });
}

test('cancel during acceptor connection never enables cash acceptance after navigation', async () => {
  let releaseConnection, enables = 0;
  const h = cashScreen(0, false, {
    isBillAcceptorConnected: () => false,
    connectBillAcceptor: () => new Promise(resolve => { releaseConnection = resolve; }),
    enableAcceptance: async () => { enables++; return true; },
  });
  h.renderEffects.at(-1)();
  const cancelling = h.button('취소').onClick();
  await Promise.resolve();
  assert.equal(h.calls.cancelled, 0, 'navigation must wait for initialization to settle');
  releaseConnection(true); await cancelling;
  assert.equal(enables, 0); assert.equal(h.calls.polling, 0);
  assert.equal(h.calls.cancelled, 2); assert.equal(h.calls.recovery, '');
});

test('confirmed zero-cash cancellation does not send a duplicate stop on unmount', async () => {
  let stops = 0;
  const h = cashScreen(0, false, { setConfig: async () => { stops++; return true; } });
  const cleanup = h.renderEffects.at(-1)();
  await Promise.resolve();
  await h.button('취소').onClick();
  const confirmedStops = stops;
  cleanup(); await Promise.resolve();
  assert.equal(stops, confirmedStops);
  assert.equal(h.calls.cancelled, 2); assert.equal(h.calls.recovery, '');
});

test('zero-cash cancellation still blocks when acceptor shutdown is not confirmed', async () => {
  const h = cashScreen(0, false, { initializeDevice: async () => false });
  h.renderEffects.at(-1)(); await Promise.resolve();
  await h.button('취소').onClick();
  assert(h.calls.recovery); assert.equal(h.calls.cancelled, 0);
  assert.deepEqual(h.calls.dispense, []);
});
for (const [amount, result] of [[35000, true], [50000, false]]) {
  test(`cash completion ${amount}/${result} cannot complete with unreturned change`, async () => {
    const h = cashScreen(amount, result); await h.callbacks[0](amount);
    assert(h.calls.recovery); assert.equal(h.calls.complete, 0); assert.equal(h.calls.returned, 0);
    if (amount === 35000) assert.deepEqual(h.calls.dispense, []);
  });
}
test('successful exact change is recorded before completing cash payment', async () => {
  const h = cashScreen(40000, true); await h.callbacks[0](40000);
  assert.deepEqual(h.calls.dispense, [1]); assert.equal(h.calls.returned, 10000); assert.equal(h.calls.complete, 1);
});

async function onsite(stay = 'shortStay') {
  let idle, responseMode = 'success', release, roomLookupFails = false, roomPayload; const posts = [], intervals = [];
  const session = { isActive: false, acceptedAmount: 0 };
  const observed = { cancelledApprovals: 0, completed: 0 };
  const payment = { paymentSession: session, ready: true, storageError: '',
    startPayment: (_amount, reservationData) => { session.isActive = true; session.reservationData = reservationData; return true; },
    cancelPayment: async () => { if (session.acceptedAmount || session.pendingBooking || session.recoveryRequired) return false; session.isActive = false; return true; },
    completePayment: () => { session.isActive = false; session.pendingBooking = undefined; session.recoveryRequired = undefined; observed.completed++; return true; },
    savePendingBooking: value => { session.pendingBooking = value; return true; }, requireRecovery: value => session.recoveryRequired = value,
  };
  let rooms = ['B901', 'B902'].map(roomCode => ({ roomCode, roomType: 'Standard', building: 'B', floor: 'test', password: 'TEST',
    rates: { shortStay: { card: 30000, cash: 30000 }, overnight: { card: 60000, cash: 60000 } }, stayEnabled: { shortStay: true, overnight: true } }));
  const h = load('components/on-site-reservation.tsx', {
    '@/contexts/payment-context': { usePayment: () => payment }, '@/hooks/use-idle-timer': { useIdleTimer: options => idle = options.onIdle },
    '@/lib/room-utils': { getRoomImagePath: () => '/test.png' }, '@/lib/room-type-order': { sortRoomTypes: types => types.sort() },
    '@/components/payment-screen': { default: 'PaymentScreen' }, '@/components/check-in-complete': { default: 'CheckInComplete' },
    '@/components/kiosk-progress': { KioskProgressScreen: 'Progress', ON_SITE_PROGRESS_STEPS: [] },
  }, { window: { crypto: { randomUUID }, setInterval: fn => { intervals.push(fn); return intervals.length; }, clearInterval() {},
      electronAPI: { tossFront: { cancelPayment: async () => { observed.cancelledApprovals++; return { success: true }; } } } }, alert() {},
    fetch: async (_url, options) => {
      if (!options?.method) return { ok: !roomLookupFails, status: roomLookupFails ? 503 : 200, json: async () => roomPayload === undefined ? ({ roomsByType: rooms.length ? { Standard: rooms } : {} }) : roomPayload };
      posts.push(options.body);
      if (responseMode === 'lost') throw new Error('Response lost after commit');
      if (responseMode === 'waiting') await new Promise(resolve => release = resolve);
      return { ok: true, status: responseMode === 'pending' ? 202 : 200,
        json: async () => responseMode === 'pending' ? { success: false, pending: true } : responseMode === 'reject' ?
          { success: false, canCancelPayment: true, error: 'Room unavailable' } : { success: true, data: { roomCode: 'B901', password: responseMode === 'missing-key' ? undefined : responseMode === 'empty-key' ? '' : 'SERVER-TEST' } } };
    } });
  const render = () => h.render({ location: 'B', onNavigate() {} });
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); render(); };
  render(); for (const effect of h.effects) effect(); await settle();
  const click = async label => { await h.button(label).onClick(); await settle(); };
  return { ...h, render, settle, click, posts, session, observed, mode: x => responseMode = x, release: () => release(),
    async roomList() { await click(stay === 'shortStay' ? '대실 잠시 이용' : '숙박 오늘 입실 · 내일 퇴실'); await click('Standard 선택'); },
    async pay() { await this.roomList(); await click('B901호 선택'); await click('확인하고 결제하기'); },
    async idle() { await idle(); await settle(); }, async emptyRooms() { rooms = []; intervals[0](); await settle(); },
    async roomLookupFailure(value = true) { roomLookupFails = value; intervals[0](); await settle(); },
    async malformedRooms(value) { roomPayload = value; intervals[0](); await settle(); } };
}
for (const stay of ['shortStay', 'overnight']) {
  test(`${stay}: room selection back preserves stay type`, async () => { const h = await onsite(stay); await h.roomList(); await h.click('돌아가기'); assert(h.visible('객실 타입을 선택해주세요')); });
  test(`${stay}: empty-room back preserves stay type`, async () => { const h = await onsite(stay); await h.roomList(); await h.emptyRooms(); await h.click('다른 객실 타입 보기'); assert(h.visible('객실 타입을 선택해주세요')); });
}
for (const mode of ['lost', 'pending']) {
  test(`${mode} booking response retains session; retry reuses exact request without new payment`, async () => {
    const h = await onsite(); await h.pay(); h.mode(mode);
    await h.component('PaymentScreen').props.onPaymentComplete({ method: 'CARD', provider: 'TOSS_FRONT', front: { test: true } }); await h.settle();
    assert(h.visible('결제 처리 확인이 필요합니다')); assert(h.session.isActive); assert.equal(h.observed.cancelledApprovals, 0); assert.equal(h.observed.completed, 0);
    await h.idle(); assert(h.visible('결제 처리 확인이 필요합니다')); h.mode('success'); await h.click('기존 결제 처리 결과 다시 확인');
    assert.equal(h.posts.length, 2); assert.equal(h.posts[0], h.posts[1]); assert(h.component('CheckInComplete')); assert.equal(h.observed.completed, 1);
  });
}
test('booking in flight ignores double completion and idle, and only successful response completes', async () => {
  const h = await onsite(); await h.pay(); h.mode('waiting'); const complete = h.component('PaymentScreen').props.onPaymentComplete;
  const pending = complete({ method: 'CARD' }); await h.settle(); await complete({ method: 'CARD' }); await h.idle();
  assert.equal(h.posts.length, 1); assert(h.session.isActive); assert(h.visible('결제 처리 확인이 필요합니다'));
  h.release(); await pending; await h.settle(); assert(h.component('CheckInComplete'));
});
test('only explicit definitive rejection permits automatic card cancellation; cash rejection stays protected', async () => {
  const card = await onsite(); await card.pay(); card.mode('reject'); await card.component('PaymentScreen').props.onPaymentComplete({ method: 'CARD', provider: 'TOSS_FRONT', front: {} });
  assert.equal(card.observed.cancelledApprovals, 1);
  const cash = await onsite(); await cash.pay(); cash.session.acceptedAmount = 30000; cash.mode('reject');
  await cash.component('PaymentScreen').props.onPaymentComplete({ method: 'CASH' }); await cash.settle();
  assert.equal(cash.observed.completed, 0); assert.equal(cash.session.acceptedAmount, 30000);
  assert(cash.visible('결제 처리 확인이 필요합니다'));
});
test('lookup connectivity failure uses different wording and never plays reservation-not-found audio', () => {
  const audio = [];
  const h = load('components/reservation-not-found.tsx', { '@/lib/date-utils': { getCurrentDateKST: () => '2026-09-10', formatDateKorean: x => x },
    '@/lib/location-utils': { getLocationTitle: () => 'B' }, '@/lib/audio-utils': { playAudio: key => audio.push(key) }, '@/lib/property-utils': {} },
    { setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {} });
  h.render({ kioskLocation: 'B', lookupFailed: true, onNavigate() {}, onRecheck() {} }); for (const effect of h.effects) effect();
  assert(h.visible('예약 조회 연결 오류')); assert(!h.visible('다른 날짜에 예약')); assert.deepEqual(audio, []);
});
test('card cancellation PATCH failure keeps proof and retries only the record, never the terminal cancellation', async () => {
  const localStorage = storage(); let physicalCalls = 0, patches = 0;
  const reservationId = `ONSITE-${randomUUID()}`, proof = { paymentKey: 'test', signature: 'test' };
  const h = load('components/card-payment-cancel.tsx', {}, { window: { localStorage, electronAPI: { tossFront: {
    cancelPayment: async () => { physicalCalls++; return { success: true, cancel: { approvalNumber: 'test', cancelProof: proof } }; },
  } } }, fetch: async (_url, options) => options?.method === 'PATCH' ? {
    ok: ++patches > 1, json: async () => ({ success: patches > 1, error: 'Simulated record failure' }),
  } : { ok: true, json: async () => ({ payment: { reservationId, amount: 30000, status: 'claimed', paymentKey: 'test' } }) } });
  let tree = h.render(); for (const effect of h.effects) effect();
  nodes(tree).find(n => n.type === 'input').props.onChange({ target: { value: reservationId } }); h.render();
  await h.button('조회').onClick(); h.render(); await h.button('이 결제 승인취소').onClick(); h.render();
  assert.equal(physicalCalls, 1); assert.equal(patches, 1); assert.equal(h.button('이 결제 승인취소').disabled, true);
  assert(localStorage.map.get('kiosk-pending-card-cancel-v1').includes('cancelProof'));
  await h.button('취소 기록 저장만 다시 시도').onClick(); h.render();
  assert.equal(physicalCalls, 1); assert.equal(patches, 2); assert.equal(localStorage.map.size, 0);
  assert(h.visible('승인취소와 기록 저장이 완료되었습니다'));
});
for (const notApproved of [true, undefined]) {
  test(`terminal cancellation flag ${notApproved}: only authenticated no-approval permits retry`, async () => {
    const busy = [], recoveries = []; let requests = 0;
    const h = load('components/toss-front-card-payment.tsx', {
      '@/contexts/payment-context': { usePayment: () => ({ setCardInFlight: value => { busy.push(value); return true; }, requireRecovery: value => recoveries.push(value) }) },
    }, { window: { electronAPI: { tossFront: {
      getStatus: async () => ({ configured: true, connected: true, authenticated: true }), onStatus() {},
      requestPayment: async () => { requests++; return { success: false, notApproved, error: 'Test cancellation or lost response' }; },
    } } } });
    const props = { requiredAmount: 30000, onComplete() { assert.fail('Unapproved payment cannot complete'); }, onBack() {}, onCancel() {} };
    h.render(props); for (const effect of h.effects) effect(); await new Promise(resolve => setImmediate(resolve)); h.render(props);
    await h.button('카드 결제 다시 시도').onClick(); h.render(props);
    if (notApproved) {
      assert.deepEqual(busy, [true, false]); assert.deepEqual(recoveries, []); assert.equal(h.button('이전 화면').disabled, false);
      await h.button('카드 결제 다시 시도').onClick(); assert.equal(requests, 2);
    } else {
      assert.deepEqual(busy, [true]); assert.equal(recoveries.length, 1); await h.button('카드 결제 다시 시도').onClick(); assert.equal(requests, 1);
    }
  });
}
test('amount mismatch preserves actual approval proof without booking, automatic cancellation, or retry', async () => {
  const recoveries = []; let requests = 0, cancels = 0, completions = 0;
  const approval = { amount: 40000, paymentKey: 'test', signature: 'signed-test' };
  const h = load('components/toss-front-card-payment.tsx', {
    '@/contexts/payment-context': { usePayment: () => ({ setCardInFlight: () => true, requireRecovery: (message, evidence) => recoveries.push({ message, evidence }) }) },
  }, { window: { electronAPI: { tossFront: {
    getStatus: async () => ({ configured: true, connected: true, authenticated: true }), onStatus() {},
    requestPayment: async () => { requests++; return { success: true, payment: approval }; }, cancelPayment: async () => { cancels++; },
  } } } });
  const props = { requiredAmount: 30000, onComplete() { completions++; }, onBack() {}, onCancel() {} };
  h.render(props); for (const effect of h.effects) effect(); await new Promise(resolve => setImmediate(resolve)); h.render(props);
  await h.button('카드 결제 다시 시도').onClick(); h.render(props);
  assert.equal(recoveries.length, 1); assert.equal(recoveries[0].evidence.payment.front, approval); assert.equal(recoveries[0].evidence.expectedAmount, 30000);
  assert.equal(h.button('이전 화면').disabled, true); assert.equal(h.button('결제수단 변경').disabled, true);
  assert.equal(requests, 1); assert.equal(cancels, 0); assert.equal(completions, 0);
});
async function kiosk(scenario = {}) {
  let pending = true; const posts = [];
  const components = ['standby-screen', 'idle-screen', 'reservation-confirm', 'current-location', 'on-site-reservation',
    'reservation-details', 'check-in-complete', 'reservation-not-found', 'reservation-list', 'admin-keypad', 'property-mismatch-dialog', 'property-redirect-dialog'];
  const deps = Object.fromEntries(components.map(name => ['@/components/' + name, { default: name }]));
  Object.assign(deps, {
    'next/navigation': { useRouter: () => ({}) }, '@/lib/location-utils': { getKioskLocation: () => 'B' },
    '@/lib/audio-utils': { stopAllAudio() {}, pauseBGM() {}, resumeBGM() {} }, '@/components/print-queue-listener': { PrintQueueListener: 'PrintQueue' },
    '@/lib/property-utils': { getKioskPropertyId: () => 'property3', getPropertyDisplayName: x => x, propertyUsesElectron: () => true },
    '@/contexts/payment-context': { usePayment: () => ({ paymentSession: { isActive: false }, ready: true, storageError: '' }) },
    '@/lib/reservation-qr': load('lib/reservation-qr.ts').exports, '@/components/kiosk-progress': { KioskProgressScreen: 'Progress', RESERVATION_PROGRESS_STEPS: [] },
    '@/lib/kiosk-scope': { buildingRestrictionMessage: () => 'B only' },
  });
  const h = load('components/kiosk-layout.tsx', deps, { window: { location: { search: '' }, electronAPI: { tossFront: { scanReservationQr: scenario.scan || (async () => ({success: true, value: 'AGAIN:RESERVATION:QA-ONLY'})) } } }, document: { body: { classList: { add() {}, remove() {} } } },
    fetch: async (url, options) => {
      if (url === '/api/kiosk-config') return { ok: true, json: async () => ({ property: 'property3', building: 'B' }) };
      if (url.startsWith('/api/reservations')) return scenario.lookup ? scenario.lookup(url, options) : { ok: true, json: async () => ({ reservations: [{ reservationId: 'QA-ONLY', roomNumber: 'B901', guestName: 'QA', roomType: 'Test', price: '30000', checkInDate: '2026-09-10', checkOutDate: '2026-09-11', password: '' }] }) };
      posts.push(options.body); return { ok: true, status: pending ? 202 : 200, json: async () => ({ success: !pending, pending, data: { roomNumber: 'B901', password: 'TEST' } }) };
    } });
  const render = () => h.render({ onChangeMode() {} }); const settle = async () => { await new Promise(resolve => setImmediate(resolve)); render(); };
  render(); for (const effect of h.effects) effect(); await settle();
  const navigate = h.component('on-site-reservation').props.onNavigate;
  await navigate('reservationConfirm'); await settle();
  return { ...h, settle, render, navigate, posts, confirmCheckIn: () => pending = false };
}
test('existing reservation check-in 202 retains its screen and keys stay hidden until confirmed success', async () => {
  const h = await kiosk();
  await h.component('reservation-confirm').props.onCheckReservation('QA-ONLY'); await h.settle();
  assert.equal(await h.component('reservation-details').props.onCheckIn(), false); await h.settle();
  assert.equal(h.component('reservation-details').props.revealedInfo.password, ''); assert.equal(h.component('check-in-complete'), undefined);
  await h.component('reservation-details').props.onNavigate('idle'); await h.settle(); assert(h.component('reservation-details'));
  h.confirmCheckIn(); await h.button('이 예약의 체크인 처리 결과 다시 확인').onClick(); await h.settle();
  assert(h.component('check-in-complete')); assert.equal(h.posts[0], h.posts[1]);
});
test('inactive-looking persisted card evidence is corruption, not permission for a new sale', async () => {
  const saved = { isActive: false, acceptedAmount: 0, requiredAmount: 30000, acceptedBills: [], sessionStartTime: 0, overpaymentAmount: 0, cardInFlight: true };
  const h = await paymentContext(JSON.stringify(saved)); assert(h.value.storageError); assert.equal(h.value.startPayment(30000), false);
});
test('QR scan holds navigation and shares the synchronous duplicate guard with name lookup', async () => {
  let scanCalls = 0, release;
  const h = await kiosk({ scan: () => { scanCalls++; return new Promise(resolve => release = () => resolve({ success: true, value: 'AGAIN:RESERVATION:QA-ONLY' })); } });
  const scan = h.component('reservation-confirm').props.onScanReservationQr;
  const pending = scan(); await h.settle();
  void scan(); await h.navigate('idle'); await h.settle();
  assert.equal(scanCalls, 1); assert(h.component('reservation-confirm'));
  release(); await pending; await h.settle(); assert(h.component('reservation-details'));
});
test('room-type refresh failure hides stale sale choices until lookup succeeds again', async () => {
  const h = await onsite(); await h.click('대실 잠시 이용'); await h.roomLookupFailure();
  assert(h.visible('객실 정보를 불러오지 못했습니다')); assert(!h.visible('이 객실 선택'));
  await h.roomLookupFailure(false); assert(h.visible('객실 타입을 선택해주세요'));
});

test('on-site selection never stores or sends a pre-payment room password; completion uses only server data', async () => {
  const h = await onsite(); await h.pay();
  assert.equal(Object.hasOwn(h.session.reservationData, 'password'), false);
  await h.component('PaymentScreen').props.onPaymentComplete({ method: 'CASH' }); await h.settle();
  assert.equal(Object.hasOwn(JSON.parse(h.posts[0]), 'password'), false);
  assert.equal(h.component('CheckInComplete').props.revealedInfo.password, 'SERVER-TEST');
});
test('missing completion key field keeps pending evidence; explicit empty server key remains a confirmed reservation', async () => {
  const h = await onsite(); await h.pay(); h.mode('missing-key');
  await h.component('PaymentScreen').props.onPaymentComplete({ method: 'CARD' }); await h.settle();
  assert(h.session.pendingBooking); assert(h.session.recoveryRequired); assert.equal(h.observed.completed, 0);
  assert.equal(h.component('CheckInComplete'), undefined); assert.equal(h.observed.cancelledApprovals, 0);
  h.mode('empty-key'); await h.click('기존 결제 처리 결과 다시 확인');
  assert.equal(h.observed.completed, 1); assert.equal(h.component('CheckInComplete').props.revealedInfo.password, '');
});
test('invalid price or cash-return amount cannot create or rewrite a monetary session', async () => {
  const h = await paymentContext();
  for (const amount of [NaN, Infinity, -1, 0, 1.5]) assert.equal(h.value.startPayment(amount), false, String(amount));
  assert(h.value.startPayment(30000)); h.value.addBill(10000);
  for (const amount of [NaN, Infinity, -10000, 0, 10001, 1.5]) {
    h.value.recordCashReturned(amount); assert.equal(h.value.paymentSession.acceptedAmount, 10000, String(amount));
  }
});
test('name lookup ignores blank input and encodes Unicode and query punctuation without widening search', async () => {
  const urls = [];
  const h = await kiosk({ lookup: async (url, options) => { urls.push(url); assert(options.signal); return { ok: true, json: async () => ({ reservations: [] }) }; } });
  const find = h.component('reservation-confirm').props.onCheckReservation;
  await find('  '); assert.equal(urls.length, 0);
  await find('테스트 &searchAll=true'); await h.settle();
  const url = new URL(urls[0], 'http://test.invalid');
  assert.equal(url.searchParams.get('name'), '테스트 &searchAll=true'); assert.equal(url.searchParams.get('searchAll'), null);
  assert.equal(h.component('reservation-not-found').props.lookupFailed, false);
});
for (const malformed of [{}, { reservations: 'invalid' }, { reservations: [null] }]) {
  test('malformed name lookup becomes an explicit error, not missing-reservation or a blank details screen: ' + JSON.stringify(malformed), async () => {
    const h = await kiosk({ lookup: async () => ({ ok: true, json: async () => malformed }) });
    await h.component('reservation-confirm').props.onCheckReservation('QA'); await h.settle();
    assert.equal(h.component('reservation-not-found')?.props.lookupFailed, true); assert.equal(h.component('reservation-details'), undefined);
  });
}
for (const value of ['wrong-prefix', 'AGAIN:RESERVATION:', 'AGAIN:RESERVATION:a:b', 'AGAIN:RESERVATION:a b']) {
  test('invalid QR is rejected before an API lookup: ' + value, async () => {
    let lookups = 0;
    const h = await kiosk({ scan: async () => ({ success: true, value }), lookup: async () => { lookups++; throw new Error('Unexpected lookup'); } });
    await h.component('reservation-confirm').props.onScanReservationQr(); await h.settle();
    assert.equal(lookups, 0); assert(h.component('reservation-confirm')); assert.equal(h.component('reservation-confirm').props.loading, false);
  });
}
test('name lookup timeout releases duplicate guard for a later retry and uses connection-error UI', async () => {
  let calls = 0;
  const h = await kiosk({ lookup: async () => { calls++; throw new Error('Simulated timeout'); } });
  await h.component('reservation-confirm').props.onCheckReservation('QA'); await h.settle();
  assert.equal(h.component('reservation-not-found').props.lookupFailed, true);
  await h.navigate('reservationConfirm'); await h.settle();
  await h.component('reservation-confirm').props.onCheckReservation('QA'); await h.settle(); assert.equal(calls, 2);
});
test('cash/card method switching before hardware enable neither completes nor refunds and keeps the current amount', async () => {
  const h = cashScreen(0, true);
  for (let i = 0; i < 3; i++) {
    await h.button('결제수단 변경').onClick(); h.render(); h.button('카드 결제 30,000원').onClick(); h.render();
    assert.equal(h.component('Front').props.requiredAmount, 30000);
    h.component('Front').props.onBack(); h.render(); h.button('현금 결제 30,000원').onClick(); h.render();
  }
  assert.equal(h.calls.complete, 0); assert.equal(h.calls.cancelled, 0); assert.deepEqual(h.calls.dispense, []);
});

for (const payload of [{}, { roomsByType: { Standard: null } }, { roomsByType: { Standard: [null] } }]) {
  test('malformed available-room response is a lookup error, not an empty or crashed sale screen: ' + JSON.stringify(payload), async () => {
    const h = await onsite(); await h.malformedRooms(payload);
    assert(h.visible('객실 정보를 불러오지 못했습니다')); assert.equal(h.component('PaymentScreen'), undefined);
  });
}
test('cash-return validation rejects all invalid values without losing the original liability', async () => {
  const h = await paymentContext(); h.value.startPayment(30000); h.value.addBill(10000);
  for (const amount of [NaN, Infinity, -10000, 0, 10001, 1.5]) {
    h.value.recordCashReturned(amount); assert.equal(h.value.paymentSession.acceptedAmount, 10000, String(amount));
  }
});
for (const extra of [
  { pendingBooking: { requestId: 'first', body: '{"requestId":"second"}' } },
  { acceptedBills: [null] },
  { acceptedAmount: -1 },
]) {
  test('corrupted saved payment fails closed: ' + JSON.stringify(extra), async () => {
    const h = await paymentContext(JSON.stringify({ isActive: true, requiredAmount: 30000, acceptedAmount: 0, acceptedBills: [], ...extra }));
    assert(h.value.storageError); assert.equal(h.value.startPayment(30000), false);
  });
}
async function cancellationPanel(scenario = {}, localStorage = storage()) {
  const calls = { terminal: 0, get: 0, patch: 0 };
  const reservationId = 'ONSITE-TEST';
  const h = load('components/card-payment-cancel.tsx', {}, { window: { localStorage, electronAPI: { tossFront: {
    cancelPayment: async () => { calls.terminal++; assert(localStorage.map.has('kiosk-pending-card-cancel-v1')); return scenario.cancel ? scenario.cancel() : { success: true, cancel: { cancelProof: { signature: 'test' } } }; },
  } } }, fetch: async (_url, options) => {
    if (options?.method === 'PATCH') { calls.patch++; return scenario.patch ? scenario.patch() : { ok: true, json: async () => ({ success: true }) }; }
    calls.get++; return scenario.lookup ? scenario.lookup(options) : { ok: true, json: async () => ({ payment: { reservationId, amount: 30000, status: 'claimed', paymentKey: 'test' } }) };
  } });
  let tree = h.render(); for (const effect of h.effects) effect(); tree = h.render();
  const lookup = async () => { nodes(tree).find(n => n.type === 'input').props.onChange({ target: { value: reservationId } }); h.render(); await h.button('조회').onClick(); tree = h.render(); };
  return { ...h, calls, localStorage, lookup };
}
test('lost physical cancellation response survives restart and cannot issue another terminal cancellation', async () => {
  let release;
  const h = await cancellationPanel({ cancel: () => new Promise((_, reject) => { release = () => reject(new Error('Lost terminal reply')); }) }); await h.lookup();
  const cancel = h.button('이 결제 승인취소').onClick;
  const pending = cancel(); await cancel(); assert.equal(h.calls.terminal, 1);
  release(); await pending; h.render(); await h.button('이 결제 승인취소').onClick(); h.render();
  assert.equal(h.calls.terminal, 1); assert.equal(h.calls.patch, 0);
  const restored = await cancellationPanel({}, h.localStorage); assert(restored.visible('단말기 취소 결과를 관리자와 확인해주세요'));
  await restored.button('조회').onClick(); assert.equal(restored.calls.terminal, 0); assert.equal(restored.calls.get, 0);
});
test('lost cancellation record response survives restart and retries signed record only', async () => {
  const h = await cancellationPanel({ patch: () => { throw new Error('Response lost after record commit'); } }); await h.lookup();
  await h.button('이 결제 승인취소').onClick(); h.render(); assert.equal(h.calls.terminal, 1); assert.equal(h.calls.patch, 1);
  const restored = await cancellationPanel({}, h.localStorage);
  await restored.button('취소 기록 저장만 다시 시도').onClick(); restored.render();
  assert.equal(restored.calls.terminal, 0); assert.equal(restored.calls.patch, 1); assert.equal(h.localStorage.map.size, 0);
});
test('corrupted cancellation storage visibly disables lookup as well as guarding its handler', async () => {
  const h = await cancellationPanel({}, storage({ 'kiosk-pending-card-cancel-v1': '{bad' }));
  assert(h.visible('이전 취소 기록을 읽지 못했습니다')); assert.equal(h.button('조회').disabled, true);
  await h.button('조회').onClick(); assert.equal(h.calls.get, 0);
});
test('malformed cancellation lookup cannot render an actionable payment or throw', async () => {
  const h = await cancellationPanel({ lookup: () => ({ ok: true, json: async () => ({ payment: {} }) }) });
  await h.lookup(); assert(h.visible('결제 기록 조회')); assert(!h.visible('이 결제 승인취소')); assert.equal(h.calls.terminal, 0);
});
test('cancellation lookup sets a bounded request signal and timeout restores its input', async () => {
  let signal;
  const h = await cancellationPanel({ lookup: options => { signal = options?.signal; throw new Error('Lookup timed out'); } });
  await h.lookup(); assert(signal); assert.equal(h.button('조회').disabled, false); assert(h.visible('결제 기록 조회에 실패했습니다')); assert.equal(h.calls.terminal, 0);
});
test('confirmed empty password displays assistance, never a false password-printed claim', () => {
  const h = load('components/check-in-complete.tsx', {
    'next/image': { default: 'img' }, '@/lib/printer-utils-unified': {}, '@/lib/location-utils': { getBuildingZoomImagePath: () => '/test.png' },
    '@/lib/audio-utils': {}, '@/hooks/use-idle-timer': { useIdleTimer() {} }, '@/lib/property-utils': {},
  });
  h.render({ reservation: { roomNumber: 'B901', password: '' }, revealedInfo: { roomNumber: 'B901', password: '', floor: '9' } });
  assert(h.visible('결제와 체크인이 완료되었습니다')); assert(h.visible('관리자에게 문의해주세요')); assert(!h.visible('객실번호와 비밀번호가 적혀 있습니다'));
});
test('reservation input ignores whitespace and disables keyboard/scan while loading', () => {
  let checks = 0;
  const h = load('components/reservation-confirm.tsx', { './korean-keyboard': { default: 'Keyboard' }, '@/lib/location-utils': { getLocationTitle: () => 'B' },
    '@/lib/audio-utils': {}, '@/hooks/use-idle-timer': { useIdleTimer() {} }, '@/lib/property-utils': {} });
  const props = { guestName: '  ', onCheckReservation: () => checks++, onScanReservationQr() {}, onNavigate() {}, setGuestName() {} };
  h.render(props); assert.equal(h.button('예약 확인하기').disabled, true); h.component('Keyboard').props.onEnter(); assert.equal(checks, 0);
  h.render({ ...props, guestName: '테스트', loading: true }); assert.equal(h.component('Keyboard').props.disabled, true);
  h.component('Keyboard').props.onEnter(); assert.equal(checks, 0);
  assert.equal(h.button('예약 QR 스캔 문자 또는 예약 사이트의 QR을 보여주세요').disabled, true);
  h.render({ ...props, guestName: '테스트' }); h.component('Keyboard').props.onEnter(); assert.equal(checks, 1);
});
test('actual idle hook schedules 60 seconds, resets on touch, and removes listeners/timer on unmount', () => {
  const timers = new Map(), listeners = new Map(); let timerId = 0, calls = 0;
  const h = load('hooks/use-idle-timer.ts', {}, {
    setTimeout(fn, duration) { const id = ++timerId; timers.set(id, { fn, duration }); return id; }, clearTimeout: id => timers.delete(id),
    document: { addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) },
  });
  h.render({ onIdle: () => calls++ }, 'useIdleTimer'); const cleanup = h.effects[0]();
  assert.equal(timers.get(1).duration, 60000); listeners.get('touchstart')(); assert(!timers.has(1)); assert.equal(timers.get(2).duration, 60000);
  timers.get(2).fn(); assert.equal(calls, 1); cleanup(); assert.equal(listeners.size, 0); assert(!timers.has(2));
});
