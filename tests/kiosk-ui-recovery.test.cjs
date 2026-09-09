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
  const values = [], effects = [], callbacks = []; let index = 0, first = true;
  const element = (type, props) => ({ type, props });
  const react = {
    useState(initial) { const i = index++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial;
      return [values[i], v => values[i] = typeof v === 'function' ? v(values[i]) : v]; },
    useRef(initial) { const i = index++; if (!(i in values)) values[i] = { current: initial }; return values[i]; },
    useEffect(fn) { if (first) effects.push(fn); }, useCallback: fn => { callbacks.push(fn); return fn; },
    createContext: () => ({ Provider: 'Provider' }), useContext: () => undefined,
  };
  const deps = { react, 'react/jsx-runtime': { jsx: element, jsxs: element }, 'lucide-react': {}, ...extra };
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
  return { exports, effects, callbacks,
    render(props = {}, name = 'default') { index = 0; callbacks.length = 0; tree = exports[name](props); first = false; return tree; },
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
async function paymentContext(saved) {
  const localStorage = storage(saved ? { 'kiosk-payment-recovery-v1': saved } : {});
  const h = load('contexts/payment-context.tsx', {}, { window: { localStorage } });
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
test('mismatched approval evidence survives restart and cannot be cleared by navigation cancellation', async () => {
  const h = await paymentContext(); h.value.startPayment(30000, {}, 'card'); h.value.setCardInFlight(true);
  const evidence = { expectedAmount: 30000, payment: { method: 'CARD', provider: 'TOSS_FRONT', front: { amount: 40000, paymentKey: 'test', signature: 'signed-test' } } };
  h.value.requireRecovery('Approval amount mismatch', evidence);
  const restored = await paymentContext(h.localStorage.map.get('kiosk-payment-recovery-v1'));
  assert.equal(JSON.stringify(restored.value.paymentSession.recoveryEvidence), JSON.stringify(evidence));
  assert.equal(await restored.value.cancelPayment(), false); assert.equal(restored.value.startPayment(30000), false);
});
function cashScreen(amount, dispenseResult) {
  const calls = { dispense: [], cancelled: 0, complete: 0, recovery: '', returned: 0 };
  const paymentSession = { isActive: true, acceptedAmount: amount, acceptedBills: amount ? [amount] : [], requiredAmount: 30000, overpaymentAmount: Math.max(0, amount - 30000) };
  const payment = { paymentSession, startPayment: () => true, addBill() {}, isPaymentComplete: () => amount >= 30000,
    cancelPayment: async () => { calls.cancelled++; return true; }, requireRecovery: message => calls.recovery = message,
    recordCashReturned: value => { calls.returned += value; paymentSession.acceptedAmount -= value; } };
  const h = load('components/payment-screen.tsx', {
    '@/contexts/payment-context': { usePayment: () => payment }, '@/components/toss-front-card-payment': { default: 'Front' },
    '@/lib/bill-acceptor-utils': { initializeDevice: async () => true, setEventCallback() {}, setConfig: async () => true, isBillAcceptorConnected: () => true,
      connectBillAcceptor: async () => true, enableAcceptance: async () => true, getBillData: async () => 0x32, getStatus: async () => 0x0b },
    '@/lib/bill-dispenser-utils': { dispenseBills: async n => { calls.dispense.push(n); return dispenseResult; }, connectBillDispenser: async () => true, isBillDispenserConnected: () => true },
    '@/lib/printer-utils': { printReceipt() {} },
  }, { window: {}, setTimeout: fn => { fn(); return 1; }, clearInterval() {}, setInterval() {} });
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
  let idle, responseMode = 'success', release; const posts = [], intervals = [];
  const session = { isActive: false, acceptedAmount: 0 };
  const observed = { cancelledApprovals: 0, completed: 0 };
  const payment = { paymentSession: session, ready: true, storageError: '',
    startPayment: () => { session.isActive = true; return true; },
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
      if (!options?.method) return { ok: true, json: async () => ({ roomsByType: rooms.length ? { Standard: rooms } : {} }) };
      posts.push(options.body);
      if (responseMode === 'lost') throw new Error('Response lost after commit');
      if (responseMode === 'waiting') await new Promise(resolve => release = resolve);
      return { ok: true, status: responseMode === 'pending' ? 202 : 200,
        json: async () => responseMode === 'pending' ? { success: false, pending: true } : responseMode === 'reject' ?
          { success: false, canCancelPayment: true, error: 'Room unavailable' } : { success: true, data: { roomCode: 'B901' } } };
    } });
  const render = () => h.render({ location: 'B', onNavigate() {} });
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); render(); };
  render(); for (const effect of h.effects) effect(); await settle();
  const click = async label => { await h.button(label).onClick(); await settle(); };
  return { ...h, render, settle, click, posts, session, observed, mode: x => responseMode = x, release: () => release(),
    async roomList() { await click(stay === 'shortStay' ? '대실 잠시 이용' : '숙박 오늘 입실 · 내일 퇴실'); await click('Standard 선택'); },
    async pay() { await this.roomList(); await click('B901호 선택'); await click('확인하고 결제하기'); },
    async idle() { await idle(); await settle(); }, async emptyRooms() { rooms = []; intervals[0](); await settle(); } };
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
test('existing reservation check-in 202 retains its screen and keys stay hidden until confirmed success', async () => {
  let pending = true; const posts = [];
  const components = ['standby-screen', 'idle-screen', 'reservation-confirm', 'current-location', 'on-site-reservation',
    'reservation-details', 'check-in-complete', 'reservation-not-found', 'reservation-list', 'admin-keypad', 'property-mismatch-dialog', 'property-redirect-dialog'];
  const deps = Object.fromEntries(components.map(name => ['@/components/' + name, { default: name }]));
  Object.assign(deps, {
    'next/navigation': { useRouter: () => ({}) }, '@/lib/location-utils': { getKioskLocation: () => 'B' },
    '@/lib/audio-utils': { stopAllAudio() {}, pauseBGM() {}, resumeBGM() {} }, '@/components/print-queue-listener': { PrintQueueListener: 'PrintQueue' },
    '@/lib/property-utils': { getKioskPropertyId: () => 'property3', getPropertyDisplayName: x => x, propertyUsesElectron: () => true },
    '@/contexts/payment-context': { usePayment: () => ({ paymentSession: { isActive: false }, ready: true, storageError: '' }) },
    '@/lib/reservation-qr': {}, '@/components/kiosk-progress': { KioskProgressScreen: 'Progress', RESERVATION_PROGRESS_STEPS: [] },
    '@/lib/kiosk-scope': { buildingRestrictionMessage: () => 'B only' },
  });
  const h = load('components/kiosk-layout.tsx', deps, { window: { location: { search: '' } }, document: { body: { classList: { add() {}, remove() {} } } },
    fetch: async (url, options) => {
      if (url === '/api/kiosk-config') return { ok: true, json: async () => ({ property: 'property3', building: 'B' }) };
      if (url.startsWith('/api/reservations')) return { ok: true, json: async () => ({ reservations: [{ reservationId: 'QA-ONLY', roomNumber: 'B901' }] }) };
      posts.push(options.body); return { ok: true, status: pending ? 202 : 200, json: async () => ({ success: !pending, pending, data: { roomNumber: 'B901', password: 'TEST' } }) };
    } });
  const render = () => h.render({ onChangeMode() {} }); const settle = async () => { await new Promise(resolve => setImmediate(resolve)); render(); };
  render(); for (const effect of h.effects) effect(); await settle();
  await h.component('on-site-reservation').props.onNavigate('reservationConfirm'); await settle();
  await h.component('reservation-confirm').props.onCheckReservation('QA-ONLY'); await settle();
  assert.equal(await h.component('reservation-details').props.onCheckIn(), false); await settle();
  assert.equal(h.component('reservation-details').props.revealedInfo.password, ''); assert.equal(h.component('check-in-complete'), undefined);
  await h.component('reservation-details').props.onNavigate('idle'); await settle(); assert(h.component('reservation-details'));
  pending = false; await h.button('이 예약의 체크인 처리 결과 다시 확인').onClick(); await settle();
  assert(h.component('check-in-complete')); assert.equal(posts[0], posts[1]);
});
