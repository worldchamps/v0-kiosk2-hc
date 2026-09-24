const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, deps = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require(name) { assert(name in deps, name); return deps[name]; },
    Request, Response, AbortSignal, Date, ...globals });
  return exports;
}

test('preview denies reservation and payment APIs while keeping the assistant available', () => {
  const next = { next: () => ({ status: 200 }), json: (body, init) => ({ body, status: init.status }) };
  const middleware = load('middleware.ts', { 'next/server': { NextResponse: next } }, { process: { env: { VERCEL_ENV: 'preview' } } }).middleware;
  const check = (method, pathname) => middleware({ method, nextUrl: { pathname } }).status;
  assert.equal(check('POST', '/api/check-in'), 403);
  assert.equal(check('POST', '/api/on-site-booking'), 403);
  assert.equal(check('POST', '/api/toss-payments/create'), 403);
  assert.equal(check('GET', '/api/reservations'), 403);
  assert.equal(check('GET', '/api/available-rooms'), 403);
  assert.equal(check('GET', '/api/kiosk-config'), 200);
  assert.equal(check('POST', '/api/kiosk-assistant/ask'), 200);
  assert.equal(check('POST', '/api/kiosk-assistant/realtime'), 200);
  assert.equal(check('POST', '/api/kiosk-assistant/log'), 200);
});

test('preview availability never reads live rooms and logs a safe response', async () => {
  const content = load('lib/kiosk-assistant-content.ts');
  const lines = [];
  const logger = load('lib/kiosk-assistant-preview-log.ts', {}, {
    process: { env: { VERCEL_ENV: 'preview' } }, console: { info: (...parts) => lines.push(parts) },
  });
  const route = load('app/api/kiosk-assistant/ask/route.ts', {
    'next/server': { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } },
    '@/app/api/available-rooms/route': { GET: () => { throw new Error('Live room lookup was called'); } },
    '@/lib/kiosk-assistant-content': content,
    '@/lib/kiosk-scope': { getKioskScope: () => ({ property: 'property3', building: 'A' }), isRoomInBuilding: () => true },
    '@/lib/property-utils': { getPropertyFromRoomNumber: () => 'property3' },
    '@/lib/date-utils': { formatDateTimeKorean: text => text },
    '@/lib/kiosk-assistant-speech': { createSpeechToken: () => null },
    '@/lib/kiosk-assistant-preview-log': logger,
  }, { process: { env: { VERCEL_ENV: 'preview' } } });
  const result = await route.POST({ json: async () => ({
    sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', question: '객실 있나요?', topic: 'availability', screen: 'home',
  }) });
  assert.equal(result.status, 200);
  assert.match(result.body.answer, /확인하지 못했습니다/);
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0][1]);
  assert.equal(entry.event, 'answer');
  assert.equal(entry.question, '객실 있나요?');
  assert.equal(entry.topic, 'availability');
  assert.equal(entry.sessionId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
});

test('preview log endpoint accepts only known events and session IDs', async () => {
  const logged = [];
  const logger = load('lib/kiosk-assistant-preview-log.ts', {}, {
    process: { env: { VERCEL_ENV: 'preview' } }, console: { info: (...parts) => logged.push(parts) },
  });
  const route = load('app/api/kiosk-assistant/log/route.ts', { '@/lib/kiosk-assistant-preview-log': logger },
    { process: { env: { VERCEL_ENV: 'preview' } } });
  const call = body => route.POST({ json: async () => body });
  assert.equal((await call({ sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', event: 'connected' })).status, 204);
  assert.equal((await call({ sessionId: 'bad', event: 'connected' })).status, 400);
  assert.equal((await call({ sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', event: 'secret=123' })).status, 400);
  assert.equal(logged.length, 1);
});
