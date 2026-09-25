// Exercise the voice flow with fake media and APIs. No microphone or paid request.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, dependencies = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, AbortController, AbortSignal,
    require(name) { assert(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; }, ...globals });
  return exports;
}
const content = load('lib/kiosk-assistant-content.ts');
const assistantStream = load('lib/kiosk-assistant-stream.ts', {}, { TextDecoder });
const flush = () => new Promise(resolve => setImmediate(resolve));
const json = value => ({ ok: true, json: async () => value });

test('assistant stream reads answer fragments and completion', async () => {
  const parts = [];
  const response = new Response([
    JSON.stringify({ type: 'delta', text: '방 ' }),
    JSON.stringify({ type: 'delta', text: '있어요.' }),
    JSON.stringify({ type: 'done', topic: 'availability', speechToken: 'signed' }),
  ].join('\n') + '\n');
  const result = await assistantStream.readAssistantStream(response, text => parts.push(text));
  assert.deepEqual(parts, ['방 ', '있어요.']);
  assert.equal(result.topic, 'availability');
});

function voiceHarness() {
  const refs = [], requests = [], sent = [], questions = [], answers = [], errors = [], timers = new Map(), intervals = new Map(), audios = [];
  let index = 0, now = 1000, cleanup, peer, level = 0, stopped = 0;
  let releaseSpeech;
  const speechBlob = new Promise(resolve => { releaseSpeech = () => resolve({ wav: true }); });
  const track = { enabled: true, stop() { stopped++; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const analyser = { fftSize: 512, getByteTimeDomainData(samples) { samples.fill(128 + Math.round(level * 128)); } };
  const channel = { readyState: 'open', send(text) { sent.push(JSON.parse(text)); }, close() { this.readyState = 'closed'; this.onclose?.(); } };
  const react = {
    useRef(initial) { const i = index++; return refs[i] ||= { current: initial }; },
    useState(initial) { const i = index++; if (!(i in refs)) refs[i] = initial;
      return [refs[i], value => { refs[i] = typeof value === 'function' ? value(refs[i]) : value; }]; },
    useCallback: fn => fn, useEffect: fn => { cleanup ||= fn(); },
  };
  class Peer {
    constructor() { peer = this; }
    addTrack() {}
    createDataChannel() { return channel; }
    async createOffer() { return { type: 'offer', sdp: 'test-offer' }; }
    async setLocalDescription() {}
    async setRemoteDescription() { channel.onopen(); }
    close() { this.connectionState = 'closed'; this.onconnectionstatechange?.(); }
  }
  class FakeAudioContext {
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return analyser; }
    async resume() {}
    async close() { this.closed = true; }
  }
  const hook = load('hooks/use-kiosk-realtime-voice.ts', { react, '@/lib/kiosk-assistant-stream': assistantStream }, {
    navigator: { mediaDevices: { getUserMedia: async () => stream } },
    RTCPeerConnection: Peer, AudioContext: FakeAudioContext,
    Audio: class { constructor(src) { this.src = src; this.currentTime = 0; this.duration = 4; audios.push(this); } async play() { this.played = true; } pause() { this.paused = true; } },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    Date: { now: () => now },
    setTimeout(fn, delay) { timers.set(fn, delay); return fn; }, clearTimeout: id => timers.delete(id),
    setInterval(fn, delay) { intervals.set(fn, delay); return fn; }, clearInterval: id => intervals.delete(id),
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (url === '/api/kiosk-assistant/realtime') return json({ value: 'ephemeral-test', silenceMs: 700, voiceThreshold: 0.018 });
      if (url.endsWith('/realtime/calls')) return { ok: true, text: async () => 'test-answer' };
      if (url === '/api/kiosk-assistant/ask') return new Response([
        JSON.stringify({ type: 'delta', text: '결과가 불분명하면 ' }),
        JSON.stringify({ type: 'delta', text: '추가 결제하지 말고 직원에게 연락해 주세요.' }),
        JSON.stringify({ type: 'done', topic: 'payment', speechToken: 'signed-speech' }),
      ].join('\n') + '\n');
      if (url === '/api/kiosk-assistant/speak') return { ok: true, blob: () => speechBlob };
      throw new Error(`Unexpected request ${url}`);
    },
  }).useKioskRealtimeVoice;
  return {
    get voice() { index = 0; return hook({ screen: 'onSiteReservation:payment', onQuestion: value => questions.push(value), onAnswer: value => answers.push(value), onError: value => errors.push(value) }); },
    event: value => channel.onmessage({ data: JSON.stringify(value) }),
    tick() { [...intervals.keys()][0]?.(); },
    setLevel: value => { level = value; },
    advance: ms => { now += ms; },
    track, stream, channel, timers, intervals, requests, sent, questions, answers, errors, audios, releaseSpeech,
    get peer() { return peer; }, get stopped() { return stopped; }, unmount: () => cleanup(),
  };
}

test('silence commits one OpenAI transcript turn, then Gemini guidance and TTS play', async () => {
  const h = voiceHarness();
  await h.voice.start();
  assert.equal(h.voice.phase, 'listening');
  h.setLevel(0.06); h.tick();
  h.event({ type: 'conversation.item.input_audio_transcription.delta', delta: '결제가 ' });
  h.event({ type: 'conversation.item.input_audio_transcription.delta', delta: '안 돼요' });
  assert.deepEqual(h.questions.slice(-2), ['결제가 ', '결제가 안 돼요']);
  h.setLevel(0); h.advance(700); h.tick();
  assert.deepEqual(h.sent, [{ type: 'input_audio_buffer.commit' }]);
  assert.equal(h.track.enabled, false);
  h.tick();
  assert.equal(h.sent.length, 1);
  h.event({ type: 'conversation.item.input_audio_transcription.completed', transcript: '결제가 안 돼요' });
  for (let i = 0; i < 20 && !h.requests.some(r => r.url.endsWith('/speak')); i++) await flush();
  assert.deepEqual(JSON.parse(h.requests.find(r => r.url.endsWith('/ask')).init.body), {
    question: '결제가 안 돼요', screen: 'onSiteReservation:payment',
  });
  assert.equal(h.requests.some(r => r.url.endsWith('/speak')), true);
  assert.equal(h.answers.filter(Boolean).length, 0);
  h.releaseSpeech();
  for (let i = 0; i < 20 && !h.audios[0]?.played; i++) await flush();
  assert.equal(h.voice.phase, 'speaking');
  assert.equal(h.answers.at(-1), '결과가 ');
  h.audios[0].currentTime = 2;
  h.audios[0].ontimeupdate();
  assert(h.answers.at(-1).length > '결과가 '.length);
  h.audios[0].onended();
  assert.match(h.answers.at(-1), /추가 결제하지 말고 직원에게 연락해 주세요/);
  assert.equal(h.track.enabled, true);
  h.unmount();
  assert.equal(h.stopped, 1);
  assert.equal(h.peer.connectionState, 'closed');
  assert.equal(h.channel.readyState, 'closed');
  assert.equal(h.intervals.size, 0);
  assert.equal(h.timers.size, 0);
});

test('silence without speech does not commit an empty turn', async () => {
  const h = voiceHarness();
  await h.voice.start();
  h.advance(3000); h.tick();
  assert.deepEqual(h.sent, []);
  assert.equal(h.requests.some(r => r.url.endsWith('/ask')), false);
  h.voice.stop();
});

test('transcription session uses gpt-live-transcribe with client-side turn detection', async () => {
  let session, headers;
  const route = load('app/api/kiosk-assistant/realtime/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => ({ body, init }) } },
    '@/lib/kiosk-scope': { getKioskScope: () => ({ property: 'property3', building: 'A' }) },
  }, { process: { env: { OPENAI_API_KEY: 'server-only-test', KIOSK_ASSISTANT_SILENCE_MS: '900' } }, fetch: async (_, init) => {
    headers = init.headers;
    session = JSON.parse(init.body).session;
    return json({ value: 'short-lived-test' });
  } });
  const result = await route.POST();
  assert.equal(result.body.value, 'short-lived-test');
  assert.equal(result.body.silenceMs, 900);
  assert.equal(session.type, 'transcription');
  assert.equal(session.audio.input.transcription.model, 'gpt-live-transcribe');
  assert.equal(session.audio.input.transcription.delay, 'low');
  assert.equal(session.audio.input.turn_detection, null);
  assert.equal(headers.Authorization, 'Bearer server-only-test');
  assert(!JSON.stringify(result).includes('server-only-test'));
});

test('kiosk assistant is unavailable and Preview blocks PMS and payment APIs', () => {
  const next = { next: () => ({ status: 200 }), json: (body, init) => ({ body, status: init.status }) };
  const middleware = load('middleware.ts', { 'next/server': { NextResponse: next } },
    { process: { env: { VERCEL_ENV: 'preview' } } }).middleware;
  const check = (method, pathname) => middleware({ method, nextUrl: { pathname } }).status;
  assert.equal(check('POST', '/api/check-in'), 403);
  assert.equal(check('POST', '/api/on-site-booking'), 403);
  assert.equal(check('POST', '/api/toss-payments/create'), 403);
  assert.equal(check('GET', '/api/reservations'), 403);
  assert.equal(check('GET', '/api/available-rooms'), 403);
  assert.equal(check('GET', '/api/kiosk-config'), 200);
  assert.equal(check('POST', '/api/kiosk-assistant/ask'), 404);
  assert.equal(check('POST', '/api/kiosk-assistant/realtime'), 404);
  assert.equal(check('POST', '/api/kiosk-assistant/speak'), 404);
  const installed = load('middleware.ts', { 'next/server': { NextResponse: next } },
    { process: { env: {} } }).middleware;
  assert.equal(installed({ method: 'POST', nextUrl: { pathname: '/api/kiosk-assistant/ask' } }).status, 404);
  assert.equal(installed({ method: 'POST', nextUrl: { pathname: '/api/check-in' } }).status, 200);
});

test('Gemini receives fixed topic hints without the original question or personal identifiers', async () => {
  const contents = [];
  let roomReads = 0;
  const env = { GEMINI_API_KEY: 'gemini-test-key' };
  const route = load('app/api/kiosk-assistant/ask/route.ts', {
    'next/server': { NextResponse: { json: (body, init = {}) => ({ body, init, status: init.status ?? 200, ok: !init.status || init.status < 400, json: async () => body, headers: init.headers }) } },
    '@/app/api/available-rooms/route': { GET: async () => { roomReads++; return { ok: true, json: async () => ({ availableRooms: [] }) }; } },
    '@/lib/kiosk-assistant-content': content,
    '@/lib/kiosk-scope': { getKioskScope: () => ({ property: 'property3', building: 'A' }), isRoomInBuilding: () => true },
    '@/lib/property-utils': { getPropertyFromRoomNumber: () => 'property3' },
    '@/lib/kiosk-assistant-speech': load('lib/kiosk-assistant-speech.ts', { 'node:crypto': require('node:crypto') }),
  }, { process: { env }, Response, ReadableStream, TextEncoder, setTimeout, fetch: async (url, init) => {
    assert.match(url, /gemini-3\.5-flash-lite:generateContent$/);
    contents.push(JSON.parse(init.body));
    const topic = contents.at(-1).contents[0].parts[0].text.includes('availability=') ? 'availability' : 'payment';
    return json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ topic }) }] } }] });
  }, Request });
  const result = await route.POST(new Request('http://kiosk.local/api/kiosk-assistant/ask', {
    method: 'POST', body: JSON.stringify({ question: '김철수 결제 방법 알려주세요', screen: 'onSiteReservation:payment', roomNumber: 'A101' }),
  }));
  const prompt = contents[0].contents[0].parts[0].text;
  assert.match(prompt, /payment=/);
  assert.doesNotMatch(prompt, /김철수|결제 방법 알려주세요|A101/);
  assert.equal(result.body.topic, 'payment');
  assert.equal(typeof result.body.speechToken, 'string');
  const before = contents.length;
  const blocked = await route.POST(new Request('http://kiosk.local/api/kiosk-assistant/ask', {
    method: 'POST', body: JSON.stringify({ question: '예약번호 123456', screen: 'reservation' }),
  }));
  assert.equal(contents.length, before);
  assert.match(blocked.body.answer, /개인정보는 말하지 말고/);
  env.VERCEL_ENV = 'preview';
  const shortQuestion = await route.POST(new Request('http://kiosk.local/api/kiosk-assistant/ask', {
    method: 'POST', body: JSON.stringify({ question: '방있어?' }),
  }));
  assert.equal(shortQuestion.body.topic, 'availability');
  assert.equal(contents.length, before + 1);
  const preview = await route.POST(new Request('http://kiosk.local/api/kiosk-assistant/ask', {
    method: 'POST', body: JSON.stringify({ question: '객실이 있나요?' }),
  }));
  assert.equal(roomReads, 0);
  assert.match(preview.body.answer, /확인하지 못했습니다/);
  const streamed = await route.POST(new Request('http://kiosk.local/api/kiosk-assistant/ask', {
    method: 'POST', headers: { Accept: 'application/x-ndjson' }, body: JSON.stringify({ question: '방있어?' }),
  }));
  const chunks = [];
  const finished = await assistantStream.readAssistantStream(streamed, part => chunks.push(part));
  assert.equal(chunks.join(''), preview.body.answer);
  assert.equal(finished.topic, 'availability');
});

test('TTS uses the selected style prompt and fixed Gemini TTS model', async () => {
  let requestBody, endpoint;
  const route = load('app/api/kiosk-assistant/speak/route.ts', {
    'next/server': { NextResponse: { json: body => ({ body, status: 503 }) } },
    '@/lib/kiosk-assistant-speech': { verifySpeechToken: () => true },
    '@/lib/kiosk-assistant-content': content,
  }, { process: { env: { GEMINI_API_KEY: 'gemini-test-key', KIOSK_ASSISTANT_VOICE_STYLE: 'calm' } },
    Buffer, Response, fetch: async (url, init) => {
      endpoint = url;
      requestBody = JSON.parse(init.body);
      const audio = Buffer.alloc(48);
      audio.write('RIFF');
      return json({ candidates: [{ content: { parts: [{ inlineData: { data: audio.toString('base64') } }] } }] });
    },
  });
  const response = await route.POST(new Request('http://kiosk.local/api/kiosk-assistant/speak', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '직원에게 연락해 주세요.', token: 'signed' }),
  }));
  assert.match(endpoint, /gemini-3\.8-flash-lite-tts:generateContent$/);
  assert.match(requestBody.contents[0].parts[0].speech_metadata.style, /20대 여성/);
  assert.equal(requestBody.generationConfig.speechConfig.voiceConfig.voice, 'Kore');
  assert.equal(response.headers.get('Content-Type'), 'audio/wav');
});
